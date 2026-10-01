import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Expense } from "@/types/api";

type Row = Expense & Record<string, unknown>;
const state = vi.hoisted(() => ({ rows: [] as Row[] }));
vi.mock("@/lib/offline/db", () => ({ offlineDB: {
  getAll: vi.fn(async () => state.rows.map((row) => ({ ...row }))),
  // Mirrors the real primitive: unsynced rows always survive, matching synced
  // rows are removed, then the server rows are written.
  replaceSyncedSnapshot: vi.fn(async (_table: string, values: Row[], _scope: unknown, shouldReconcile: (row: Row) => boolean) => {
    const keep = new Set(["pending_sync", "syncing", "failed", "conflict", "local_only"]);
    state.rows = state.rows.filter((row) => keep.has(String(row.sync_status ?? "synced")) || !shouldReconcile(row));
    for (const value of values) state.rows = [...state.rows.filter((row) => row.id !== value.id), value];
  }),
} }));
vi.mock("@/features/core/sync/outbox", () => ({ buildOutboxOperation: (input: unknown) => input }));
vi.mock("@/lib/offline/context", () => ({ getOfflineScope: () => ({ tenant_id: "shop", store_id: "store", device_id: "device" }), nowIso: () => "2026-09-30T10:00:00Z" }));
vi.mock("@/lib/offline/instant-cache", () => ({ createLocalId: () => "local", emitLocalDataChanged: vi.fn() }));
vi.mock("@/features/core/stores/location-context", () => ({ getActiveLocationId: () => "branch-a" }));
import { mergeExpenseSnapshots, refreshServerExpenses } from "@/features/core/expenses/local-actions";
import { expenseOverview } from "@/features/core/expenses/overview";

const at = new Date("2026-09-30T12:00:00Z");
function serverRow(id: string, extra: Partial<Row> = {}): Row {
  return { id, title: id, amount: 100, category: "Transport", paymentMode: "cash", status: "paid", recurringInterval: "none", spentAt: "2026-09-30T06:00:00Z", locationId: "branch-a", ...extra } as Row;
}
function cached(id: string, extra: Partial<Row> = {}): Row {
  return { ...serverRow(id), server_id: id, deleted_at: null, version: 1, sync_status: "synced", ...extra } as Row;
}
const ids = () => state.rows.map((row) => row.id).sort();

beforeEach(() => { state.rows = []; });

describe("server expense refresh on a device that sync pull skips", () => {
  it("drops a cached expense deleted elsewhere, from the list and the totals", async () => {
    state.rows = [cached("kept"), cached("deleted-on-owner-phone")];
    const before = expenseOverview(mergeExpenseSnapshots([], state.rows), at).today;
    expect(before).toBe(200);
    const server = [serverRow("kept")];
    await refreshServerExpenses(async () => server, { locationId: "branch-a" });
    expect(ids()).toEqual(["kept"]);
    expect(expenseOverview(mergeExpenseSnapshots(server, state.rows), at).today).toBe(100);
  });

  it("keeps work the server cannot have seen yet", async () => {
    state.rows = [
      cached("queued", { server_id: undefined, sync_status: "pending_sync" }),
      cached("local-tombstone", { deleted_at: "2026-09-30T08:00:00Z" }),
      cached("retired-local-copy", { merged_into_id: "kept" }),
      cached("never-on-server", { server_id: undefined }),
    ];
    await refreshServerExpenses(async () => [], { locationId: "branch-a" });
    expect(ids()).toEqual(["local-tombstone", "never-on-server", "queued", "retired-local-copy"]);
  });

  it("keeps a row whose sync landed while the list was in flight", async () => {
    state.rows = [cached("racing", { sync_status: "syncing" }), cached("edited", { version: 1 })];
    await refreshServerExpenses(async () => {
      // The server answered before these writes; the device records them after.
      state.rows = [cached("racing"), cached("edited", { version: 2 })];
      return [];
    }, { locationId: "branch-a" });
    expect(ids()).toEqual(["edited", "racing"]);
  });

  it("only judges rows the request covered: its branch and its date window", async () => {
    state.rows = [
      cached("other-branch", { locationId: "branch-b" }),
      cached("before-window", { spentAt: "2026-04-30T18:29:59Z" }),
      cached("inside-window", { spentAt: "2026-04-30T18:30:00Z" }),
    ];
    await refreshServerExpenses(async () => [], { locationId: "branch-a", from: "2026-04-30T18:30:00.000Z" });
    expect(ids()).toEqual(["before-window", "other-branch"]);
  });

  it("prunes nothing when the request's branch is unknown", async () => {
    state.rows = [cached("unknown-scope")];
    await refreshServerExpenses(async () => [], { locationId: null });
    expect(ids()).toEqual(["unknown-scope"]);
  });

  it("does not overwrite a pending local edit with the server copy", async () => {
    state.rows = [cached("edited", { title: "Local edit", sync_status: "pending_sync", version: 2 })];
    await refreshServerExpenses(async () => [serverRow("edited", { title: "Server copy" })], { locationId: "branch-a" });
    expect(state.rows).toEqual([expect.objectContaining({ id: "edited", title: "Local edit" })]);
  });
});
