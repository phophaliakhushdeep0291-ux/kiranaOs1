import { describe, expect, it } from "vitest";
import { mergeProducts } from "@/features/core/products/queries";
import type { Product } from "@/types/api";

function product(id: string, name: string, extra: Record<string, unknown> = {}): Product {
  return { id, name, sellingPrice: 10, stockQuantity: 1, ...extra } as Product;
}

describe("product local-first repository", () => {
  it("returns synced IndexedDB products during an offline restart", () => {
    const rows = mergeProducts([], [product("server_1", "Cached product", { sync_status: "synced" })], true);
    expect(rows).toEqual([expect.objectContaining({ id: "server_1", name: "Cached product" })]);
  });

  it("keeps pending local products alongside fresh server products", () => {
    const rows = mergeProducts(
      [product("server_1", "Server product")],
      [product("local_1", "Offline product", { sync_status: "pending_sync" })],
    );
    expect(rows.map((row) => row.id)).toEqual(["server_1", "local_1"]);
  });

  it("applies a pending local edit using its mapped server identity", () => {
    const rows = mergeProducts(
      [product("server_1", "Old name")],
      [product("local_1", "New name", { server_id: "server_1", sync_status: "pending_sync" })],
    );
    expect(rows).toEqual([expect.objectContaining({ id: "local_1", name: "New name", server_id: "server_1" })]);
  });

  /**
   * A just-created product, before its create has been acknowledged.
   *
   * The local row is keyed by the id this device minted; the server answers with
   * its OWN id and echoes the device's back as `clientProductId` — the only thing
   * tying the two together. Without matching on it the same product was added
   * twice, so it appeared twice in the catalogue and both copies were written to
   * IndexedDB, surviving a reload.
   */
  it("collapses a server row onto the local row it was created from", () => {
    const rows = mergeProducts(
      [product("cmt2k3rk", "Ashirvaad Atta", { clientProductId: "product_8a3fce21" })],
      [product("product_8a3fce21", "Ashirvaad Atta", { sync_status: "pending_sync" })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Ashirvaad Atta");
  });

  it("still separates two genuinely different products", () => {
    const rows = mergeProducts(
      [product("cmt2k3rk", "Ashirvaad Atta", { clientProductId: "product_aaa" })],
      [product("product_bbb", "Tata Salt", { sync_status: "pending_sync" })],
    );
    expect(rows.map((row) => row.name)).toEqual(["Ashirvaad Atta", "Tata Salt"]);
  });

  it("does not retain stale synced rows after a successful empty server response", () => {
    expect(mergeProducts([], [product("server_1", "Removed", { sync_status: "synced" })])).toEqual([]);
  });
});
