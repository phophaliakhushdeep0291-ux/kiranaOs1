import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Expense } from "@/types/api";

const state = vi.hoisted(() => ({ rows: [] as Array<Expense & Record<string, unknown>>, location: "main" as string | null, primary: "main" as string | null, tenant: "shop" }));
vi.mock("@/lib/offline/db", () => ({ offlineDB: {
  getAll: vi.fn(async () => state.rows),
  replaceSyncedSnapshot: vi.fn(async (_table: string, rows: Array<Expense & Record<string, unknown>>, _scope: unknown, isStale: (row: Record<string, unknown>) => boolean) => {
    state.rows = state.rows.filter((row) => row.sync_status !== "synced" || !isStale(row));
    for (const row of rows) state.rows = [...state.rows.filter((old) => old.id !== row.id), row];
  }),
}, assertCurrentOfflineScope: vi.fn() }));
vi.mock("@/features/core/sync/outbox", () => ({ buildOutboxOperation: (input: unknown) => input }));
vi.mock("@/lib/offline/context", () => ({ getOfflineScope: () => ({ tenant_id: state.tenant, store_id: "store", device_id: "device" }), nowIso: () => "2026-10-01T10:00:00Z" }));
vi.mock("@/lib/offline/instant-cache", () => ({ createLocalId: () => "event", emitLocalDataChanged: vi.fn() }));
vi.mock("@/features/core/stores/location-context", () => ({ getActiveLocationId: () => state.location, getPrimaryLocationId: () => state.primary }));
vi.mock("@/features/core/expenses/api", () => ({ listExpenses: vi.fn() }));

import { offlineDB } from "@/lib/offline/db";
import { listExpenses } from "@/features/core/expenses/api";
import { loadReportExpenses, reportExpenseTotal, reportExpensesInRange } from "@/features/core/reports/expense-reporting";
import { paidCashExpenseTotal } from "@/features/core/reports/cash-expenses";
import { formatMoney } from "@/lib/money";

const expense = (id: string, amount: number, extra: Record<string, unknown> = {}): Expense & Record<string, unknown> => ({
  id, title: "Packing", amount, category: "Packing Material", paymentMode: "cash", status: "paid", spentAt: "2026-10-01T10:00:00Z", locationId: "main", sync_status: "synced", ...extra,
} as Expense & Record<string, unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = []; state.location = "main"; state.primary = "main"; state.tenant = "shop";
  vi.mocked(listExpenses).mockReset().mockRejectedValue(new Error("Network unavailable"));
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("expenses used for reports and cash closing", () => {
  it("uses saved records immediately when the browser is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    state.rows = [expense("packing", 49.75)];
    expect(reportExpenseTotal((await loadReportExpenses()).rows)).toBe(49.75);
    expect(listExpenses).not.toHaveBeenCalled();
  });
  it("keeps a saved cash expense in reports and the drawer during an outage and reread", async () => {
    state.rows = [expense("packing", 49.75, { sync_status: "pending_sync" }), expense("digital", 0.25, { paymentMode: "upi" }), expense("unpaid", 10, { status: "pending" })];
    for (let i = 0; i < 2; i++) {
      const snapshot = await loadReportExpenses();
      expect(snapshot.isLocalEstimate).toBe(true);
      expect(reportExpenseTotal(snapshot.rows)).toBe(60);
      expect(paidCashExpenseTotal(snapshot.rows)).toBe(49.75);
    }
  });

  it("merges cloud changes while preserving pending edits and deletions", async () => {
    state.rows = [expense("edited", 49.75, { sync_status: "pending_sync" }), expense("deleted", 25, { deleted_at: "2026-10-01", sync_status: "pending_sync" }), expense("fresh", 100)];
    vi.mocked(listExpenses).mockResolvedValue([expense("edited", 40), expense("deleted", 25), expense("fresh", 0.25), expense("new", 5)]);
    const snapshot = await loadReportExpenses();
    expect(snapshot.rows.map((row) => row.id).sort()).toEqual(["edited", "fresh", "new"]);
    expect(reportExpenseTotal(snapshot.rows)).toBe(55);
    expect(snapshot.isLocalEstimate).toBe(true);
  });

  it("prunes an expense deleted on another counter while keeping earlier report history", async () => {
    state.rows = [expense("deleted-elsewhere", 20, { server_id: "deleted-elsewhere", version: 1 }), expense("old", 30, { server_id: "old", version: 1, spentAt: "2026-08-01T10:00:00Z" })];
    vi.mocked(listExpenses).mockResolvedValue([]);
    const snapshot = await loadReportExpenses("2026-09-01");
    expect(listExpenses).toHaveBeenCalledWith({ from: "2026-09-01" });
    expect(snapshot.rows.map((row) => row.id)).toEqual(["old"]);
  });

  it("counts a synced server winner once after its local identity is retired", async () => {
    state.rows = [expense("local", 49.75, { server_id: "saved", merged_into_id: "saved", deleted_at: "2026-10-01" })];
    vi.mocked(listExpenses).mockResolvedValue([expense("saved", 49.75)]);
    const snapshot = await loadReportExpenses();
    expect(snapshot.rows).toHaveLength(1);
    expect(reportExpenseTotal(snapshot.rows)).toBe(49.75);
    expect(snapshot.isLocalEstimate).toBe(false);
  });

  it("does not count another branch or assign a legacy expense to the wrong branch", async () => {
    state.rows = [expense("main", 20), expense("branch", 30, { locationId: "branch" }), expense("legacy", 40, { locationId: undefined })];
    expect(reportExpenseTotal((await loadReportExpenses()).rows)).toBe(60);
    state.location = "branch";
    expect(reportExpenseTotal((await loadReportExpenses()).rows)).toBe(30);
    state.primary = null;
    await expect(loadReportExpenses()).rejects.toThrow("branch is unknown");
  });

  it("rejects a late cloud response after the active shop changes", async () => {
    vi.mocked(listExpenses).mockImplementation(async () => { state.tenant = "other-shop"; return [expense("private", 999)]; });
    await expect(loadReportExpenses()).rejects.toThrow("scope changed");
    expect(offlineDB.replaceSyncedSnapshot).not.toHaveBeenCalled();
  });

  it("fails visibly if saved financial records cannot be read, even when the cloud works", async () => {
    vi.mocked(offlineDB.getAll).mockRejectedValueOnce(new Error("Storage unreadable"));
    vi.mocked(listExpenses).mockResolvedValue([]);
    await expect(loadReportExpenses()).rejects.toThrow("Storage unreadable");
    expect(listExpenses).not.toHaveBeenCalled();
  });

  it.each([401, 403])("does not hide an authorization failure (%s) behind cached totals", async (status) => {
    state.rows = [expense("old", 100)];
    vi.mocked(listExpenses).mockRejectedValue({ status });
    await expect(loadReportExpenses()).rejects.toEqual({ status });
  });

  it("keeps date-filtered totals in paise and formats a nonzero drawer shortage", () => {
    const rows = [expense("today", 49.75, { spentAt: "2026-10-01" }), expense("today-two", 0.50, { spentAt: "2026-10-01" }), expense("yesterday", 500, { spentAt: "2026-09-30" })];
    expect(reportExpenseTotal(reportExpensesInRange(rows, { from: "2026-10-01", to: "2026-10-01" }))).toBe(50.25);
    expect(formatMoney(750 - 749.75)).toBe("₹0.25");
    expect(formatMoney(199.5)).toBe("₹199.50");
  });
});
