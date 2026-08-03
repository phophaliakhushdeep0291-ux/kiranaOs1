import { describe, expect, it } from "vitest";
import { mergeCustomers } from "@/features/core/customers/queries";
import type { Customer } from "@/types/api";

function customer(id: string, name: string, extra: Record<string, unknown> = {}): Customer {
  return { id, name, mobile: null, type: "regular", ...extra } as Customer;
}

describe("customer local-first repository", () => {
  it("restores synced IndexedDB customers after an offline restart", () => {
    const rows = mergeCustomers([], [customer("server_1", "Cached", { sync_status: "synced" })], true);
    expect(rows).toEqual([expect.objectContaining({ id: "server_1", name: "Cached" })]);
  });

  it("keeps a locally created customer when fresh server data arrives", () => {
    const rows = mergeCustomers(
      [customer("server_1", "Server")],
      [customer("local_1", "Offline", { sync_status: "pending_sync" })],
    );
    expect(rows.map((row) => row.id)).toEqual(["server_1", "local_1"]);
  });

  it("overlays a pending udhar balance onto the mapped server customer", () => {
    const rows = mergeCustomers(
      [customer("server_1", "Ramesh", { udharAmount: 300 })],
      [customer("local_1", "Ramesh", { server_id: "server_1", udharAmount: 150, sync_status: "pending_sync" })],
    );
    expect(rows).toEqual([expect.objectContaining({ id: "local_1", udharAmount: 150 })]);
  });

  it("does not resurrect a pending local deletion from the server response", () => {
    const rows = mergeCustomers(
      [customer("server_1", "Deleted")],
      [customer("server_1", "Deleted", { deleted_at: new Date().toISOString(), sync_status: "pending_sync" })],
    );
    expect(rows).toEqual([]);
  });
});
