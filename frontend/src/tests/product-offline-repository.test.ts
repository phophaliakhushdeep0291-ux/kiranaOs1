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

  it("does not retain stale synced rows after a successful empty server response", () => {
    expect(mergeProducts([], [product("server_1", "Removed", { sync_status: "synced" })])).toEqual([]);
  });
});
