import { describe, expect, it } from "vitest";
import { mergeCustomers } from "@/features/core/customers/queries";
import type { Customer } from "@/types/api";

/**
 * A customer created on this device, after sync has acknowledged it.
 *
 * Billing mints the customer locally when a shop types a new name onto an udhar
 * sale, so the row is keyed by an id only this device knows. Sync answers with the
 * server's own id, writes a row that remembers the local one, and drops the echo.
 *
 * Both rows describe one customer, so the merge below matches them — and it used
 * to finish by spreading the echo last, which put the local id, a null server id
 * and "pending_sync" back onto the row. cacheCustomers writes the merge straight
 * into IndexedDB, so that recreated the echo under the local key beside the real
 * row: the same customer twice in the shop's list, one copy pending forever, and
 * it survived a reload.
 */

const row = (o: Record<string, unknown>) => o as unknown as Customer;

const syncedServerRow = () => row({
  id: "srv1", server_id: "srv1", local_id: "loc1",
  name: "Ramesh", mobile: "9876500000", sync_status: "synced",
});
const localEcho = () => row({
  id: "loc1", local_id: "loc1", server_id: null,
  name: "Ramesh", mobile: "9876500000", sync_status: "pending_sync",
});

describe("a customer the server has acknowledged", () => {
  it("is one row, and keeps the server's identity", () => {
    const merged = mergeCustomers([syncedServerRow()], [localEcho()]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("srv1");
    expect((merged[0] as unknown as { server_id: string }).server_id).toBe("srv1");
    expect((merged[0] as unknown as { sync_status: string }).sync_status).toBe("synced");
  });

  it("does not write the echo back under its local id", () => {
    // What cacheCustomers persists: nothing keyed by an id the server never issued.
    const merged = mergeCustomers([syncedServerRow()], [localEcho()]);
    expect(merged.map((r) => r.id)).not.toContain("loc1");
  });

  it("still lets a pending edit to a synced customer win", () => {
    // The echo is overruled only when it has no server id of its own. An offline
    // rename of an already-synced customer must survive the merge.
    const edited = row({
      id: "srv1", server_id: "srv1", local_id: "loc1",
      name: "Ramesh Kumar", mobile: "9876500000", sync_status: "pending_sync",
    });
    const merged = mergeCustomers([syncedServerRow()], [edited]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Ramesh Kumar");
    expect((merged[0] as unknown as { sync_status: string }).sync_status).toBe("pending_sync");
  });

  it("leaves a genuinely offline-only customer alone", () => {
    const offlineOnly = row({ id: "loc2", local_id: "loc2", server_id: null, name: "Sita", sync_status: "pending_sync" });
    const merged = mergeCustomers([syncedServerRow()], [localEcho(), offlineOnly]);
    expect(merged.map((r) => r.id).sort()).toEqual(["loc2", "srv1"]);
  });

  it("keeps two genuinely different customers apart", () => {
    const other = row({ id: "srv2", server_id: "srv2", name: "Geeta", sync_status: "synced" });
    expect(mergeCustomers([syncedServerRow(), other], []).map((r) => r.id)).toEqual(["srv1", "srv2"]);
  });
});
