import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildPurchaseOverrideMatcher,
  rowMatchesPurchaseOverride,
  withLocalPurchaseOverride,
} from "@/features/purchases/sync-guards";
import { buildBackendSyncOperation } from "@/features/sync/sync-operation-normalizer";

describe("purchase sync override safety", () => {
  it("keeps previous purchase keys so edited rows block stale cloud re-imports", () => {
    const originalInventoryPurchase = {
      id: "stock_purchase_1",
      productId: "product_oil",
      supplierName: "Govind ji",
      purchaseBillNo: "INV-1",
      billAmount: 4100,
      purchasePaidAmount: 0,
      purchaseDueAmount: 4100,
      created_at: "2026-06-08T12:00:00.000Z",
    };
    const editedInventoryPurchase = withLocalPurchaseOverride(
      {
        ...originalInventoryPurchase,
        supplierName: "Govind Traders",
        purchaseBillNo: "INV-1A",
        billAmount: 4500,
        purchasePaidAmount: 4500,
        purchaseDueAmount: 0,
      },
      "updated",
      originalInventoryPurchase,
    );

    const staleCloudPurchaseHistory = {
      id: "purchase_history_server_1",
      productId: "product_oil",
      supplierName: "Govind ji",
      invoiceNumber: "INV-1",
      billAmount: 4100,
      purchasePaidAmount: 0,
      purchaseDueAmount: 4100,
      created_at: "2026-06-08T12:00:00.000Z",
    };

    const matcher = buildPurchaseOverrideMatcher([editedInventoryPurchase]);
    expect(rowMatchesPurchaseOverride(staleCloudPurchaseHistory, matcher)).toBe(true);
  });

  it("guards both direct hydration and normal sync pull", () => {
    const hydration = readFileSync("src/features/sync/cloud-hydration.ts", "utf8");
    const reconcile = readFileSync("src/features/sync/sync-reconcile.ts", "utf8");
    const outbox = readFileSync("src/features/sync/outbox.ts", "utf8");
    const normalizer = readFileSync("src/features/sync/sync-operation-normalizer.ts", "utf8");
    const syncTypes = readFileSync("src/features/sync/sync-types.ts", "utf8");

    expect(hydration).toContain("rowMatchesPurchaseOverride");
    expect(hydration).toContain("safeRows");
    expect(reconcile).toContain("localOverrideWins");
    expect(reconcile).toContain("return \"ignored\"");
    expect(outbox).toContain("UPDATE_PURCHASE_BILL");
    expect(outbox).toContain("DELETE_PURCHASE_BILL");
    expect(normalizer).toContain("UPDATE_PURCHASE_BILL");
    expect(normalizer).toContain("DELETE_PURCHASE_BILL");
    expect(syncTypes).toContain("stockLedgerId");
    expect(syncTypes).toContain("localMovementId");
  });

  it("repairs queued stock purchase payment fields before backend sync", () => {
    const operation = buildBackendSyncOperation({
      operation_type: "STOCK_PURCHASE",
      entity_type: "inventory_movement",
      entity_id: "stock_purchase_1",
      payload: {},
    } as never, {
      productId: "product_1",
      quantity: 1,
      enteredUnit: "kg",
      billAmount: 200,
      purchasePaymentStatus: "partial",
      purchaseDueDate: "2026-06-18T12:00:00.000Z",
    });

    expect(operation?.payload).toEqual(expect.objectContaining({
      purchasePaymentStatus: "due",
      purchase_payment_status: "due",
      purchasePaidAmount: 0,
      purchase_paid_amount: 0,
      purchaseDueAmount: 200,
      purchase_due_amount: 200,
      purchaseDueDate: "2026-06-18",
      purchase_due_date: "2026-06-18",
    }));
    expect(operation?.payload.purchasePaymentMode).toBeUndefined();
  });

  it("uses packaged movement base quantity and base unit for backend stock sync", () => {
    const operation = buildBackendSyncOperation({
      operation_type: "STOCK_PURCHASE",
      entity_type: "inventory_movement",
      entity_id: "stock_purchase_packet",
      payload: {},
    } as never, {
      productId: "product_packet",
      quantity: 3,
      enteredUnit: "packet-1-kg",
      displayQuantity: 3,
      displayUnit: "packet 1 kg",
      syncQuantityBase: 3_000,
      syncEnteredUnit: "gram",
      billAmount: 180,
    });

    expect(operation?.payload).toEqual(expect.objectContaining({
      quantity: 3_000,
      enteredUnit: "gram",
      displayQuantity: 3,
      displayUnit: "packet 1 kg",
    }));
  });

  it("repairs queued purchase edit payment fields before backend sync", () => {
    const operation = buildBackendSyncOperation({
      operation_type: "UPDATE_PURCHASE_BILL",
      entity_type: "purchase_history",
      entity_id: "purchase_1",
      payload: {},
    } as never, {
      purchaseHistoryId: "purchase_1",
      billAmount: 500,
      purchasePaidAmount: 500,
      purchaseDueAmount: 200,
      purchasePaymentStatus: "partial",
      purchasePaymentMode: "upi",
      purchaseDueDate: "2026-06-18T12:00:00.000Z",
    });

    expect(operation?.payload).toEqual(expect.objectContaining({
      purchasePaymentStatus: "paid",
      purchase_payment_status: "paid",
      purchasePaidAmount: 500,
      purchase_paid_amount: 500,
      purchaseDueAmount: 0,
      purchase_due_amount: 0,
    }));
    expect(operation?.payload.purchaseDueDate).toBeUndefined();
  });

  it("strips blank purchase lifecycle ids before backend validation", () => {
    const operation = buildBackendSyncOperation({
      operation_type: "UPDATE_PURCHASE_BILL",
      entity_type: "purchase_history",
      entity_id: "stock_purchase_3209ba21",
      payload: {},
    } as never, {
      purchaseHistoryId: "",
      purchaseBillId: "",
      stockLedgerId: "",
      localPurchaseHistoryId: "",
      localPurchaseBillId: "",
      supplierName: "sugar",
      invoiceNumber: "",
      billAmount: 336,
      purchasePaidAmount: 336,
      purchasePaymentStatus: "partial",
      purchasePaymentMode: "cash",
      purchaseDueDate: "not-a-date",
      match: {
        productId: "server_product_1",
        supplierName: "sugar",
        billAmount: 336,
      },
    });

    expect(operation?.payload).toEqual(expect.objectContaining({
      purchaseHistoryId: undefined,
      purchaseBillId: undefined,
      stockLedgerId: undefined,
      localPurchaseHistoryId: "stock_purchase_3209ba21",
      localPurchaseBillId: "stock_purchase_3209ba21",
      purchasePaymentStatus: "paid",
      purchasePaidAmount: 336,
      purchaseDueAmount: 0,
    }));
    expect(operation?.payload.purchaseDueDate).toBeUndefined();
    expect(operation?.payload.invoiceNumber).toBeNull();
  });
});
