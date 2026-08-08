/**
 * Capture-on-first-scan at the till.
 *
 * The starter catalog ships every barcode blank on purpose — a real EAN-13 for a specific
 * SKU cannot be invented, and a wrong one silently bills the wrong item. So real codes
 * arrive by being scanned: an unknown code opens a sheet, the cashier says which item it
 * is, and the code binds. These tests pin the rules that make that safe.
 */
import { readFileSync } from "node:fs";
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
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (storeName: string) => (storeName === "products" ? mockState.products : [])),
    put: vi.fn(async () => undefined),
    transaction: vi.fn(async (_tables: string[], callback: (tx: {
      put: (storeName: string, value: unknown) => Promise<void>;
      enqueueOutboxOperation: (event: unknown) => Promise<void>;
    }) => Promise<unknown>) => {
      const tx = {
        put: vi.fn(async (storeName: string, value: unknown) => {
          const bucket = mockState.committed[storeName as keyof typeof mockState.committed];
          if (bucket) bucket.push(value as Record<string, unknown>);
        }),
        putMany: vi.fn(async () => undefined),
        // The real outbox is a Dexie table keyed on clientEventId, so enqueuing the same
        // op id twice overwrites rather than appends. Model that, because it is exactly
        // the property "syncs once, does not duplicate on replay" depends on.
        enqueueOutboxOperation: vi.fn(async (event: unknown) => {
          const row = event as Record<string, unknown>;
          const existing = mockState.committed.sync_outbox
            .findIndex((queued) => queued.clientEventId === row.clientEventId);
          if (existing >= 0) mockState.committed.sync_outbox[existing] = row;
          else mockState.committed.sync_outbox.push(row);
        }),
        setSetting: vi.fn(async () => undefined),
      };
      return callback(tx);
    }),
  },
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_scan_${++mockState.idCounter}`),
  emitLocalDataChanged: vi.fn(),
  removeCachedListItem: vi.fn(),
  upsertCachedListItem: vi.fn(),
  readInstantCache: vi.fn(() => []),
  writeInstantCache: vi.fn(),
}));

import {
  ProductBarcodeBindError,
  bindProductBarcodeLocalFirst,
  findLocalBarcodeOwner,
} from "@/features/core/products/local-actions";
import {
  applyBindSheetPick,
  looksLikeScannedBarcode,
  resolveScanOutcome,
} from "@/features/core/billing/pages/billing-calculations";

function product(overrides: Partial<Product> & { id: string; name: string }): Product {
  return {
    category: "grocery",
    unit: "piece",
    displayUnit: "piece",
    baseUnit: "piece",
    rateUnit: "piece",
    barcode: null,
    sku: null,
    stockBaseQty: 10,
    defaultPricePerRateUnit: 20,
    sellingPrice: 20,
    ...overrides,
  } as unknown as Product;
}

const parleG = product({ id: "p_parle", name: "Parle-G" });
const goodDay = product({ id: "p_goodday", name: "Good Day", barcode: "8901234567890" });

beforeEach(() => {
  mockState.idCounter = 0;
  mockState.products = [];
  mockState.committed = { products: [], local_audit_logs: [], sync_outbox: [] };
});

describe("recognising a scan", () => {
  it("treats a scanned code that matches nothing as a new barcode", () => {
    // This is what opens the bind sheet. Before, it dead-ended on "no results".
    const outcome = resolveScanOutcome("8901234567890", [], [parleG]);
    expect(outcome).toEqual({ kind: "unknown-code", code: "8901234567890" });
  });

  it("does not mistake a half-typed product name for a barcode", () => {
    // A cashier typing "sug" and hitting Enter must not be asked to bind anything.
    expect(resolveScanOutcome("sug", [], [parleG])).toEqual({ kind: "none" });
    expect(resolveScanOutcome("parle g", [], [parleG])).toEqual({ kind: "none" });
    expect(looksLikeScannedBarcode("sugar")).toBe(false);
    expect(looksLikeScannedBarcode("8901234567890")).toBe(true);
  });

  it("resolves a known code against the whole catalogue, not just the visible grid", () => {
    // The grid is narrowed by the category chips and capped at 30 rows. Resolving only
    // against it would call a code the shop already owns "unknown", and offer the cashier
    // a bind the service is then obliged to reject.
    const outcome = resolveScanOutcome("8901234567890", [], [parleG, goodDay]);
    expect(outcome).toEqual({ kind: "match", product: goodDay });
  });

  it("still adds the only product left on screen when a name is typed", () => {
    const outcome = resolveScanOutcome("parle", [parleG], [parleG, goodDay]);
    expect(outcome).toEqual({ kind: "match", product: parleG });
  });

  it("recognises a known code in a shop that owns a single product", () => {
    // A brand-new shop. The catalogue-wide lookup must key off the code itself, never off
    // "there is only one product", or that shop's one real barcode reads as unknown.
    expect(resolveScanOutcome("8901234567890", [], [goodDay])).toEqual({ kind: "match", product: goodDay });
    expect(resolveScanOutcome("8909999999999", [], [goodDay])).toEqual({ kind: "unknown-code", code: "8909999999999" });
  });

  it("matches a code stored in the sku column", () => {
    const skuOnly = product({ id: "p_sku", name: "Atta", sku: "8901111111111" });
    expect(resolveScanOutcome("8901111111111", [], [parleG, skuOnly])).toEqual({ kind: "match", product: skuOnly });
  });
});

describe("the sheet is wired to the scan path", () => {
  // There is no DOM test environment in this project, so the component wiring is pinned
  // by source: the behaviour it guards (an unknown code opening the sheet rather than
  // dead-ending on "no results") is the whole point of the feature.
  const source = readFileSync("src/features/core/billing/pages/components/BillingSearch.tsx", "utf8");

  it("opens the sheet on an unknown code from both the keyboard and the camera", () => {
    expect(source).toContain('if (outcome.kind === "unknown-code")');
    expect(source).toContain("openBindSheetIfUnknownRef.current(value)");
    expect(source).toContain('handleScannedTerm(search, "usb")');
  });

  it("routes the pick through the shared bind/skip decision", () => {
    expect(source).toContain("applyBindSheetPick({");
    expect(source).toContain("skip: skipBinding");
  });

  it("offers create-new and skip without leaving the sheet blocking", () => {
    expect(source).toContain("onCreateProductWithBarcode(code)");
    expect(source).toContain('data-testid="barcode-bind-skip"');
    expect(source).toContain('event.key === "Escape"');
  });
});

describe("picking an item in the sheet", () => {
  it("binds the code and adds the item in one action", async () => {
    const bind = vi.fn(async () => undefined);
    const add = vi.fn();

    const result = await applyBindSheetPick({ product: parleG, code: "8901234567890", skip: false, bind, add });

    expect(bind).toHaveBeenCalledWith(parleG, "8901234567890");
    expect(add).toHaveBeenCalledWith(parleG);
    expect(result).toEqual({ bound: true, added: true });
  });

  it("skip adds the item and binds nothing", async () => {
    // A cashier with a queue is never made to teach the catalogue before selling.
    const bind = vi.fn(async () => undefined);
    const add = vi.fn();

    const result = await applyBindSheetPick({ product: parleG, code: "8901234567890", skip: true, bind, add });

    expect(bind).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(parleG);
    expect(result).toEqual({ bound: false, added: true });
  });

  it("leaves the cart alone when the code turns out to belong to something else", async () => {
    const bind = vi.fn(async () => {
      throw new ProductBarcodeBindError("PRODUCT_BARCODE_DUPLICATE", 'Barcode 8901234567890 already belongs to "Good Day"');
    });
    const add = vi.fn();

    const result = await applyBindSheetPick({ product: parleG, code: "8901234567890", skip: false, bind, add });

    expect(add).not.toHaveBeenCalled();
    expect(result.bound).toBe(false);
    expect(result.error).toMatch(/Good Day/);
  });
});

describe("binding offline", () => {
  it("writes the product, an audit row and exactly one sync operation", async () => {
    mockState.products = [{ ...parleG }];

    const bound = await bindProductBarcodeLocalFirst("p_parle", "8901234567890");

    expect(bound.barcode).toBe("8901234567890");
    expect(bound.sku).toBe("8901234567890");
    expect(mockState.committed.products).toHaveLength(1);

    const audit = mockState.committed.local_audit_logs[0];
    expect(audit.action).toBe("product_barcode_bound");
    expect(audit.entity_id).toBe("p_parle");
    expect(audit.device_id).toBeDefined();

    const ops = mockState.committed.sync_outbox.filter((op) => op.operation_type === "BIND_PRODUCT_BARCODE");
    expect(ops).toHaveLength(1);
    expect(ops[0].payload).toMatchObject({ productId: "p_parle", barcode: "8901234567890" });
  });

  it("syncs once and does not duplicate on replay", async () => {
    // The same bind queued twice — a double tap, or a retry after a push that never got
    // its ack. The op id is derived from (product, code), so the second enqueue lands on
    // the same outbox row and the server deduplicates it by event id.
    mockState.products = [{ ...parleG }];
    await bindProductBarcodeLocalFirst("p_parle", "8901234567890");

    const firstOp = mockState.committed.sync_outbox.find((op) => op.operation_type === "BIND_PRODUCT_BARCODE");
    expect(firstOp?.clientEventId).toBe("barcode-bind:p_parle:8901234567890");

    // The device now holds the bound product, exactly as a reload would rehydrate it.
    mockState.products = [{ ...parleG, barcode: "8901234567890", sku: "8901234567890" }];
    await bindProductBarcodeLocalFirst("p_parle", "8901234567890");

    const ops = mockState.committed.sync_outbox.filter((op) => op.operation_type === "BIND_PRODUCT_BARCODE");
    expect(ops).toHaveLength(1);
  });

  it("refuses a code another product already answers to", async () => {
    mockState.products = [{ ...parleG }, { ...goodDay }];

    await expect(bindProductBarcodeLocalFirst("p_parle", "8901234567890")).rejects.toMatchObject({
      code: "PRODUCT_BARCODE_DUPLICATE",
    });
    expect(mockState.committed.sync_outbox).toHaveLength(0);
    expect(mockState.committed.products).toHaveLength(0);
  });

  it("never rebinds a product that already has a code", async () => {
    // Rebinding is an explicit action on the product screen — not something a cashier can
    // do by scanning the wrong packet mid-queue.
    mockState.products = [{ ...parleG, barcode: "8900000000001" }];

    await expect(bindProductBarcodeLocalFirst("p_parle", "8901234567890")).rejects.toMatchObject({
      code: "PRODUCT_BARCODE_ALREADY_SET",
    });
    expect(mockState.committed.sync_outbox).toHaveLength(0);
  });

  it("keeps an sku the shop set itself", async () => {
    mockState.products = [{ ...parleG, sku: "PG-100" }];

    const bound = await bindProductBarcodeLocalFirst("p_parle", "8901234567890");

    expect(bound.barcode).toBe("8901234567890");
    expect(bound.sku).toBe("PG-100");
  });

  it("finds the owner of a code in either the barcode or the sku column", () => {
    // resolveScanMatch() on the till matches both, so a duplicate in either one would
    // make the next scan ambiguous.
    expect(findLocalBarcodeOwner("8901234567890", [parleG, goodDay])?.id).toBe("p_goodday");
    expect(findLocalBarcodeOwner("PG-100", [product({ id: "p_x", name: "X", sku: "PG-100" })])?.id).toBe("p_x");
    expect(findLocalBarcodeOwner("8901234567890", [parleG, goodDay], "p_goodday")).toBeUndefined();
  });
});
