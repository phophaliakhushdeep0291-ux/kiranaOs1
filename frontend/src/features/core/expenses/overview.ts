import { fromPaise, toPaise } from "@/lib/money";
import type { Expense, ExpenseOverview } from "@/types/api";

const SHOP_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
});
// Asia/Kolkata is UTC+05:30 all year; it has no daylight saving to account for.
const SHOP_UTC_OFFSET_MS = 330 * 60_000;
const SUMMARY_MONTHS = 6;

/** "YYYY-MM-DD" of the shop day containing `date`. */
export function shopDayKey(date: Date): string {
  const parts = SHOP_DAY.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** First instant the summary cards count: shop midnight on the 1st, five months back. */
export function expenseSummaryWindowStart(now = new Date()): string {
  const [year, month] = shopDayKey(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - SUMMARY_MONTHS, 1) - SHOP_UTC_OFFSET_MS).toISOString();
}

export function expensesForLocation(rows: Expense[], locationId: string | null, primaryLocationId?: string): Expense[] {
  if (!locationId) return rows;
  // Old offline rows omitted locationId; the server assigns those to primary.
  // Never make older financial rows disappear when the branch catalogue has
  // not been cached yet. The page marks totals unavailable in this case.
  return rows.filter((row) => row.locationId ? row.locationId === locationId
    : !primaryLocationId || primaryLocationId === locationId);
}

export function expenseLocationUnknown(rows: Expense[], locationId: string | null, primaryLocationId?: string | null): boolean {
  return Boolean(locationId && !primaryLocationId && rows.some((row) => !row.locationId));
}

/** Aggregate the same unfiltered, merged rows used by the device's ledger.
 * Use shop dates rather than the computer's timezone, and sum integer paise.
 */
export function expenseOverview(rows: Expense[], now = new Date()): ExpenseOverview {
  const todayKey = shopDayKey(now);
  const [year, month, day] = todayKey.split("-").map(Number);
  const dateKey = (monthIndex: number, dayOfMonth = 1) => new Date(Date.UTC(year, monthIndex, dayOfMonth)).toISOString().slice(0, 10);
  const yesterdayKey = dateKey(month - 1, day - 1);
  const monthKey = todayKey.slice(0, 7);
  const lastMonthKey = dateKey(month - 2).slice(0, 7);
  const trendMap = new Map<string, number>();
  for (let i = SUMMARY_MONTHS - 1; i >= 0; i -= 1) trendMap.set(dateKey(month - 1 - i).slice(0, 7), 0);
  // Compare instants before formatting: the device cache can hold years of rows.
  const windowStart = new Date(expenseSummaryWindowStart(now)).getTime();
  let today = 0, yesterday = 0, currentMonth = 0, lastMonth = 0, pendingTotal = 0, pendingCount = 0;
  const byCategory = new Map<string, number>();
  for (const row of rows) {
    const local = row as Expense & { deleted_at?: string | null; merged_into_id?: string | null; mergedIntoId?: string | null };
    if (row.deletedAt || local.deleted_at || local.merged_into_id || local.mergedIntoId) continue;
    const at = new Date(row.spentAt).getTime();
    if (!Number.isFinite(at) || at < windowStart) continue;
    const key = shopDayKey(new Date(at)), bucket = key.slice(0, 7);
    const amount = toPaise(row.amount);
    if (key >= todayKey) today += amount;
    else if (key >= yesterdayKey) yesterday += amount;
    if (bucket >= monthKey) {
      currentMonth += amount;
      byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + amount);
    } else if (bucket >= lastMonthKey) lastMonth += amount;
    if (row.status === "pending") { pendingTotal += amount; pendingCount += 1; }
    if (trendMap.has(bucket)) trendMap.set(bucket, trendMap.get(bucket)! + amount);
  }
  const trend = [...trendMap].map(([month, total]) => ({ month, total: fromPaise(total) }));
  return {
    today: fromPaise(today), yesterday: fromPaise(yesterday),
    month: fromPaise(currentMonth), lastMonth: fromPaise(lastMonth),
    pendingTotal: fromPaise(pendingTotal), pendingCount,
    byCategory: Object.fromEntries([...byCategory].map(([key, value]) => [key, fromPaise(value)])),
    trend,
    monthlyAverage: fromPaise(Math.round([...trendMap.values()].reduce((sum, total) => sum + total, 0) / SUMMARY_MONTHS)),
  };
}
