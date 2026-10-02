import { listExpenses } from "@/features/core/expenses/api";
import { refreshServerExpenses, listLocalExpenses, mergeExpenseSnapshots } from "@/features/core/expenses/local-actions";
import { expenseLocationUnknown, expensesForLocation } from "@/features/core/expenses/overview";
import { getActiveLocationId, getPrimaryLocationId } from "@/features/core/stores/location-context";
import { getOfflineScope } from "@/lib/offline/context";
import { addMoney } from "@/lib/money";
import { reportCalendarDay } from "@/features/core/reports/report-calendar";
import type { Expense } from "@/types/api";

export type ReportExpenses = { rows: Expense[]; isLocalEstimate: boolean };

/** Reports and closing must count the same pending edits and deletions as Expenses.
 * A failed cloud read may use saved rows, but a failed local read is never zero.
 */
export async function loadReportExpenses(from?: string): Promise<ReportExpenses> {
  const scopeKey = () => {
    const scope = getOfflineScope();
    return JSON.stringify([scope.tenant_id, scope.store_id, getActiveLocationId()]);
  };
  const startedIn = scopeKey();
  const assertScope = () => {
    if (scopeKey() !== startedIn) throw new Error("Expense report scope changed");
  };
  // Verify that pending financial records can be read before accepting cloud data.
  await listLocalExpenses();
  let serverRows: Expense[] | undefined;
  if (typeof navigator === "undefined" || navigator.onLine !== false) {
    let cloudReadFailed = false;
    try {
      serverRows = await refreshServerExpenses(async () => {
        let rows: Expense[];
        try { rows = await listExpenses(from ? { from } : undefined); }
        catch (error) {
          const status = (error as { status?: number })?.status;
          cloudReadFailed = status !== 401 && status !== 403;
          throw error;
        }
        assertScope();
        return rows;
      }, { locationId: getActiveLocationId(), from: from ? `${from}T00:00:00+05:30` : undefined });
    } catch (error) {
      // Storage/scope/auth failures must not masquerade as an ordinary outage.
      if (!cloudReadFailed) throw error;
    }
  }
  assertScope();
  const local = await listLocalExpenses();
  assertScope();
  const rows = expensesForLocation(mergeExpenseSnapshots(serverRows ?? [], local), getActiveLocationId(), getPrimaryLocationId() ?? undefined);
  if (expenseLocationUnknown(rows, getActiveLocationId(), getPrimaryLocationId())) {
    throw new Error("Expense report branch is unknown");
  }
  const pending = local.some((row) => {
    const saved = row as Expense & { sync_status?: string; merged_into_id?: string; mergedIntoId?: string };
    return saved.sync_status && saved.sync_status !== "synced" && !saved.merged_into_id && !saved.mergedIntoId;
  });
  return { rows, isLocalEstimate: serverRows === undefined || pending };
}

export function reportExpensesInRange(rows: Expense[], range: { from: string; to: string }): Expense[] {
  return rows.filter((row) => {
    const day = reportCalendarDay(row.spentAt);
    return day != null && day >= range.from && day <= range.to;
  });
}

export function reportExpenseTotal(rows: Expense[]): number {
  return addMoney(...rows.map((row) => row.amount));
}
