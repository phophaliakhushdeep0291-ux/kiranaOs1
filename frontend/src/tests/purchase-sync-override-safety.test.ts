import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildPurchaseOverrideMatcher,
  rowMatchesPurchaseOverride,
  withLocalPurchaseOverride,
} from "@/features/purchases/sync-guards";

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
});
