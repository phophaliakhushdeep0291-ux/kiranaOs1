import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/types/api";

const mockState = vi.hoisted(() => ({
  idCounter: 0,
  products: [] as Array<Record<string, unknown>>,
  committed: {
    products: [] as Array<Record<string, unknown>>,
    local_audit_logs: [] as Array<Record<string, unknown>>,
    sync_outbox: [] as Array<Record<string, unknown>>,
  },
  /** Product ids whose delete transaction should blow up, to exercise partial failure. */
  failIds: new Set<string>(),
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (storeName: string) => (storeName === "products" ? mockState.products : [])),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    transaction: vi.fn(async (_tables: string[], callback: (tx: {
      put: (storeName: string, value: unknown) => Promise<void>;
      putMany: (storeName: string, values: unknown[]) => Promise<void>;
      enqueueOutboxOperation: (event: unknown) => Promise<void>;
      setSetting: (key: string, value: unknown) => Promise<void>;
    }) => Promise<unknown>) => {
      const pending = {
        products: [] as Array<Record<string, unknown>>,
        local_audit_logs: [] as Array<Record<string, unknown>>,
        sync_outbox: [] as Array<Record<string, unknown>>,
      };
      const tx = {
        put: vi.fn(async (storeName: string, value: unknown) => {
          const row = value as Record<string, unknown>;
          if (storeName === "products" && mockState.failIds.has(String(row.id))) {
            throw new Error("forced IndexedDB failure");
          }
          if (storeName in pending) pending[storeName as keyof typeof pending].push(row);
        }),
        putMany: vi.fn(async (storeName: string, values: unknown[]) => {
          for (const value of values) await tx.put(storeName, value);
        }),
        enqueueOutboxOperation: vi.fn(async (event: unknown) => {
          pending.sync_outbox.push(event as Record<string, unknown>);
        }),
        setSetting: vi.fn(async () => undefined),
      };
      const result = await callback(tx);
      // Commit only after the callback returns, so a throw leaves the shop untouched.
      mockState.committed.products.push(...pending.products);
      mockState.committed.local_audit_logs.push(...pending.local_audit_logs);
      mockState.committed.sync_outbox.push(...pending.sync_outbox);
      return result;
    }),
  },
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_${++mockState.idCounter}`),
  emitLocalDataChanged: vi.fn(),
  removeCachedListItem: vi.fn(),
  upsertCachedListItem: vi.fn(),
  readInstantCache: vi.fn(() => []),
  writeInstantCache: vi.fn(),
}));

import {
  runBulkProductDelete,
  summariseBulkDelete,
  type SelectedProduct,
} from "@/features/core/products/bulk-delete";

type Row = Record<string, unknown>;

function product(overrides: Partial<Product> & Record<string, unknown> = {}): SelectedProduct {
  return {
    id: "product_1",
    name: "Tata Salt 1kg",
    category: "grocery",
    unit: "packet",
    displayUnit: "packet",
    baseUnit: "piece",
    rateUnit: "packet",
    stockBaseQty: 0,
    sellingPrice: 28,
    defaultPricePerRateUnit: 28,
    ...overrides,
  } as SelectedProduct;
}

const deleteOps = () => mockState.committed.sync_outbox.filter((row) => row.operation_type === "DELETE_PRODUCT_PENDING");
const deleteAudits = () => mockState.committed.local_audit_logs.filter((row) => row.action === "product_deleted");

beforeEach(() => {
  vi.clearAllMocks();
  mockState.idCounter = 0;
  mockState.products = [];
  mockState.failIds = new Set();
  mockState.committed = { products: [], local_audit_logs: [], sync_outbox: [] };
});

describe("what the shopkeeper is told before deleting", () => {
  it("groups the selection by category, largest first", () => {
    const summary = summariseBulkDelete([
      product({ id: "a", category: "Cosmetics" }),
      product({ id: "b", category: "Cosmetics" }),
      product({ id: "c", category: "Atta & Flour" }),
    ]);

    expect(summary.total).toBe(3);
    expect(summary.categories).toEqual([
      { name: "Cosmetics", count: 2 },
      { name: "Atta & Flour", count: 1 },
    ]);
  });

  it("counts a product with no category as general rather than dropping it", () => {
    const summary = summariseBulkDelete([product({ id: "a", category: "   " })]);
    expect(summary.categories).toEqual([{ name: "general", count: 1 }]);
  });

  it("warns about stock still on the shelf, valued per selling unit", () => {
    // A 5 kg bag: 2 bags in stock is 10,000 g of base quantity. Reading stockBaseQty as
    // if it were "2" — or valuing 10,000 at the per-bag cost — is how this warning ends
    // up wrong by a factor of the pack size, which is worse than showing nothing.
    const summary = summariseBulkDelete([
      product({
        id: "bag",
        unit: "packet",
        baseUnit: "gram",
        stockBaseQty: 10_000,
        averageCostPrice: 320,
        sellingUnits: [{ unitCode: "bag5", unitType: "packet", packSizeValue: 5, packSizeUnit: "kg", conversionToBase: 5000, isDefault: true }],
      }),
      product({ id: "empty", stockBaseQty: 0, averageCostPrice: 20 }),
    ]);

    expect(summary.withStock).toBe(1);
    expect(summary.stockValue).toBe(640);
  });

  it("reports nothing to warn about when the whole selection is out of stock", () => {
    const summary = summariseBulkDelete([product({ id: "a" }), product({ id: "b" })]);
    expect(summary.withStock).toBe(0);
    expect(summary.stockValue).toBe(0);
  });
});

describe("running a bulk delete", () => {
  it("soft deletes every product, one audit row and one sync operation each", async () => {
    const products = [product({ id: "a" }), product({ id: "b" }), product({ id: "c" })];

    const result = await runBulkProductDelete(products, { ownerPin: "1234", reason: "Not sold here" });

    expect(result).toEqual({ deleted: 3, skipped: 0, failures: [], cancelled: false });
    expect(deleteAudits()).toHaveLength(3);
    expect(deleteOps()).toHaveLength(3);
    // Soft delete: a tombstone is written, the row is never removed.
    expect(mockState.committed.products.map((row) => row.deletedAt).every(Boolean)).toBe(true);
  });

  it("carries the owner PIN and reason onto every single product, not just the first", async () => {
    // The audit trail has to answer "who authorised THIS row". Collecting the PIN once in
    // the dialog and deleting without it would leave 199 unauthorised rows behind one
    // approval, which is exactly what the per-product owner-PIN gate exists to prevent.
    await runBulkProductDelete([product({ id: "a" }), product({ id: "b" })], {
      ownerPin: "1234",
      reason: "Starter items this shop does not sell",
    });

    for (const op of deleteOps()) {
      expect(op.payload).toEqual(expect.objectContaining({
        ownerPin: "1234",
        reason: "Starter items this shop does not sell",
        ownerPinProvided: true,
      }));
    }
    for (const audit of deleteAudits()) {
      expect(audit).toEqual(expect.objectContaining({ owner_pin_provided: true, reason: "Starter items this shop does not sell" }));
    }
  });

  it("refuses the whole run without an owner PIN, writing nothing", async () => {
    const result = await runBulkProductDelete([product({ id: "a" }), product({ id: "b" })], {
      ownerPin: "",
      reason: "Not sold here",
    });

    expect(result.deleted).toBe(0);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0].message).toMatch(/owner pin/i);
    expect(mockState.committed.products).toHaveLength(0);
    expect(deleteOps()).toHaveLength(0);
  });

  it("keeps going past a failure and names what was left behind", async () => {
    mockState.failIds = new Set(["b"]);
    const products = [product({ id: "a" }), product({ id: "b", name: "Fortune Oil 1L" }), product({ id: "c" })];

    const result = await runBulkProductDelete(products, { ownerPin: "1234", reason: "Not sold here" });

    expect(result.deleted).toBe(2);
    expect(result.failures).toEqual([
      expect.objectContaining({ id: "b", name: "Fortune Oil 1L" }),
    ]);
    // The failed row is untouched, not half-deleted: no tombstone, no queued operation.
    expect(deleteOps().map((op) => op.entity_id).sort()).toEqual(["a", "c"]);
    expect((mockState.committed.products as Row[]).some((row) => row.id === "b")).toBe(false);
  });

  it("stops on cancel and keeps what it already deleted", async () => {
    const controller = new AbortController();
    const products = [product({ id: "a" }), product({ id: "b" }), product({ id: "c" }), product({ id: "d" })];

    const result = await runBulkProductDelete(products, {
      ownerPin: "1234",
      reason: "Not sold here",
      signal: controller.signal,
      onProgress: ({ done }) => { if (done >= 2) controller.abort(); },
    });

    expect(result.cancelled).toBe(true);
    expect(result.deleted).toBe(2);
    // Whole products, never half of one — and the two survivors are untouched.
    expect(deleteOps()).toHaveLength(2);
    expect(deleteAudits()).toHaveLength(2);
  });

  it("does not write a second tombstone over a product already in the recycle bin", async () => {
    const result = await runBulkProductDelete(
      [product({ id: "a" }), product({ id: "gone", deletedAt: "2026-08-01T00:00:00.000Z" })],
      { ownerPin: "1234", reason: "Not sold here" },
    );

    expect(result.deleted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(deleteOps().map((op) => op.entity_id)).toEqual(["a"]);
  });

  it("reports progress that ends at the number it promised", async () => {
    const seen: Array<{ done: number; total: number }> = [];
    await runBulkProductDelete([product({ id: "a" }), product({ id: "b" })], {
      ownerPin: "1234",
      reason: "Not sold here",
      onProgress: (progress) => seen.push({ ...progress }),
    });

    expect(seen).toEqual([{ done: 0, total: 2 }, { done: 1, total: 2 }, { done: 2, total: 2 }]);
  });
});
