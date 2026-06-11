import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";

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

export async function listExpenses(shopId, { category, status, from, to, search } = {}) {
  const where = {
    shopId,
    deletedAt: null,
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
  return db.expense.create({ data: { ...payload, shopId, spentAt: payload.spentAt ?? new Date() } });
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

export async function getExpenseSummary(shopId, { from, to } = {}) {
  const where = { shopId, deletedAt: null, ...dateRangeWhere(from, to) };
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
export async function getExpenseOverview(shopId, { months = 6 } = {}) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const trendStart = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  const rows = await db.expense.findMany({
    where: { shopId, deletedAt: null, spentAt: { gte: trendStart } },
    select: { amount: true, category: true, status: true, spentAt: true },
  });

  let today = 0, yesterday = 0, month = 0, lastMonth = 0, pendingTotal = 0, pendingCount = 0;
  const byCategory = {};
  const trendMap = new Map();
  for (let i = 0; i < months; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    trendMap.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, 0);
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
    const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
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
