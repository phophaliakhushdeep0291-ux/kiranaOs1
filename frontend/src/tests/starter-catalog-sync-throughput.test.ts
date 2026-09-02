import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { drainPendingOutboxOperations, type PushOutcome } from "@/features/core/sync/sync-push";
import { SYNC_BATCH_MAX_BYTES, SYNC_BATCH_SIZE } from "@/features/core/sync/sync-types";
import { KIRANA_STARTER_CATALOG_COUNT } from "@/features/core/products/starter-catalog/kirana-catalog-summary.generated";

/**
 * Loading the built-in starter catalog took minutes, and none of it was the
 * shop's connection.
 *
 * The load queues far more than its item count: every product carries a
 * `product_import_created` audit row, and each of the fourteen commit batches
 * adds a `product_import_completed` summary. That is 560 + 574 = 1,134 outbox
 * rows for a "560 item" catalog.
 *
 * Two things then metered it out. The client sent 50 operations per request
 * against a server that accepts 500, so 23 requests were needed. And the engine
 * sent exactly one batch per scheduled tick, on a ladder starting at 2.5s — so
 * those 23 requests were spaced by the timer, and stopped entirely whenever the
 * tab was hidden, because the tick only runs while the document is visible.
 *
 * These tests hold the three decisions that fixed it.
 */

const outcome = (over: Partial<PushOutcome> = {}): PushOutcome => ({
  pushed: 0,
  failed: 0,
  conflicts: 0,
  skipped: 0,
  ...over,
});

describe("a batch is sized against what the server actually accepts", () => {
  it("sends more than the 50 that made a catalog load 23 requests", () => {
    expect(SYNC_BATCH_SIZE).toBeGreaterThan(50);
  });

  it("stays within the server's own cap, read from the backend rather than restated", () => {
    // A client that batches above PUSH_MAX_BATCH_SIZE gets SYNC_BATCH_TOO_LARGE
    // and the whole batch fails, so this is a real cross-cutting contract and
    // not a style preference. Read from the schema so raising one side without
    // the other fails here instead of in a shop.
    const schema = readFileSync("../backend/src/modules/sync/sync.schema.js", "utf8");
    const cap = /PUSH_MAX_BATCH_SIZE\s*=\s*(\d+)/.exec(schema);
    expect(cap, "PUSH_MAX_BATCH_SIZE is no longer a plain literal; update this guard").not.toBeNull();
    expect(SYNC_BATCH_SIZE).toBeLessThanOrEqual(Number(cap![1]));
  });

  it("leaves room under the API's 2 MB body limit", () => {
    // Operations are not the same size — a bill with forty lines dwarfs a
    // product create — so the count alone cannot keep a request legal.
    const appSource = readFileSync("../backend/src/app.js", "utf8");
    expect(appSource).toContain('express.json({ limit: "2mb" })');
    expect(SYNC_BATCH_MAX_BYTES).toBeLessThan(2 * 1024 * 1024);
  });

  it("would carry the whole catalog load in a handful of requests", () => {
    // 560 products + one audit row each + one summary per commit batch.
    const auditRowsPerProduct = 1;
    const commitBatches = Math.ceil(KIRANA_STARTER_CATALOG_COUNT / 40);
    const queued = KIRANA_STARTER_CATALOG_COUNT * (1 + auditRowsPerProduct) + commitBatches;
    expect(queued).toBeGreaterThan(1_000);
    expect(Math.ceil(queued / SYNC_BATCH_SIZE)).toBeLessThanOrEqual(6);
  });
});

describe("a backlog drains inside one cycle", () => {
  it("keeps pushing while batches are landing", async () => {
    const passes = [
      outcome({ pushed: 200, skipped: 934 }),
      outcome({ pushed: 200, skipped: 734 }),
      outcome({ pushed: 200, skipped: 534 }),
      outcome({ pushed: 200, skipped: 334 }),
      outcome({ pushed: 200, skipped: 134 }),
      outcome({ pushed: 134, skipped: 0 }),
      outcome(),
    ];
    let call = 0;
    const result = await drainPendingOutboxOperations(async () => passes[call++]);

    expect(result.pushed, "the whole 1,134-row queue, not one batch of it").toBe(1_134);
    expect(call, "one pass per batch plus the empty one that ends it").toBe(7);
  });

  it("reports what is still stuck, not the sum of every pass's backlog", () => {
    // `skipped` is a snapshot of what could not be prepared on a pass. On the
    // first pass of a large backlog that is everything over the batch limit, so
    // adding them up would report thousands of skips for a queue that drained
    // perfectly.
    const source = readFileSync("src/features/core/sync/sync-push.ts", "utf8");
    expect(source).toContain("skipped = result.skipped;");
    expect(source).not.toContain("skipped += result.skipped");
  });

  it("stops when a pass moves nothing, rather than spinning", async () => {
    let call = 0;
    const result = await drainPendingOutboxOperations(async () => {
      call += 1;
      return outcome({ skipped: 12 });
    });
    expect(call).toBe(1);
    expect(result.pushed).toBe(0);
    expect(result.skipped).toBe(12);
  });

  it("hands a failure back to the scheduler instead of retrying it faster", async () => {
    // A rejected row is already FAILED and a transient one already carries its
    // own defer. Looping on either would only burn attempts.
    let call = 0;
    const result = await drainPendingOutboxOperations(async () => {
      call += 1;
      return outcome({ pushed: 199, failed: 1 });
    });
    expect(call).toBe(1);
    expect(result.pushed).toBe(199);
    expect(result.failed).toBe(1);
  });

  it("stops on a conflict for the same reason", async () => {
    let call = 0;
    const result = await drainPendingOutboxOperations(async () => {
      call += 1;
      return outcome({ pushed: 5, conflicts: 2 });
    });
    expect(call).toBe(1);
    expect(result.conflicts).toBe(2);
  });

  it("is bounded, so a queue that never shrinks costs one cycle and not a wedged tab", async () => {
    let call = 0;
    const result = await drainPendingOutboxOperations(async () => {
      call += 1;
      return outcome({ pushed: 1 });
    });
    expect(call).toBeLessThanOrEqual(40);
    expect(result.pushed).toBe(call);
  });
});

describe("what the sizing must account for", () => {
  const source = readFileSync("src/features/core/sync/sync-push.ts", "utf8");

  it("measures UTF-8 bytes, because the catalog is half Devanagari", () => {
    // Every starter-catalog row carries Hindi aliases, where one character is
    // three UTF-8 bytes but one UTF-16 unit. Sizing with `.length` would
    // undercount those threefold and send a request the 2 MB limit rejects.
    expect(source).toContain("utf8.encode(json).length");
    const alias = "आटा";
    expect(new TextEncoder().encode(alias).length).toBeGreaterThan(alias.length);
  });

  it("never lets one oversized row wedge the queue behind it", () => {
    expect(source).toContain("if (prepared.length > 0 && bytes + size > maxBytes)");
  });
});

describe("the local write is not quadratic", () => {
  it("reads the products table only when a row targets an existing product", () => {
    // The catalog arrives as fourteen create-only batches. Reading every product
    // per batch scanned a table each preceding batch had just grown.
    const source = readFileSync("src/features/core/products/local-actions.ts", "utf8");
    expect(source).toContain('const hasUpdates = operations.some((operation) => operation.action === "update");');
    expect(source).toContain('hasUpdates ? await offlineDB.getAll<Product>("products") : []');
  });
});

describe("the list caches are rebuilt once, not once per batch", () => {
  const loader = readFileSync("src/features/core/products/starter-catalog/load-starter-catalog.ts", "utf8");
  const actions = readFileSync("src/features/core/products/local-actions.ts", "utf8");

  it("hands the rebuild to the caller that owns the loop", () => {
    expect(actions).toContain("export async function refreshProductCaches()");
    expect(actions).toContain("if (!options.deferCacheRefresh) await refreshProductCaches();");
    expect(loader).toContain("{ deferCacheRefresh: true }");
  });

  it("still rebuilds after a cancelled load, which has committed whole batches", () => {
    // The abort check returns from inside the loop, so the rebuild has to be in a
    // `finally` or a stopped load leaves the product list showing stale contents.
    expect(loader).toContain("} finally {");
    expect(loader).toContain("if (created > 0) await refreshProductCaches();");
  });

  it("leaves the single-file import path rebuilding as it always did", () => {
    // ImportProductsDialog imports in one call, so the default must stay "refresh".
    const dialog = readFileSync("src/features/core/products/pages/components/ImportProductsDialog.tsx", "utf8");
    expect(dialog).not.toContain("deferCacheRefresh");
  });

  it("avoids work that grew with every batch", () => {
    // The rebuild reads the whole products table and re-serialises both list
    // caches in full. Per batch that is a pass over a table each previous batch
    // had just grown — the classic quadratic — to produce a cache only the last
    // pass's version survives.
    const items = KIRANA_STARTER_CATALOG_COUNT;
    const batch = 40;
    const batches = Math.ceil(items / batch);

    let rowsReadBefore = 0;
    for (let done = batch; done <= items; done += batch) rowsReadBefore += done;
    const clonesBefore = rowsReadBefore * 2; // two caches, each written whole

    const rowsReadAfter = items;
    const clonesAfter = items * 2;

    expect(batches).toBe(14);
    expect(rowsReadBefore).toBeGreaterThan(4_000);
    expect(rowsReadBefore / rowsReadAfter).toBeGreaterThan(7);
    expect(clonesBefore - clonesAfter).toBeGreaterThan(7_000);
  });
});
