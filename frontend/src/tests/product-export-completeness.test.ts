/**
 * An export must carry the WHOLE catalogue, or it is not a migration tool.
 *
 * The products list query is capped for the screen, and `filterCachedProducts` slices
 * the cached/offline seed to that same `limit`. Reusing the page's rows for the export
 * therefore wrote a short file on any shop with more products than the cap, with
 * nothing in the CSV, the toast or the UI to say a single row had been dropped —
 * silent truncation, in the one feature whose entire job is completeness.
 *
 * The server applies no `take` to /products, so the online path was always complete;
 * offline (or before the first fetch resolves) was not.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  localRows: [] as Array<Record<string, unknown>>,
  serverRows: null as Array<Record<string, unknown>> | null,
}));

vi.mock("@/features/core/products/api", () => ({
  listProducts: vi.fn(async () => {
    if (mockState.serverRows === null) throw new Error("offline");
    return mockState.serverRows;
  }),
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (storeName: string) => (storeName === "products" ? mockState.localRows : [])),
  },
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  readInstantCache: vi.fn(() => []),
  writeInstantCache: vi.fn(),
  instantCacheUpdatedAt: vi.fn(() => 0),
  KEEP_EVERY_ROW: -1,
}));

vi.mock("@/features/core/stores/location-context", () => ({
  getActiveLocationId: vi.fn(() => null),
}));

import { loadProductsForExport } from "@/features/core/products/queries";

/** More than the 1000 the products screen asks for, so a page-sized slice would show. */
const BIG_CATALOGUE = 1200;

const catalogue = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}_${index}`, name: `${prefix} ${index}` }));

describe("product export covers the whole catalogue", () => {
  beforeEach(() => {
    mockState.localRows = [];
    mockState.serverRows = null;
  });

  it("returns every product the server has", async () => {
    mockState.serverRows = catalogue(BIG_CATALOGUE, "server");

    await expect(loadProductsForExport()).resolves.toHaveLength(BIG_CATALOGUE);
  });

  it("returns every LOCAL product when there is no network, not one screenful", async () => {
    // The regression: falling back to the page's list here capped the file at 1000.
    mockState.serverRows = null;
    mockState.localRows = catalogue(BIG_CATALOGUE, "local");

    await expect(loadProductsForExport()).resolves.toHaveLength(BIG_CATALOGUE);
  });

  it("still leaves deleted products out of the file", async () => {
    mockState.serverRows = null;
    mockState.localRows = [
      { id: "p1", name: "Kept" },
      { id: "p2", name: "Binned", deletedAt: "2026-08-01T00:00:00.000Z" },
      { id: "p3", name: "Binned too", deleted_at: "2026-08-01T00:00:00.000Z" },
    ];

    const rows = await loadProductsForExport();

    expect(rows.map((row) => row.name)).toEqual(["Kept"]);
  });
});
