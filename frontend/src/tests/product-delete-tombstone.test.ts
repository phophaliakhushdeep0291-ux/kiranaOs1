import { describe, expect, it } from "vitest";
import { mergeProducts } from "@/features/core/products/queries";
import { withoutDeletedProducts } from "@/features/core/inventory/queries";
import type { InventoryItem } from "@/types/api";
import type { Product } from "@/types/api";

/**
 * Deleting a product that the server still has.
 *
 * Deletion is local-first: the row is tombstoned in IndexedDB and a
 * DELETE_PRODUCT_PENDING goes to the outbox, so until that drains the server's
 * catalogue still lists the product. The list query merges the two, and the
 * tombstone is the only thing in the merge that knows the product is gone. Lose
 * it and the server's live row wins — the product returns to the shelf seconds
 * after it was deleted, and cacheProducts then writes it back over the local
 * deletion, so the resurrection outlives a reload.
 */

function product(id: string, name: string, extra: Record<string, unknown> = {}): Product {
  return { id, name, sellingPrice: 10, stockQuantity: 1, ...extra } as Product;
}

/** What deleteProductLocalFirst leaves in IndexedDB. */
function tombstone(id: string, name: string): Product {
  const now = "2026-09-03T12:00:00.000Z";
  return product(id, name, { deletedAt: now, deleted_at: now, sync_status: "pending_sync" });
}

const isDeleted = (row: Product | undefined) =>
  row != null && (row.deletedAt != null || (row as { deleted_at?: unknown }).deleted_at != null);

describe("deleting a product the server has not dropped yet", () => {
  it("keeps the tombstone when nothing in the local stage matches it", () => {
    // Stage one of useListProducts: cache + IndexedDB, no server rows at all.
    // Both readers strip deleted rows, so the tombstone arrives here alone.
    const stageOne = mergeProducts([], [tombstone("server_1", "Ashirvaad Atta")], true);
    expect(stageOne.map((row) => row.id)).toEqual(["server_1"]);
    expect(isDeleted(stageOne[0])).toBe(true);
  });

  it("does not put the product back when the server still lists it", () => {
    // The whole pipeline: the delete emptied the cache, the DB reader filtered the
    // tombstone out of `fromDB`, and the server has not seen the delete yet.
    const liveCached: Product[] = [];
    const fromDB: Product[] = [];
    const tombstones = [tombstone("server_1", "Ashirvaad Atta")];
    const fresh = [product("server_1", "Ashirvaad Atta")];

    const localRows = mergeProducts([], [...liveCached, ...fromDB, ...tombstones], true);
    const merged = mergeProducts(fresh, localRows);

    expect(merged).toHaveLength(1);
    expect(isDeleted(merged[0])).toBe(true);
  });

  it("suppresses the server row through a mapped server identity", () => {
    // A product created on this device, then deleted: the tombstone is keyed by
    // the local id and only server_id ties it to the row the server answers with.
    const local = tombstone("product_8a3fce21", "Tata Salt");
    (local as Product & { server_id?: string }).server_id = "server_9";
    const merged = mergeProducts([product("server_9", "Tata Salt")], [local]);
    expect(merged).toHaveLength(1);
    expect(isDeleted(merged[0])).toBe(true);
  });

  it("still drops a synced row the server no longer returns", () => {
    // The neighbouring rule this must not disturb: an ordinary synced row absent
    // from the server's answer is gone, and is not resurrected by being local.
    expect(mergeProducts([], [product("server_1", "Removed", { sync_status: "synced" })])).toEqual([]);
  });

  it("leaves products the shop did not delete alone", () => {
    const merged = mergeProducts(
      [product("server_1", "Ashirvaad Atta"), product("server_2", "Tata Salt")],
      [tombstone("server_1", "Ashirvaad Atta")],
    );
    expect(merged.filter((row) => !isDeleted(row)).map((row) => row.id)).toEqual(["server_2"]);
  });

  /**
   * The stock screen takes the server's inventory wholesale, so it needed the
   * same rule: a product deleted from the catalogue was still sitting in stock
   * until the delete synced, and every refresh cached it again.
   */
  it("keeps a deleted product out of the stock list the server still returns", () => {
    const stock = [
      { id: "server_1", productId: "server_1", name: "Ashirvaad Atta" },
      { id: "server_2", productId: "server_2", name: "Tata Salt" },
    ] as unknown as InventoryItem[];
    const rows = withoutDeletedProducts(stock, new Set(["server_1"]));
    expect(rows.map((row) => row.id)).toEqual(["server_2"]);
  });

  it("matches the stock row through the local id a device-made product was minted with", () => {
    const stock = [{ id: "server_9", productId: "server_9", name: "Tata Salt" }] as unknown as InventoryItem[];
    // The tombstone carries both identities; either must suppress the row.
    expect(withoutDeletedProducts(stock, new Set(["product_8a3fce21", "server_9"]))).toEqual([]);
  });

  it("leaves the stock list untouched when nothing was deleted", () => {
    const stock = [{ id: "server_1", productId: "server_1", name: "Ashirvaad Atta" }] as unknown as InventoryItem[];
    expect(withoutDeletedProducts(stock, new Set())).toBe(stock);
  });
});
