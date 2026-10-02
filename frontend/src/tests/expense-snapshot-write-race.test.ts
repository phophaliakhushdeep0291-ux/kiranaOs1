import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  begin: null as null | (() => void),
}));
vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => ({ tenant_id: "shop", store_id: "shop", device_id: "device" }),
  nowIso: () => "2026-10-02T06:00:00.000Z",
}));

import { dexieDB, offlineDB } from "@/lib/offline/db";
import { refreshServerExpenses } from "@/features/core/expenses/local-actions";
import type { Expense } from "@/types/api";

const scope = { tenant_id: "shop", store_id: "shop", device_id: "device" };
function expense(extra: Record<string, unknown> = {}) {
  return { id: "expense-1", ...scope, server_id: "expense-1", locationId: "branch-a", spentAt: "2026-10-02T05:00:00Z", title: "Server copy", amount: 100, version: 1, sync_status: "synced", ...extra };
}
const refresh = () => refreshServerExpenses(async () => [expense() as unknown as Expense], { locationId: "branch-a" });

beforeEach(() => {
  vi.restoreAllMocks();
  state.rows = [expense()];
  state.begin = null;
  vi.spyOn(offlineDB, "init").mockResolvedValue(undefined);
  vi.spyOn(offlineDB, "getAll").mockImplementation(async () => state.rows.map((row) => ({ ...row })) as never);
  const table = {
    where: () => ({ equals: () => ({ toArray: async () => state.rows.map((row) => ({ ...row })) }) }),
    bulkDelete: async (ids: string[]) => { state.rows = state.rows.filter((row) => !ids.includes(String(row.id))); },
    bulkPut: async (rows: Array<Record<string, unknown>>) => {
      for (const row of rows) state.rows = [...state.rows.filter((current) => current.id !== row.id), row];
    },
  };
  vi.spyOn(dexieDB, "table").mockReturnValue(table as never);
  // Exercise the real snapshot method with a write arriving just before its
  // transaction. The table fixture supplies storage, not reconciliation logic.
  vi.spyOn(dexieDB, "transaction").mockImplementation(((...args: unknown[]) => {
    state.begin?.();
    return (args.at(-1) as () => Promise<unknown>)();
  }) as never);
});

describe("expense snapshot writes racing local work", () => {
  it.each(["pending_sync", "syncing", "failed", "conflict", "local_only"])("keeps a newer %s edit instead of the server copy", async (status) => {
    state.begin = () => { state.rows = [expense({ title: "Local edit", amount: 225, version: 2, sync_status: status })]; };
    await refresh();
    expect(state.rows).toEqual([expect.objectContaining({ title: "Local edit", amount: 225, version: 2, sync_status: status })]);
  });

  it.each(["pending_sync", "synced"])("does not resurrect a %s deletion that lands before the transaction", async (status) => {
    state.begin = () => { state.rows = [expense({ deleted_at: "2026-10-02T05:59:00Z", sync_status: status, version: 2 })]; };
    await refresh();
    expect(state.rows).toEqual([expect.objectContaining({ deleted_at: "2026-10-02T05:59:00Z", sync_status: status })]);
  });

  it("protects a pending local alias as well as its canonical server ID", async () => {
    state.begin = () => { state.rows = [expense({ id: "local-1", local_id: "local-1", amount: 225, sync_status: "pending_sync" })]; };
    await refresh();
    expect(state.rows).toEqual([expect.objectContaining({ id: "local-1", amount: 225, sync_status: "pending_sync" })]);
  });

  it("still replaces covered synced copies and accepts fresh server rows", async () => {
    state.rows = [expense({ id: "deleted-elsewhere", server_id: "deleted-elsewhere" })];
    await refresh();
    expect(state.rows).toEqual([expect.objectContaining({ id: "expense-1", amount: 100, sync_status: "synced" })]);
  });

  it("keeps an edit whose sync completed after the refresh began", async () => {
    state.begin = () => { state.rows = [expense({ amount: 225, version: 2, sync_status: "synced" })]; };
    await refresh();
    expect(state.rows).toEqual([expect.objectContaining({ amount: 225, version: 2, sync_status: "synced" })]);
  });

  it("keeps a new expense whose sync completed after the refresh began", async () => {
    state.rows = [];
    state.begin = () => { state.rows = [expense({ amount: 225, sync_status: "synced" })]; };
    await refresh();
    expect(state.rows).toEqual([expect.objectContaining({ amount: 225, sync_status: "synced" })]);
  });

  it("accepts a newer server amount when the cached expense did not change", async () => {
    await refreshServerExpenses(async () => [expense({ amount: 225 }) as unknown as Expense], { locationId: "branch-a" });
    expect(state.rows).toEqual([expect.objectContaining({ amount: 225, sync_status: "synced" })]);
  });

  it("keeps a newer cache refresh even when both snapshots use version one", async () => {
    state.begin = () => { state.rows = [expense({ amount: 225, updated_at: "2026-10-02T05:59:00Z" })]; };
    await refresh();
    expect(state.rows).toEqual([expect.objectContaining({ amount: 225 })]);
  });

  it("does not prune an expense another refresh moved into the requested window", async () => {
    state.rows = [expense({ spentAt: "2026-04-01T05:00:00Z" })];
    state.begin = () => { state.rows = [expense({ amount: 225, updated_at: "2026-10-02T05:59:00Z" })]; };
    await refreshServerExpenses(async () => [], { locationId: "branch-a", from: "2026-09-01T00:00:00Z" });
    expect(state.rows).toEqual([expect.objectContaining({ amount: 225 })]);
  });
});
