import { describe, expect, it } from "vitest";
import { countLiveRows } from "@/features/core/settings/merchant-setup-state";
import { mergeProducts } from "@/features/core/products/queries";
import type { Product } from "@/types/api";

/**
 * The readiness summary promises "actual local counts, not demo numbers", and was
 * the one screen contradicting the catalogue.
 *
 * Driving a fresh shop end to end: register, load the 560-item starter catalogue,
 * sync. The catalogue screen said 560 and the readiness summary said 625. Both read
 * the same table; only the catalogue collapsed each product's server echo onto the
 * device row that produced it. The 65 extra rows were echoes still sitting beside
 * their local twins, which is the normal state between a push and the pull that
 * confirms it.
 */

const product = (over: Partial<Product> & Record<string, unknown>) => over as unknown as Product;

describe("countLiveRows", () => {
  it("ignores a deleted row under either spelling of the tombstone", () => {
    expect(countLiveRows([
      { id: "a" },
      { id: "b", deleted_at: "2026-09-17T12:00:00.000Z" },
      { id: "c", deletedAt: "2026-09-17T12:00:00.000Z" },
    ])).toBe(1);
  });

  it("ignores a local twin already merged into its server echo", () => {
    expect(countLiveRows([
      { id: "server-1" },
      { id: "local-1", merged_into_id: "server-1" },
      { id: "local-2", mergedIntoId: "server-1" },
    ])).toBe(1);
  });

  it("counts an ordinary unsynced row, which is a real thing the shop has", () => {
    // Offline-first: a row that has never reached the server is still stock on the
    // shelf. Only tombstones and merged twins are excluded.
    expect(countLiveRows([{ id: "local-1", sync_status: "pending_sync" }])).toBe(1);
  });

  it("survives a malformed row rather than counting it", () => {
    expect(countLiveRows([null, undefined, "nonsense", 7, { id: "a" }])).toBe(1);
  });

  it("counts nothing in an empty table", () => {
    expect(countLiveRows([])).toBe(0);
  });
});

describe("the readiness summary agrees with the catalogue", () => {
  it("counts one product, not two, while its server echo is still arriving", () => {
    // Exactly the shape observed: the echo carries the device's id as
    // clientProductId, which is the only link between the two rows.
    const rows = [
      product({ id: "product_uuid-1", local_id: "product_uuid-1", name: "Aashirvaad Atta 1kg", sync_status: "pending_sync" }),
      product({ id: "cmu5if91j001w", clientProductId: "product_uuid-1", name: "Aashirvaad Atta 1kg", sync_status: "synced" }),
    ];
    expect(rows.length).toBe(2);
    expect(countLiveRows(mergeProducts([], rows, true))).toBe(1);
  });

  it("still counts two genuinely different products", () => {
    const rows = [
      product({ id: "product_uuid-1", name: "Atta 1kg" }),
      product({ id: "product_uuid-2", name: "Atta 5kg" }),
    ];
    expect(countLiveRows(mergeProducts([], rows, true))).toBe(2);
  });
});
