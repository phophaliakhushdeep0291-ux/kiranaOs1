import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  committed: {} as Record<string, unknown[]>,
  failOnTable: null as string | null,
  idCounter: 0,
}));

function cloneRows(rows: unknown[]) {
  return rows.map((row) => ({ ...(row as Record<string, unknown>) }));
}

function tableRows(table: string) {
  return (dbState.committed[table] ?? []) as Array<Record<string, unknown>>;
}

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (table: string) => cloneRows(dbState.committed[table] ?? [])),
    put: vi.fn(async () => undefined),
    putMany: vi.fn(async () => undefined),
    transaction: vi.fn(async (_tables: string[], callback: (tx: {
      put: (table: string, value: unknown) => Promise<void>;
      putMany: (table: string, values: unknown[]) => Promise<void>;
      enqueueOutboxOperation: (event: unknown) => Promise<void>;
      setSetting: (key: string, value: unknown, expiresAt?: number | null) => Promise<void>;
    }) => Promise<unknown>) => {
      const staged = Object.fromEntries(Object.entries(dbState.committed).map(([table, rows]) => [table, cloneRows(rows)])) as Record<string, unknown[]>;
      const ensure = (table: string) => {
        staged[table] ??= [];
        return staged[table];
      };
      const maybeFail = (table: string) => {
        if (dbState.failOnTable === table) throw new Error(`Injected ${table} write failure`);
      };

      const tx = {
        put: vi.fn(async (table: string, value: unknown) => {
          maybeFail(table);
          const row = { ...(value as Record<string, unknown>) };
          const rows = ensure(table);
          const index = rows.findIndex((existing) => (existing as Record<string, unknown>).id === row.id);
          if (index >= 0) rows[index] = row;
          else rows.push(row);
        }),
        putMany: vi.fn(async (table: string, values: unknown[]) => {
          maybeFail(table);
          for (const value of values) await tx.put(table, value);
        }),
        enqueueOutboxOperation: vi.fn(async (event: unknown) => {
          maybeFail("sync_outbox");
          ensure("sync_outbox").push({ ...(event as Record<string, unknown>) });
        }),
        setSetting: vi.fn(async (key: string, value: unknown, expiresAt?: number | null) => {
          maybeFail("settings");
          await tx.put("settings", { key, value, expires_at: expiresAt ?? null });
        }),
      };

      await callback(tx);
      dbState.committed = staged;
    }),
  },
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_${++dbState.idCounter}`),
  readInstantCache: vi.fn((_key: string, fallback: unknown) => fallback),
  upsertCachedListItem: vi.fn(),
}));

import { offlineDB } from "@/lib/offline/db";
import { upsertCachedListItem } from "@/lib/offline/instant-cache";
import { recordDamageLocalFirst, recordPurchaseLocalFirst, recordSaleLocalFirst, stockCorrectionLocalFirst } from "@/features/core/inventory/local-actions";

const mockedOfflineDB = vi.mocked(offlineDB);
const mockedUpsertCachedListItem = vi.mocked(upsertCachedListItem);

const productRow = {
  id: "product_1",
  name: "Sugar",
  unit: "kg",
  displayUnit: "kg",
  baseUnit: "kg",
  rateUnit: "kg",
  stockBaseQty: 10,
  lowStockThreshold: 2,
  costPerRateUnit: 40,
  costPrice: 40,
  averageCostPrice: 40,
};

describe("stock adjustment transaction safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.idCounter = 0;
    dbState.failOnTable = null;
    dbState.committed = {
      products: [{ ...productRow }],
      inventory_movements: [],
      local_audit_logs: [],
      sync_outbox: [],
    };
  });

  it("purchase increases stock inside the stock transaction", async () => {
    const result = await recordPurchaseLocalFirst({ productId: "product_1", quantity: 5, unit: "kg", costPerRateUnit: 50, supplierName: "Test Supplier", invoiceNumber: "PUR-100" });

    expect(result.success).toBe(true);
    expect(mockedOfflineDB.transaction).toHaveBeenCalledWith(
      expect.arrayContaining(["inventory_movements", "products", "local_audit_logs", "sync_outbox"]),
      expect.any(Function),
    );
    expect(tableRows("products")[0]).toEqual(expect.objectContaining({ id: "product_1", stockBaseQty: 15, sync_status: "pending_sync" }));
    expect(tableRows("inventory_movements")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "stock_purchase_1",
        type: "purchase",
        quantity_delta: 5,
        stock_before: 10,
        stock_after: 15,
        billAmount: 250,
        bill_amount: 250,
        invoiceNumber: "PUR-100",
        invoice_number: "PUR-100",
        purchaseBillNo: "PUR-100",
        purchase_bill_no: "PUR-100",
        supplierBillNo: "PUR-100",
        supplier_bill_no: "PUR-100",
      }),
    ]));
    expect(tableRows("sync_outbox")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation_type: "STOCK_PURCHASE",
        entity_type: "inventory_movement",
        entity_id: "stock_purchase_1",
        payload: expect.objectContaining({ billAmount: 250 }),
      }),
    ]));
  });

  it("rejects stock purchase without cost or bill amount before local stock changes", async () => {
    await expect(recordPurchaseLocalFirst({ productId: "product_1", quantity: 5, unit: "kg" })).rejects.toThrow(/purchase cost or bill amount/i);

    expect(tableRows("products")[0]).toEqual(expect.objectContaining({ stockBaseQty: 10 }));
    expect(tableRows("inventory_movements")).toHaveLength(0);
    expect(tableRows("sync_outbox")).toHaveLength(0);
  });

  it("purchase updates weighted average cost", async () => {
    await recordPurchaseLocalFirst({ productId: "product_1", quantity: 5, unit: "kg", costPerRateUnit: 50 });

    expect(tableRows("products")[0]).toEqual(expect.objectContaining({
      stockBaseQty: 15,
      averageCostPrice: 43.33,
      costPerRateUnit: 43.33,
      costPrice: 43.33,
    }));
  });

  it("damage requires owner PIN and a reason before any stock write", async () => {
    // No PIN → rejected before any stock write. The server sync handler requires
    // an owner PIN for damage; without this guard the movement saved locally but
    // its STOCK_DAMAGE sync op failed forever ("Owner PIN required"), diverging
    // local stock from the server.
    await expect(recordDamageLocalFirst({ productId: "product_1", quantity: 1, unit: "kg", reason: "Packet damaged" })).rejects.toThrow(/Owner PIN/i);
    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();
    // PIN present but no reason → still rejected.
    await expect(recordDamageLocalFirst({ productId: "product_1", quantity: 1, unit: "kg", ownerPin: "1234" })).rejects.toThrow(/reason/i);
    expect(tableRows("inventory_movements")).toHaveLength(0);

    const result = await recordDamageLocalFirst({ productId: "product_1", quantity: 3, unit: "kg", reason: "Packet damaged", ownerPin: "1234" });

    expect(result.success).toBe(true);
    expect(tableRows("products")[0]).toEqual(expect.objectContaining({ stockBaseQty: 7 }));
    expect(tableRows("inventory_movements")).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "damage", quantity_delta: -3, reason: "Packet damaged", stock_before: 10, stock_after: 7 }),
    ]));
    expect(tableRows("sync_outbox")).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "STOCK_DAMAGE", entity_type: "inventory_movement" }),
    ]));
  });

  it("manual stock out records a STOCK_SALE event without using the owner-gated damage path", async () => {
    const result = await recordSaleLocalFirst({ productId: "product_1", quantity: 3, unit: "kg", reason: "Counter stock out" });

    expect(result.success).toBe(true);
    expect(tableRows("products")[0]).toEqual(expect.objectContaining({ stockBaseQty: 7 }));
    expect(tableRows("inventory_movements")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "stock_sale_1", type: "sale", action: "sale", quantity_delta: -3, stock_before: 10, stock_after: 7 }),
    ]));
    expect(tableRows("sync_outbox")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation_type: "STOCK_SALE",
        entity_type: "inventory_movement",
        entity_id: "stock_sale_1",
        payload: expect.objectContaining({ movementType: "sale", quantityDelta: -3 }),
      }),
    ]));
  });

  it("correction requires owner PIN before any stock write", async () => {
    await expect(stockCorrectionLocalFirst({ productId: "product_1", quantityDelta: 5, unit: "kg", reason: "Physical count", ownerPin: "" })).rejects.toThrow(/Owner PIN/i);

    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();
    expect(tableRows("products")[0]).toEqual(expect.objectContaining({ stockBaseQty: 10 }));
    expect(tableRows("inventory_movements")).toHaveLength(0);
    expect(tableRows("local_audit_logs")).toHaveLength(0);
    expect(tableRows("sync_outbox")).toHaveLength(0);
  });

  it("applies stock correction with audit and outbox inside the same transaction", async () => {
    await stockCorrectionLocalFirst({ productId: "product_1", quantityDelta: 5, unit: "kg", reason: "Physical count", ownerPin: "1234" });

    expect(tableRows("products")[0]).toEqual(expect.objectContaining({ stockBaseQty: 15 }));
    expect(tableRows("inventory_movements")).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "correction", ownerPinVerified: true, owner_pin_verified: true }),
    ]));
    expect(tableRows("local_audit_logs")).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "stock_correction", entity_type: "inventory_movement", entity_id: "stock_correction_1", reason: "Physical count", owner_pin_provided: true }),
    ]));
    expect(tableRows("sync_outbox")).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "STOCK_CORRECTION", entity_type: "inventory_movement", entity_id: "stock_correction_1" }),
      expect.objectContaining({ operation_type: "AUDIT_LOG_APPEND", entity_type: "audit_log" }),
    ]));
  });

  it("failed stock transaction leaves no partial movement or product update", async () => {
    dbState.failOnTable = "local_audit_logs";

    await expect(recordPurchaseLocalFirst({ productId: "product_1", quantity: 5, unit: "kg", costPerRateUnit: 50 })).rejects.toThrow(/local_audit_logs write failure/i);

    expect(tableRows("products")[0]).toEqual(expect.objectContaining({ stockBaseQty: 10, averageCostPrice: 40, costPerRateUnit: 40 }));
    expect(tableRows("inventory_movements")).toHaveLength(0);
    expect(tableRows("local_audit_logs")).toHaveLength(0);
    expect(tableRows("sync_outbox")).toHaveLength(0);
    expect(mockedUpsertCachedListItem).not.toHaveBeenCalled();
  });
});

import { buildUnitMismatchWarning, calculateInventoryPriceSuggestions } from "@/features/core/inventory/calculations";

describe("inventory reliability business rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.idCounter = 0;
    dbState.failOnTable = null;
    dbState.committed = {
      products: [{ ...productRow }],
      inventory_movements: [],
      local_audit_logs: [],
      sync_outbox: [],
    };
  });

  it("enforces negative stock policy unless an explicit override is present, and stores a clear warning when overridden", async () => {
    await expect(recordDamageLocalFirst({ productId: "product_1", quantity: 11, unit: "kg", reason: "Leaked bag", ownerPin: "1234" })).rejects.toThrow(/Negative stock is not allowed/i);
    expect(tableRows("products")[0]).toEqual(expect.objectContaining({ stockBaseQty: 10 }));
    expect(tableRows("inventory_movements")).toHaveLength(0);

    dbState.committed.products = [{ ...productRow, allowNegativeStock: true }];

    await recordDamageLocalFirst({ productId: "product_1", quantity: 12, unit: "kg", reason: "Owner approved shortage", allowNegativeStock: true, ownerPin: "1234" });

    expect(tableRows("products")[0]).toEqual(expect.objectContaining({ stockBaseQty: -2 }));
    expect(tableRows("inventory_movements")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "damage",
        quantity_delta: -12,
        stock_after: -2,
        warning: expect.stringContaining("Negative stock override used"),
        negativeStockWarning: "Negative stock override used",
      }),
    ]));
    expect(tableRows("sync_outbox")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation_type: "STOCK_DAMAGE",
        payload: expect.objectContaining({ warning: expect.stringContaining("Negative stock override used") }),
      }),
    ]));
  });

  it("calculates minimum price and selling price margin suggestions from projected weighted average cost", () => {
    const suggestions = calculateInventoryPriceSuggestions({
      currentStockBaseQty: 10,
      currentAverageCost: 40,
      purchaseQuantity: 5,
      purchaseUnit: "kg",
      productBaseUnit: "kg",
      productRateUnit: "kg",
      purchaseUnitCost: 50,
      minMarginPercent: 5,
      sellingMarginPercent: 12,
    });

    expect(suggestions.projectedAverageCost).toBe(43.33);
    expect(suggestions.minPriceSuggestion).toBe(45.5);
    expect(suggestions.sellingPriceSuggestion).toBe(48.53);
  });

  it("supports fractional kg/gram quantities without rounding stock incorrectly", async () => {
    const result = await recordPurchaseLocalFirst({ productId: "product_1", quantity: 500, unit: "gram", costPerRateUnit: 50 });

    expect(result.product).toEqual(expect.objectContaining({ stockBaseQty: 10.5, averageCostPrice: 40.48 }));
    expect(tableRows("products")[0]).toEqual(expect.objectContaining({ stockBaseQty: 10.5, averageCostPrice: 40.48 }));
    expect(tableRows("inventory_movements")).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "purchase", quantity_delta: 0.5, stock_before: 10, stock_after: 10.5, unit: "gram" }),
    ]));
  });

  it("converts packaged purchase quantities through the selected selling unit", async () => {
    dbState.committed.products = [{
      id: "product_packet",
      name: "Atta 1kg",
      unit: "packet",
      displayUnit: "packet 1 kg",
      baseUnit: "gram",
      rateUnit: "packet",
      stockBaseQty: 10_000,
      stockQuantity: 10,
      lowStockThreshold: 2_000,
      costPerRateUnit: 50,
      costPrice: 50,
      averageCostPrice: 50,
      sellingUnits: [{
        id: "unit_packet_1kg",
        name: "packet 1 kg",
        unitType: "packet",
        unitCode: "packet-1-kg",
        packSizeValue: 1,
        packSizeUnit: "kg",
        conversionToBase: 1_000,
        defaultPrice: 62,
        minimumPrice: 58,
        maximumPrice: 70,
        costPrice: 50,
        isDefault: true,
        isActive: true,
      }],
    }];

    const result = await recordPurchaseLocalFirst({
      productId: "product_packet",
      quantity: 3,
      unit: "packet-1-kg",
      costPerRateUnit: 60,
    });

    expect(result.product).toEqual(expect.objectContaining({
      stockBaseQty: 13_000,
      stockQuantity: 13,
      displayUnit: "packet 1 kg",
      averageCostPrice: 52.31,
    }));
    expect(tableRows("inventory_movements")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "purchase",
        quantity_delta: 3_000,
        stock_before: 10_000,
        stock_after: 13_000,
        unit: "packet 1 kg",
        selling_unit_code: "packet-1-kg",
        conversion_to_base: 1_000,
        bill_amount: 180,
      }),
    ]));
    expect(tableRows("sync_outbox")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation_type: "STOCK_PURCHASE",
        payload: expect.objectContaining({
          quantity: 3_000,
          enteredUnit: "gram",
          displayQuantity: 3,
          displayUnit: "packet 1 kg",
          syncQuantityBase: 3_000,
          syncEnteredUnit: "gram",
        }),
      }),
    ]));
  });

  it("shows a clear unit mismatch warning for incompatible unit families", async () => {
    expect(buildUnitMismatchWarning("litre", "kg")).toMatch(/Unit mismatch warning/i);

    await recordPurchaseLocalFirst({ productId: "product_1", quantity: 1, unit: "litre", costPerRateUnit: 50 });

    expect(tableRows("inventory_movements")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "purchase",
        unit: "litre",
        warning: expect.stringContaining("Unit mismatch warning"),
        unitMismatchWarning: expect.stringContaining("entered litre"),
      }),
    ]));
    expect(tableRows("sync_outbox")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation_type: "STOCK_PURCHASE",
        payload: expect.objectContaining({ unitMismatchWarning: expect.stringContaining("Unit mismatch warning") }),
      }),
    ]));
  });
});
