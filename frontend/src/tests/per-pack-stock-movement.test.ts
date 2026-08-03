import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stock In / Stock Out against ONE packaging.
 *
 * The dialog always moved the product's default pack, so a shop that received "12
 * boxes" of a per-pack product could only record it as 12 of whatever the default
 * size happened to be — and the box count on the shelf never changed. The movement
 * now names the pack, and both the device and the sync payload have to agree on
 * which size moved and by how many.
 */

const dbState = vi.hoisted(() => ({
  committed: {} as Record<string, unknown[]>,
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
      const tx = {
        put: vi.fn(async (table: string, value: unknown) => {
          const row = { ...(value as Record<string, unknown>) };
          const rows = ensure(table);
          const index = rows.findIndex((existing) => (existing as Record<string, unknown>).id === row.id);
          if (index >= 0) rows[index] = row;
          else rows.push(row);
        }),
        putMany: vi.fn(async (table: string, values: unknown[]) => {
          for (const value of values) await tx.put(table, value);
        }),
        enqueueOutboxOperation: vi.fn(async (event: unknown) => {
          ensure("sync_outbox").push({ ...(event as Record<string, unknown>) });
        }),
        setSetting: vi.fn(async (key: string, value: unknown, expiresAt?: number | null) => {
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

import { recordPurchaseLocalFirst, recordSaleLocalFirst } from "@/features/core/inventory/local-actions";

type Row = Record<string, unknown>;

const packet = { id: "su_pkt", name: "70 g packet", unitType: "packet", unitCode: "pkt70", packSizeValue: 70, packSizeUnit: "gram", conversionToBase: 70, defaultPrice: 14, costPrice: 11, onHandQty: 40, lowStockThreshold: 12, isDefault: true, isActive: true };
const box = { id: "su_box", name: "8-pack box", unitType: "box", unitCode: "box8", conversionToBase: 560, defaultPrice: 108, costPrice: 88, onHandQty: 5, lowStockThreshold: 3, isDefault: false, isActive: true };

const perPackProduct = {
  id: "product_1",
  name: "Maggi Noodles",
  unit: "piece",
  displayUnit: "piece",
  baseUnit: "g",
  rateUnit: "piece",
  packagingMode: "per_pack",
  stockBaseQty: 5600,
  costPerRateUnit: 11,
  costPrice: 11,
  averageCostPrice: 11,
  sellingUnits: [packet, box],
};

const pooledProduct = {
  id: "product_2",
  name: "Loose Rice",
  unit: "kg",
  displayUnit: "kg",
  baseUnit: "g",
  rateUnit: "kg",
  packagingMode: "pooled",
  stockBaseQty: 25_000,
  costPerRateUnit: 46,
  costPrice: 46,
  averageCostPrice: 46,
  sellingUnits: [
    { id: "su_kg", name: "kg", unitType: "kg", unitCode: "kg", conversionToBase: 1000, defaultPrice: 58, isDefault: true, isActive: true },
    { id: "su_bag", name: "5 kg bag", unitType: "bag", unitCode: "bag5", conversionToBase: 5000, defaultPrice: 280, isDefault: false, isActive: true },
  ],
};

function packsOf(productId: string) {
  const product = tableRows("products").find((row) => row.id === productId) as Row;
  return Object.fromEntries(((product.sellingUnits ?? []) as Row[]).map((unit) => [unit.unitCode as string, unit.onHandQty]));
}

function lastOutboxPayload() {
  const rows = tableRows("sync_outbox");
  const stockOps = rows.filter((row) => String(row.operation_type ?? "").startsWith("STOCK_"));
  return (stockOps[stockOps.length - 1] as Row).payload as Row;
}

describe("stock movement against one packaging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.idCounter = 0;
    dbState.committed = {
      products: [{ ...perPackProduct }, { ...pooledProduct }],
      inventory_movements: [],
      local_audit_logs: [],
      sync_outbox: [],
    };
  });

  it("adds received stock to the size that arrived, and only that size", async () => {
    await recordPurchaseLocalFirst({ productId: "product_1", quantity: 12, enteredUnit: "box8", costPerRateUnit: 88 });

    expect(packsOf("product_1")).toEqual({ box8: 17, pkt70: 40 });
    // 12 boxes x 560 g. The pooled total stays authoritative and must agree with
    // the packs, or the two numbers drift from the very first receipt.
    expect(tableRows("products")[0].stockBaseQty).toBe(5600 + 6720);
  });

  it("removes sold stock from the size that left", async () => {
    await recordSaleLocalFirst({ productId: "product_1", quantity: 2, enteredUnit: "box8", reason: "Counter stock out" });

    expect(packsOf("product_1")).toEqual({ box8: 3, pkt70: 40 });
    expect(tableRows("products")[0].stockBaseQty).toBe(5600 - 1120);
  });

  it("tells the server which pack moved and how many of it", async () => {
    // The base-unit quantity cannot distinguish 8 single packets from one 8-pack,
    // so the payload states the movement a second time in the pack's own counts.
    await recordPurchaseLocalFirst({ productId: "product_1", quantity: 12, enteredUnit: "box8", costPerRateUnit: 88 });

    const payload = lastOutboxPayload();
    expect(payload.sellingUnitId).toBe("su_box");
    expect(payload.sellingUnitCode).toBe("box8");
    expect(payload.sellingUnitQty).toBe(12);
    expect(payload.quantity).toBe(6720); // still base units for the pooled total
  });

  it("leaves pooled products exactly as they were", async () => {
    // Every size draws on the same sack, so there is no per-size count to move and
    // nothing extra may be sent — an unexpected sellingUnitQty would make the
    // server re-derive base units from a pack conversion and multiply the movement.
    await recordPurchaseLocalFirst({ productId: "product_2", quantity: 3, enteredUnit: "bag5", costPerRateUnit: 230 });

    const product = tableRows("products").find((row) => row.id === "product_2") as Row;
    expect(product.stockBaseQty).toBe(25_000 + 15_000);
    expect(((product.sellingUnits ?? []) as Row[]).every((unit) => unit.onHandQty === undefined)).toBe(true);

    const payload = lastOutboxPayload();
    expect(payload.sellingUnitQty).toBeUndefined();
    expect(payload.sellingUnitId).toBeUndefined();
  });

  it("records the pack on the movement history", async () => {
    await recordSaleLocalFirst({ productId: "product_1", quantity: 2, enteredUnit: "box8", reason: "Damage" });

    expect(tableRows("inventory_movements")[0]).toEqual(expect.objectContaining({
      sellingUnitCode: "box8",
      sellingUnitLabel: "8-pack box",
      sellingUnitQty: 2,
      selling_unit_qty: 2,
    }));
  });
});
