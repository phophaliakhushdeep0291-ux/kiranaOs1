import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Expense } from "@/types/api";

const state = vi.hoisted(() => ({ rows: [] as Array<Expense & Record<string, unknown>>, events: [] as unknown[] }));
vi.mock("@/lib/offline/db", () => ({ offlineDB: {
  getAll: vi.fn(async () => state.rows),
  transaction: vi.fn(async (_tables: string[], work: (tx: unknown) => Promise<void>) => work({
    put: async (_table: string, row: Expense & Record<string, unknown>) => { state.rows = [...state.rows.filter((old) => old.id !== row.id), row]; },
    enqueueOutboxOperation: async (event: unknown) => { state.events.push(event); },
  })),
} }));
vi.mock("@/features/core/sync/outbox", () => ({ buildOutboxOperation: (input: unknown) => input }));
vi.mock("@/lib/offline/context", () => ({ getOfflineScope: () => ({ tenant_id: "shop", store_id: "store", device_id: "device" }), nowIso: () => "2026-09-30T10:00:00Z" }));
vi.mock("@/lib/offline/instant-cache", () => ({ createLocalId: () => "delete-event", emitLocalDataChanged: vi.fn() }));
vi.mock("@/features/core/stores/location-context", () => ({ getActiveLocationId: () => "branch-b" }));
import { createExpenseLocalFirst, deleteExpenseLocalFirst, listLocalExpenses, mergeExpenseSnapshots, updateExpenseLocalFirst } from "@/features/core/expenses/local-actions";
import { expenseOverview } from "@/features/core/expenses/overview";

const server = { id: "server-expense", title: "Transport", amount: 50, spentAt: "2026-09-30", deletedAt: null } as Expense;
beforeEach(() => { state.rows = []; state.events = []; });
describe("offline expense deletion against a cached server snapshot", () => {
  it("captures the selected branch in the local expense and its eventual cloud operation", async () => {
    const created = await createExpenseLocalFirst({ title: "Courier", amount: 200, spentAt: "2026-09-30T10:00:00Z" });
    expect(created.locationId).toBe("branch-b");
    expect(state.events[0]).toMatchObject({ payload: { expense: { locationId: "branch-b" } } });
  });

  it("updates the summary on create, edit and delete before the server catches up", async () => {
    const created = await createExpenseLocalFirst({ title: "Courier", amount: 200, spentAt: "2026-09-30T10:00:00Z" });
    const at = new Date("2026-09-30T12:00:00Z");
    const total = () => expenseOverview(mergeExpenseSnapshots([created], state.rows), at).today;
    expect(total()).toBe(200);
    await updateExpenseLocalFirst(created.id, { title: "Courier corrected", amount: 225 }, "2468");
    expect(total()).toBe(225);
    await deleteExpenseLocalFirst(created.id, "2468");
    expect(total()).toBe(0);
    expect(state.events).toHaveLength(3);
  });

  it("stays deleted immediately and after rereading local storage", async () => {
    state.rows = [{ ...server, local_id: server.id, server_id: server.id, version: 1, sync_status: "synced" }];
    await deleteExpenseLocalFirst(server.id, "2468");
    expect(state.events).toHaveLength(1);
    expect(mergeExpenseSnapshots([server], await listLocalExpenses())).toEqual([]);
    expect(mergeExpenseSnapshots([server], await listLocalExpenses())).toEqual([]);
  });
  it.each([false, true])("suppresses both identities regardless of local echo order: %s", (reverse) => {
    const deleted = { ...server, id: "local-expense", server_id: server.id, deleted_at: "2026-09-30", sync_status: "pending_sync" };
    const local = reverse ? [server, deleted] : [deleted, server];
    expect(mergeExpenseSnapshots([server], local)).toEqual([]);
  });
  it("keeps unrelated expenses and local updates", () => {
    const other = { ...server, id: "other" };
    const edited = { ...server, title: "Transport corrected", amount: 60 };
    expect(mergeExpenseSnapshots([server, other], [edited])).toEqual(expect.arrayContaining([other, edited]));
    expect(mergeExpenseSnapshots([server, other], [edited])).toHaveLength(2);
  });
  it.each([false, true])("keeps the server winner after sync retires its local-id copy: %s", (reverse) => {
    const retired = { ...server, id: "local-expense", server_id: server.id, merged_into_id: server.id, deleted_at: "2026-09-30", sync_status: "synced" };
    expect(mergeExpenseSnapshots([server], reverse ? [server, retired] : [retired, server])).toEqual([server]);
    const deletedWinner = { ...server, local_id: retired.id, deleted_at: "2026-09-30", sync_status: "pending_sync" };
    expect(mergeExpenseSnapshots([server], [retired, deletedWinner])).toEqual([]);
  });
});
