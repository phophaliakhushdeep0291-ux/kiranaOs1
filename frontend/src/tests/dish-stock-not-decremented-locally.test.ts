import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillInputBillType, BillPaymentMode, type BillInput } from "@/types/api";

/**
 * The till kept re-creating the bug the server had already stopped.
 *
 * A cooked dish is made to order: its ingredients are what leave the store room,
 * and billing on the server stopped decrementing the plate. But the store room
 * does not render the server — it renders the till's own offline copy, and the
 * local bill path projected a decrement for every line regardless, then wrote
 * `stockTrackingEnabled: true` over whatever had just synced down.
 *
 * So every sale drove Dal Fry one lower and marked it countable again, and the
 * store room filled with dishes at -1 and -2 no matter how correct the database
 * was. Fixing the backend alone could never have shown up on that screen.
 */

const dbState = vi.hoisted(() => ({
  committed: {} as Record<string, unknown[]>,
  idCounter: 0,
  transactions: Promise.resolve() as Promise<unknown>,
}));

const cloneRows = (rows: unknown[]) => rows.map((row) => ({ ...(row as Record<string, unknown>) }));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (table: string) => cloneRows(dbState.committed[table] ?? [])),
    transaction: vi.fn((_tables: string[], callback: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const operation = dbState.transactions.then(async () => {
        const staged = Object.fromEntries(
          Object.entries(dbState.committed).map(([table, rows]) => [table, cloneRows(rows)]),
        ) as Record<string, unknown[]>;
        const ensure = (table: string) => { staged[table] ??= []; return staged[table]; };
        const tx = {
          put: vi.fn(async (table: string, value: unknown) => {
            const row = { ...(value as Record<string, unknown>) };
            const idKey = table === "settings" ? "key" : "id";
            const rows = ensure(table);
            const index = rows.findIndex((existing) => (existing as Record<string, unknown>)[idKey] === row[idKey]);
            if (index >= 0) rows[index] = row; else rows.push(row);
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
        const result = await callback(tx as unknown as Record<string, unknown>);
        dbState.committed = staged;
        return result;
      });
      dbState.transactions = operation.catch(() => undefined);
      return operation;
    }),
  },
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_${++dbState.idCounter}`),
  emitLocalDataChanged: vi.fn(),
  normaliseInstantCacheValue: vi.fn((value: unknown) => value),
  readInstantCache: vi.fn((_key: string, fallback: unknown) => fallback),
  upsertCachedListItem: vi.fn(),
  writeInstantMemoryCache: vi.fn(),
}));

import { createBillLocalFirst } from "@/features/core/billing/local-actions";

const product = (id: string) => (dbState.committed.products as Array<Record<string, unknown>>)
  .find((row) => row.id === id)!;

const sell = (productId: string, name: string, quantity: number, rate: number): BillInput => ({
  billType: BillInputBillType.normal_sale,
  customerName: "Walk-in",
  items: [{ productId, name, quantity, enteredUnit: "piece", ratePerRateUnit: rate, gstRate: 0 }],
  discount: 0,
  actualAmount: quantity * rate,
  buyerPaidAmount: quantity * rate,
  payments: [{ mode: BillPaymentMode.cash, amount: quantity * rate }],
});

describe("a cooked dish is not decremented on the till", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.idCounter = 0;
    dbState.transactions = Promise.resolve();
    dbState.committed = {
      customers: [],
      products: [
        // Exactly the Krish Store shape: on the menu, no recipe, already at zero.
        { id: "dal_fry", name: "Dal Fry", baseUnit: "piece", stockBaseQty: 0,
          defaultPricePerRateUnit: 180, menuCourse: "Main Course", stockTrackingEnabled: false },
        // And a bottled drink beside it that really is bought and counted.
        { id: "water", name: "Mineral Water", baseUnit: "piece", stockBaseQty: 48,
          defaultPricePerRateUnit: 20, menuCourse: "Beverages", stockTrackingEnabled: true },
      ],
    };
  });

  it("does not drive the dish below zero", async () => {
    await createBillLocalFirst(sell("dal_fry", "Dal Fry", 2, 180));
    expect(product("dal_fry").stockBaseQty).toBe(0);
  });

  it("does not mark the dish countable again", async () => {
    // The half that outlived the decrement fix: the projection wrote `true` over
    // whatever had just synced down, so the store room listed it either way.
    await createBillLocalFirst(sell("dal_fry", "Dal Fry", 1, 180));
    expect(product("dal_fry").stockTrackingEnabled).toBe(false);
    expect(product("dal_fry").trackStock).not.toBe(true);
  });

  it("still counts a drink that really is stock", async () => {
    await createBillLocalFirst(sell("water", "Mineral Water", 3, 20));
    expect(product("water").stockBaseQty).toBe(45);
    expect(product("water").stockTrackingEnabled).toBe(true);
  });

  it("stays at zero however many times it is sold", async () => {
    await createBillLocalFirst(sell("dal_fry", "Dal Fry", 2, 180));
    await createBillLocalFirst(sell("dal_fry", "Dal Fry", 3, 180));
    await createBillLocalFirst(sell("dal_fry", "Dal Fry", 1, 180));
    expect(product("dal_fry").stockBaseQty).toBe(0);
  });
});
