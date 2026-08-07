import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  committed: {} as Record<string, unknown[]>,
  idCounter: 0,
}));

function cloneRows(rows: unknown[]) {
  return rows.map((row) => ({ ...(row as Record<string, unknown>) }));
}

/** Outbox rows are keyed by op_id and settings by key; everything else by id. */
function keyField(table: string) {
  if (table === "settings") return "key";
  if (table === "sync_outbox") return "op_id";
  return "id";
}

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (table: string) => cloneRows(dbState.committed[table] ?? [])),
    transaction: vi.fn(async (_tables: string[], callback: (tx: {
      put: (table: string, value: unknown) => Promise<void>;
      putMany: (table: string, values: unknown[]) => Promise<void>;
      setSetting: (key: string, value: unknown, expiresAt?: number | null) => Promise<void>;
    }) => Promise<unknown>) => {
      const staged = Object.fromEntries(
        Object.entries(dbState.committed).map(([table, rows]) => [table, cloneRows(rows)]),
      ) as Record<string, unknown[]>;
      const ensure = (table: string) => {
        staged[table] ??= [];
        return staged[table];
      };

      const tx = {
        put: vi.fn(async (table: string, value: unknown) => {
          const row = { ...(value as Record<string, unknown>) };
          const field = keyField(table);
          const rows = ensure(table);
          const index = rows.findIndex((existing) => (existing as Record<string, unknown>)[field] === row[field]);
          if (index >= 0) rows[index] = row;
          else rows.push(row);
        }),
        putMany: vi.fn(async (table: string, values: unknown[]) => {
          for (const value of values) await tx.put(table, value);
        }),
        setSetting: vi.fn(async (key: string, value: unknown, expiresAt?: number | null) => {
          await tx.put("settings", { key, value, expires_at: expiresAt ?? null });
        }),
      };

      await callback(tx);
      // Commit only after the callback returns, so a throw leaves the shop untouched.
      dbState.committed = staged;
    }),
  },
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_${++dbState.idCounter}`),
  emitLocalDataChanged: vi.fn(),
  normaliseInstantCacheValue: vi.fn((value: unknown) => value),
  readInstantCache: vi.fn((_key: string, fallback: unknown) => fallback),
  removeCachedListItem: vi.fn(),
  upsertCachedListItem: vi.fn(),
  writeInstantCache: vi.fn(),
  writeInstantMemoryCache: vi.fn(),
}));

import { KIRANA_STARTER_CATALOG } from "@/features/core/products/starter-catalog/kirana-catalog.generated";
import { importStarterCatalogItems } from "@/features/core/products/starter-catalog/load-starter-catalog";

type Row = Record<string, unknown>;

const products = () => (dbState.committed.products ?? []) as Row[];
const outbox = () => (dbState.committed.sync_outbox ?? []) as Row[];
const createProductOps = () => outbox().filter((row) => row.operation_type === "CREATE_PRODUCT");

describe("loading the built-in kirana catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.committed = {};
    dbState.idCounter = 0;
  });

  it("creates 560 products, 48 of them loose", async () => {
    const result = await importStarterCatalogItems(KIRANA_STARTER_CATALOG);

    expect(result.created).toBe(560);
    expect(result.cancelled).toBe(false);
    expect(products()).toHaveLength(560);
    expect(products().filter((product) => product.isLooseItem === true)).toHaveLength(48);
  });

  it("creates no duplicates when it is run a second time", async () => {
    await importStarterCatalogItems(KIRANA_STARTER_CATALOG);
    const second = await importStarterCatalogItems(KIRANA_STARTER_CATALOG);

    // The catalog ships no barcodes, so this is the name + brand + unit + pack-size
    // reconciliation doing the work, not a barcode match.
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(560);
    expect(products()).toHaveLength(560);
    expect(new Set(products().map((product) => product.name)).size).toBe(560);
  });

  it("queues exactly one server create per product, not one per attempt", async () => {
    // The offline case: nothing syncs between the two loads, so the outbox is the whole
    // record of what the server will be told. A second load must add nothing to it.
    await importStarterCatalogItems(KIRANA_STARTER_CATALOG);
    expect(createProductOps()).toHaveLength(560);

    await importStarterCatalogItems(KIRANA_STARTER_CATALOG);
    expect(createProductOps()).toHaveLength(560);

    const idempotencyKeys = new Set(createProductOps().map((row) => row.idempotency_key));
    expect(idempotencyKeys.size).toBe(560);
    const localIds = new Set(createProductOps().map((row) => (row.payload as Row).localProductId));
    expect(localIds.size).toBe(560);
  });

  it("reports progress that ends at the number it promised", async () => {
    const seen: Array<{ created: number; total: number }> = [];
    await importStarterCatalogItems(KIRANA_STARTER_CATALOG, {
      batchSize: 100,
      onProgress: (progress) => seen.push({ ...progress }),
    });

    expect(seen[0]).toEqual({ created: 0, total: 560 });
    expect(seen.at(-1)).toEqual({ created: 560, total: 560 });
    expect(seen.map((entry) => entry.created)).toEqual([0, 100, 200, 300, 400, 500, 560]);
  });

  it("keeps what it already committed when the shopkeeper cancels", async () => {
    const controller = new AbortController();
    const result = await importStarterCatalogItems(KIRANA_STARTER_CATALOG, {
      batchSize: 100,
      onProgress: (progress) => {
        if (progress.created >= 200) controller.abort();
      },
      signal: controller.signal,
    });

    expect(result.cancelled).toBe(true);
    expect(result.created).toBe(200);
    // Whole products, never half of one: 200 committed rows, each with its outbox op.
    expect(products()).toHaveLength(200);
    expect(createProductOps()).toHaveLength(200);
  });

  it("resumes after a cancel and finishes the rest without duplicating", async () => {
    const controller = new AbortController();
    await importStarterCatalogItems(KIRANA_STARTER_CATALOG, {
      batchSize: 100,
      onProgress: (progress) => {
        if (progress.created >= 200) controller.abort();
      },
      signal: controller.signal,
    });

    const resumed = await importStarterCatalogItems(KIRANA_STARTER_CATALOG);

    expect(resumed.created).toBe(360);
    expect(resumed.skipped).toBe(200);
    expect(products()).toHaveLength(560);
    expect(createProductOps()).toHaveLength(560);
  });

  it("leaves a shop's own products alone", async () => {
    dbState.committed.products = [
      { id: "product_local", name: "Ramesh special mixture", unit: "packet", sellingPrice: 40, isLooseItem: false },
    ];

    await importStarterCatalogItems(KIRANA_STARTER_CATALOG);

    expect(products()).toHaveLength(561);
    expect(products().some((product) => product.id === "product_local")).toBe(true);
  });
});
