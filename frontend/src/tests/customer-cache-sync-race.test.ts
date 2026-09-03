import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer } from "@/types/api";

const state = vi.hoisted(() => ({
  rows: [] as Array<Customer & Record<string, unknown>>,
  ledger: [] as Array<Record<string, unknown>>,
  staleMemory: [] as Customer[],
  inTransaction: false,
  failCommit: false,
  writeCache: vi.fn(),
}));
vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (table: string) => {
      expect(state.inTransaction).toBe(true);
      return structuredClone(table === "customer_ledger" ? state.ledger : state.rows);
    }),
    transaction: vi.fn(async (_tables: string[], callback: (tx: unknown) => Promise<unknown>) => {
      state.inTransaction = true;
      let next = structuredClone(state.rows);
      try {
        const result = await callback({ putMany: async (_table: string, rows: Customer[]) => {
          for (const row of rows) {
            next = next.filter((old) => old.id !== row.id);
            next.push(row);
          }
        } });
        if (state.failCommit) throw new Error("commit failed");
        state.rows = next;
        return result;
      } finally { state.inTransaction = false; }
    }),
  },
}));
vi.mock("@/lib/offline/instant-cache", () => ({
  readInstantCache: (key: string, fallback: unknown) => key === "customers" ? state.staleMemory : fallback,
  writeInstantCache: state.writeCache,
}));

import { cacheCustomers } from "@/features/core/customers/queries";

const server = { id: "server-customer", name: "Ramesh", mobile: null, type: "regular", udharAmount: 200 } as Customer;

describe("customer list refresh racing sync acknowledgement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.inTransaction = false;
    state.failCommit = false;
    state.ledger = [];
    state.staleMemory = [{ ...server, id: "local-customer", sync_status: "pending_sync" } as Customer];
    state.rows = [{ ...server, local_id: "local-customer", server_id: server.id, sync_status: "synced" }];
  });

  it("does not resurrect the pre-sync local id from stale memory", async () => {
    const rows = await cacheCustomers([server]);
    expect(rows).toHaveLength(1);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ id: server.id, local_id: "local-customer", server_id: server.id, sync_status: "synced" });
    expect(state.writeCache).toHaveBeenCalledWith("customers", rows);
  });

  it("preserves an edit committed locally before the server response is cached", async () => {
    state.rows[0] = { ...state.rows[0], name: "Updated offline", sync_status: "pending_sync" };
    const rows = await cacheCustomers([server]);
    expect(rows[0].name).toBe("Updated offline");
    expect(state.rows[0].name).toBe("Updated offline");
  });

  it("does not publish a new memory snapshot if the durable cache write fails", async () => {
    state.failCommit = true;
    const original = structuredClone(state.rows);
    await cacheCustomers([server]);
    expect(state.rows).toEqual(original);
    expect(state.writeCache).not.toHaveBeenCalled();
  });

  it("keeps the committed partial-payment remainder while its ledger entry is pending", async () => {
    state.rows[0] = { ...state.rows[0], udharAmount: 125, totalUdhar: 125, balance_derived_from_local_ledger: true };
    state.ledger = [{ id: "payment-ledger", customer_id: "local-customer", type: "PAYMENT", amount: 75, sync_status: "pending_sync" }];
    const rows = await cacheCustomers([server]);
    expect(rows[0].udharAmount).toBe(125);
    expect(state.rows[0].totalUdhar).toBe(125);
  });

  it("accepts a new server balance once there is no pending local movement", async () => {
    state.rows[0] = { ...state.rows[0], udharAmount: 125, totalUdhar: 125, balance_derived_from_local_ledger: true };
    state.ledger = [{ id: "payment-ledger", customer_id: "local-customer", type: "PAYMENT", amount: 75, sync_status: "synced" }];
    const rows = await cacheCustomers([{ ...server, udharAmount: 100, totalUdhar: 100 }]);
    expect(rows[0].udharAmount).toBe(100);
  });
});
