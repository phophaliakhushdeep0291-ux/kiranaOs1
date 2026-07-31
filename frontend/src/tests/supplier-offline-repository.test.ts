import { describe, expect, it } from "vitest";
import { mergeSuppliers } from "@/features/suppliers/queries";
import type { Supplier } from "@/types/api";

function supplier(id: string, name: string, extra: Record<string, unknown> = {}): Supplier {
  return { id, name, mobile: null, address: null, ...extra } as Supplier;
}

describe("supplier local-first repository", () => {
  it("retains pending and demo suppliers when the server returns an empty list", () => {
    const rows = mergeSuppliers([], [
      supplier("local_1", "Pending", { sync_status: "pending_sync" }),
      supplier("demo_1", "Demo", { demo_data: true, sync_status: "synced" }),
      supplier("stale_server_row", "Stale", { sync_status: "synced" }),
    ]);

    expect(rows.map((row) => row.id)).toEqual(["demo_1", "local_1"]);
  });

  it("lets an unsynced device edit override the matching server row", () => {
    const rows = mergeSuppliers(
      [supplier("supplier_1", "Old name")],
      [supplier("supplier_1", "New name", { sync_status: "pending_sync" })],
    );

    expect(rows).toEqual([expect.objectContaining({ id: "supplier_1", name: "New name" })]);
  });

  it("does not resurrect locally deleted suppliers", () => {
    const rows = mergeSuppliers(
      [supplier("supplier_1", "Server supplier")],
      [supplier("supplier_1", "Deleted supplier", { deleted_at: new Date().toISOString(), sync_status: "pending_sync" })],
    );

    expect(rows).toEqual([]);
  });
});
