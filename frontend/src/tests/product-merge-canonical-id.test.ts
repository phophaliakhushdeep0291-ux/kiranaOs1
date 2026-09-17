import { describe, expect, it } from "vitest";
import { mergeProducts } from "@/features/core/products/queries";
import type { Product } from "@/types/api";

/**
 * A product the device created exists twice for a moment: under the id the device
 * minted, and under the id the server answered with. `clientProductId` ties them
 * together, and mergeProducts already collapses them into one row for display.
 *
 * What it did NOT do was choose an id. Merging is last-write-wins on every field,
 * the local twin is added second, and `id` went the same way — so the single
 * merged row carried the DEVICE-minted id. cacheProducts then wrote that row to
 * IndexedDB under that id, re-creating the row sync had just deleted, while the
 * server row sat there under its own. One product, two rows; a 560-item catalogue
 * import left 334 pairs and an SKU tile reading 565 for a 560-product shop.
 *
 * Display dedup is why it hid for so long: the grid and the search showed one
 * product the whole time.
 */
const product = (fields: Record<string, unknown>) => fields as unknown as Product;

describe("mergeProducts keeps the server's id", () => {
  const serverRow = product({ id: "cmu5server123", name: "Loose Toor Dal", clientProductId: "product_abc", sync_status: "synced", stockBaseQty: 48000 });
  const localTwin = product({ id: "product_abc", name: "Loose Toor Dal", sync_status: "pending_sync", stockBaseQty: 50000 });

  it("collapses a local twin into one row under the SERVER id", () => {
    const merged = mergeProducts([serverRow], [localTwin]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("cmu5server123");
  });

  it("still takes the local row's pending fields — only the id is protected", () => {
    const merged = mergeProducts([serverRow], [localTwin]);
    // The local edit is what the shopkeeper last did and has not synced yet.
    expect((merged[0] as unknown as Record<string, unknown>).stockBaseQty).toBe(50000);
    expect((merged[0] as unknown as Record<string, unknown>).sync_status).toBe("pending_sync");
  });

  it("holds when the rows arrive the other way round", () => {
    const merged = mergeProducts([localTwin], [serverRow], true);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("cmu5server123");
  });

  it("leaves a purely local product alone — it has no server id to prefer", () => {
    const localOnly = product({ id: "product_never_synced", name: "New Item", sync_status: "pending_sync" });
    const merged = mergeProducts([], [localOnly], true);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("product_never_synced");
  });

  it("keeps clientProductId even when the twin carries the key as undefined", () => {
    // The link is the only thing identifying a superseded twin, so the cleanup in
    // cacheProducts cannot find one without it. A spread lets a present-but-undefined
    // key win, which erased the link and left the orphan permanently unidentifiable.
    const twinWithBlankLink = product({ id: "product_abc", name: "Loose Toor Dal", sync_status: "pending_sync", clientProductId: undefined });
    const merged = mergeProducts([serverRow], [twinWithBlankLink]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("cmu5server123");
    expect((merged[0] as unknown as Record<string, unknown>).clientProductId).toBe("product_abc");
  });

  it("does not confuse two genuinely different products", () => {
    const other = product({ id: "cmu5other999", name: "Chana Dal", sync_status: "synced" });
    const merged = mergeProducts([serverRow, other], [localTwin]);
    expect(merged).toHaveLength(2);
    expect(merged.map((row) => row.id).sort()).toEqual(["cmu5other999", "cmu5server123"]);
  });
});
