import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";

function normalize(data) {
  const out = { ...data };
  if (out.amount !== undefined) out.amount = round2(Number(out.amount) || 0);
  if (out.spentAt !== undefined && out.spentAt) out.spentAt = new Date(out.spentAt);
  return out;
}

function dateRangeWhere(from, to) {
  if (!from && !to) return {};
  return { spentAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } };
}

export async function listExpenses(shopId, { category, from, to, search } = {}) {
  const where = {
    shopId,
    deletedAt: null,
    ...(category && { category }),
    ...(search && { OR: [{ title: { contains: search } }, { notes: { contains: search } }] }),
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
  const expenses = await db.expense.findMany({ where, select: { amount: true, category: true, paymentMode: true } });
  const total = round2(expenses.reduce((sum, e) => sum + (e.amount || 0), 0));
  const byCategory = {};
  const byMode = {};
  for (const e of expenses) {
    byCategory[e.category] = round2((byCategory[e.category] || 0) + (e.amount || 0));
    byMode[e.paymentMode] = round2((byMode[e.paymentMode] || 0) + (e.amount || 0));
  }
  return { total, count: expenses.length, byCategory, byMode };
}
