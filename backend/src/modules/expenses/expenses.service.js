import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";
import { dateRangeForDateOnly, formatDateInTimeZone } from "../../utils/dates.js";
import { env } from "../../config/env.js";
import { resolveOperationalLocation } from "../stores/location-context.service.js";

function normalize(data) {
  const out = { ...data };
  if (out.amount !== undefined) out.amount = round2(Number(out.amount) || 0);
  if (out.spentAt !== undefined && out.spentAt) out.spentAt = new Date(out.spentAt);
  if (out.nextDueOn !== undefined) out.nextDueOn = out.nextDueOn ? new Date(out.nextDueOn) : null;
  if (out.vendor !== undefined) out.vendor = out.vendor ? String(out.vendor).trim() : null;
  return out;
}

function dateRangeWhere(from, to) {
  if (!from && !to) return {};
  return { spentAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } };
}

export async function listExpenses(shopId, { category, status, locationId, from, to, search } = {}) {
  const where = {
    shopId,
    deletedAt: null,
    ...(locationId && { locationId }),
    ...(category && { category }),
    ...(status && { status }),
    ...(search && { OR: [{ title: { contains: search } }, { notes: { contains: search } }, { vendor: { contains: search } }] }),
    ...dateRangeWhere(from, to),
  };
  return db.expense.findMany({ where, orderBy: { spentAt: "desc" } });
}

export async function getExpense(shopId, id) {
  const expense = await db.expense.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!expense) throw new AppError("Expense not found", 404);
  return expense;
}

export async function createExpense(shopId, data) {
  const payload = normalize(data);
  const location = await resolveOperationalLocation(shopId, payload.locationId);
  return db.expense.create({ data: { ...payload, locationId: location.id, shopId, spentAt: payload.spentAt ?? new Date() } });
}

export async function updateExpense(shopId, id, data) {
  await getExpense(shopId, id);
  return db.expense.update({ where: { id }, data: normalize(data) });
}

export async function softDeleteExpense(shopId, id) {
  const expense = await getExpense(shopId, id);
  return db.expense.update({ where: { id: expense.id }, data: { deletedAt: new Date() } });
}

export async function restoreExpense(shopId, id) {
  const expense = await db.expense.findFirst({ where: { id, shopId, deletedAt: { not: null } } });
  if (!expense) throw new AppError("Deleted expense not found in recycle bin", 404);
  return db.expense.update({ where: { id: expense.id }, data: { deletedAt: null } });
}

export async function getExpenseSummary(shopId, { from, to, locationId } = {}) {
  const where = { shopId, deletedAt: null, ...(locationId && { locationId }), ...dateRangeWhere(from, to) };
  const expenses = await db.expense.findMany({ where, select: { amount: true, category: true, paymentMode: true, status: true } });
  const total = round2(expenses.reduce((sum, e) => sum + (e.amount || 0), 0));
  const byCategory = {};
  const byMode = {};
  let pendingTotal = 0;
  let pendingCount = 0;
  for (const e of expenses) {
    byCategory[e.category] = round2((byCategory[e.category] || 0) + (e.amount || 0));
    byMode[e.paymentMode] = round2((byMode[e.paymentMode] || 0) + (e.amount || 0));
    if (e.status === "pending") { pendingTotal += e.amount || 0; pendingCount += 1; }
  }
  return { total, count: expenses.length, byCategory, byMode, pendingTotal: round2(pendingTotal), pendingCount };
}

/**
 * One call powering the Expenses dashboard header + charts:
 * today / this-month / last-month totals, pending payouts, month category split,
 * and a monthly trend for the last `months` months. JS grouping keeps it
 * portable across sqlite + postgres at kirana-shop data volumes.
 */
export async function getExpenseOverview(shopId, { months = 6, locationId } = {}) {
  // All day/month boundaries and trend buckets are computed in the shop timezone, not the
  // server's local clock — otherwise an expense near a day/month boundary lands in the wrong
  // bucket by the UTC offset (5.5h for IST) on a UTC production server.
  const tz = env.DAILY_CLOSING_TIMEZONE;
  const todayKey = formatDateInTimeZone(new Date(), tz); // "YYYY-MM-DD" in the shop timezone
  const [y, m, dayOfMonth] = todayKey.split("-").map(Number); // m is 1-based
  const dayKeyOf = (yy, monthIndex0, day) => new Date(Date.UTC(yy, monthIndex0, day)).toISOString().slice(0, 10);
  const monthKeyOf = (yy, monthIndex0) => {
    const dt = new Date(Date.UTC(yy, monthIndex0, 1));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const startOfToday = dateRangeForDateOnly(todayKey, tz).start;
  const startOfYesterday = dateRangeForDateOnly(dayKeyOf(y, m - 1, dayOfMonth - 1), tz).start;
  const startOfMonth = dateRangeForDateOnly(dayKeyOf(y, m - 1, 1), tz).start;
  const startOfLastMonth = dateRangeForDateOnly(dayKeyOf(y, m - 2, 1), tz).start;
  const trendStart = dateRangeForDateOnly(dayKeyOf(y, m - 1 - (months - 1), 1), tz).start;

  const rows = await db.expense.findMany({
    where: { shopId, deletedAt: null, ...(locationId && { locationId }), spentAt: { gte: trendStart } },
    select: { amount: true, category: true, status: true, spentAt: true },
  });

  let today = 0, yesterday = 0, month = 0, lastMonth = 0, pendingTotal = 0, pendingCount = 0;
  const byCategory = {};
  const trendMap = new Map();
  for (let i = 0; i < months; i += 1) {
    trendMap.set(monthKeyOf(y, m - 1 - (months - 1 - i)), 0);
  }

  for (const e of rows) {
    const amt = e.amount || 0;
    const at = new Date(e.spentAt);
    if (at >= startOfToday) today += amt;
    else if (at >= startOfYesterday) yesterday += amt;
    if (at >= startOfMonth) {
      month += amt;
      byCategory[e.category] = round2((byCategory[e.category] || 0) + amt);
    } else if (at >= startOfLastMonth) {
      lastMonth += amt;
    }
    if (e.status === "pending") { pendingTotal += amt; pendingCount += 1; }
    const key = formatDateInTimeZone(at, tz).slice(0, 7); // "YYYY-MM" in the shop timezone
    if (trendMap.has(key)) trendMap.set(key, round2(trendMap.get(key) + amt));
  }

  const trend = [...trendMap.entries()].map(([key, total]) => ({ month: key, total }));
  const trendTotal = trend.reduce((s, t) => s + t.total, 0);

  return {
    today: round2(today),
    yesterday: round2(yesterday),
    month: round2(month),
    lastMonth: round2(lastMonth),
    pendingTotal: round2(pendingTotal),
    pendingCount,
    byCategory,
    trend,
    monthlyAverage: round2(trend.length ? trendTotal / trend.length : 0),
  };
}
