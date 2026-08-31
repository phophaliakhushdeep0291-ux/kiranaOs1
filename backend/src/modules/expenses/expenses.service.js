import crypto from "crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { moneyShadows, round2, toPaise } from "../../utils/money.js";
import { dateRangeForDateOnly, formatDateInTimeZone } from "../../utils/dates.js";
import { env } from "../../config/env.js";
import { resolveOperationalLocation } from "../stores/location-context.service.js";
import { postExpenseEffectLedger } from "../finance/financial-ledger.service.js";
import { createAuditLog } from "../audit/audit.service.js";

async function writeRequiredExpenseAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Expense action was not saved because its audit record could not be stored",
      503,
      "EXPENSE_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}

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
  const spentAt = {};
  if (from) spentAt.gte = expenseBoundary(from, "start");
  if (to) spentAt.lte = expenseBoundary(to, "end");
  return { spentAt };
}

function expenseBoundary(value, edge) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const range = dateRangeForDateOnly(raw, env.DAILY_CLOSING_TIMEZONE);
    return edge === "start" ? range.start : range.end;
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new AppError(`Invalid expense ${edge} date`, 400, "INVALID_DATE_RANGE");
  }
  return parsed;
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

function assertExpenseReplayCompatible(existing, payload, locationId) {
  const same =
    existing.title === payload.title &&
    toPaise(Number(existing.amount)) === toPaise(Number(payload.amount)) &&
    existing.category === payload.category &&
    existing.paymentMode === payload.paymentMode &&
    existing.status === payload.status &&
    (existing.locationId ?? null) === (locationId ?? null) &&
    (!payload.spentAt || existing.spentAt.getTime() === payload.spentAt.getTime());
  if (!same) {
    throw new AppError(
      "Idempotency key was already used for a different expense",
      409,
      "IDEMPOTENCY_KEY_REUSED",
    );
  }
}

export async function createExpense(shopId, data, identity = {}) {
  const payload = normalize(data);
  const idempotencyKey = payload.idempotencyKey ?? identity.idempotencyKey;
  if (!idempotencyKey) {
    throw new AppError("Idempotency key is required", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  const expenseIdentity = {
    idempotencyKey,
    clientExpenseId: payload.clientExpenseId ?? identity.clientExpenseId ?? idempotencyKey,
    sourceDeviceId: identity.sourceDeviceId ?? null,
  };

  try {
    return await db.$transaction(async (tx) => {
      const location = await resolveOperationalLocation(shopId, payload.locationId, tx);
      const existing = await tx.expense.findFirst({ where: { shopId, idempotencyKey } });
      if (existing) {
        assertExpenseReplayCompatible(existing, payload, location.id);
        return { ...existing, idempotentReplay: true };
      }
      const expense = await tx.expense.create({
        data: {
          ...payload,
          ...expenseIdentity,
          // Never trust actor fields from request data. These snapshots come
          // from the freshly authenticated request/sync user and stay immutable.
          recordedBy: identity.userName ?? null,
          recordedByUserId: identity.userId ?? null,
          recordedByRole: identity.role ?? null,
          ...moneyShadows({ amount: payload.amount }),
          locationId: location.id,
          shopId,
          spentAt: payload.spentAt ?? new Date(),
        },
      });
      await postExpenseEffectLedger(tx, {
        shopId,
        expense,
        keyBase: `expense:${expense.id}:create`,
        businessDate: expense.spentAt,
      });
      await writeRequiredExpenseAudit({
        shopId,
        userId: identity.userId ?? null,
        deviceId: identity.sourceDeviceId ?? identity.deviceId ?? null,
        action: "EXPENSE_CREATED",
        entityType: "Expense",
        entityId: expense.id,
        after: { id: expense.id, title: expense.title, amount: expense.amount, category: expense.category },
        metadata: { idempotencyKey, syncEventId: identity.syncEventId ?? null },
        req: identity.req ?? null,
      }, tx);
      return { ...expense, idempotentReplay: false };
    });
  } catch (error) {
    if (error?.code === "P2002") {
      const existing = await db.expense.findFirst({ where: { shopId, idempotencyKey } });
      if (existing) {
        assertExpenseReplayCompatible(existing, payload, existing.locationId);
        return { ...existing, idempotentReplay: true };
      }
    }
    throw error;
  }
}

export async function updateExpense(shopId, id, data, identity = {}) {
  const payload = normalize(data);
  return db.$transaction(async (tx) => {
    const existing = await tx.expense.findFirst({ where: { id, shopId, deletedAt: null } });
    if (!existing) throw new AppError("Expense not found", 404);
    const operationAt = new Date();
    const operationId = String(identity.idempotencyKey ?? crypto.randomUUID());
    const sourceId = `${existing.id}:${operationId}`;
    const replay = await tx.financialLedger.findFirst({ where: { shopId, sourceType: "expense_update", sourceId } });
    if (replay) return existing;
    await postExpenseEffectLedger(tx, {
      shopId,
      expense: existing,
      sign: -1,
      sourceType: "expense_update",
      sourceId,
      keyBase: `expense:${existing.id}:update:${operationId}:old`,
      businessDate: operationAt,
    });
    const updated = await tx.expense.update({
      where: { id: existing.id },
      data: { ...payload, ...moneyShadows({ amount: payload.amount }) },
    });
    await postExpenseEffectLedger(tx, {
      shopId,
      expense: updated,
      sourceType: "expense_update",
      sourceId,
      keyBase: `expense:${existing.id}:update:${operationId}:new`,
      businessDate: operationAt,
    });
    await writeRequiredExpenseAudit({
      shopId,
      userId: identity.userId ?? null,
      deviceId: identity.sourceDeviceId ?? identity.deviceId ?? null,
      action: "EXPENSE_UPDATED",
      entityType: "Expense",
      entityId: existing.id,
      before: { title: existing.title, amount: existing.amount, category: existing.category, status: existing.status },
      after: { title: updated.title, amount: updated.amount, category: updated.category, status: updated.status },
      metadata: { idempotencyKey: operationId, syncEventId: identity.syncEventId ?? null },
      req: identity.req ?? null,
    }, tx);
    return updated;
  });
}

export async function softDeleteExpense(shopId, id, identity = {}) {
  return db.$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({ where: { id, shopId } });
    if (!expense) throw new AppError("Expense not found", 404);
    const operationAt = new Date();
    const operationId = String(identity.idempotencyKey ?? crypto.randomUUID());
    const sourceId = `${expense.id}:${operationId}`;
    const replay = await tx.financialLedger.findFirst({ where: { shopId, sourceType: "expense_delete", sourceId } });
    if (replay) return expense;
    if (expense.deletedAt) throw new AppError("Expense is already deleted", 409, "EXPENSE_ALREADY_DELETED");
    await postExpenseEffectLedger(tx, {
      shopId,
      expense,
      sign: -1,
      sourceType: "expense_delete",
      sourceId,
      keyBase: `expense:${expense.id}:delete:${operationId}`,
      businessDate: operationAt,
    });
    const deleted = await tx.expense.update({ where: { id: expense.id }, data: { deletedAt: operationAt } });
    await writeRequiredExpenseAudit({
      shopId,
      userId: identity.userId ?? null,
      deviceId: identity.sourceDeviceId ?? identity.deviceId ?? null,
      action: "EXPENSE_DELETED",
      entityType: "Expense",
      entityId: expense.id,
      before: { id: expense.id, title: expense.title, deletedAt: expense.deletedAt },
      after: { id: deleted.id, title: deleted.title, deletedAt: deleted.deletedAt },
      metadata: { softDelete: true, idempotencyKey: operationId, syncEventId: identity.syncEventId ?? null },
      req: identity.req ?? null,
    }, tx);
    return deleted;
  });
}

export async function restoreExpense(shopId, id, identity = {}) {
  return db.$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({ where: { id, shopId, deletedAt: { not: null } } });
    if (!expense) throw new AppError("Deleted expense not found in recycle bin", 404);
    const operationAt = new Date();
    const operationId = crypto.randomUUID();
    const restored = await tx.expense.update({ where: { id: expense.id }, data: { deletedAt: null } });
    await postExpenseEffectLedger(tx, {
      shopId,
      expense: restored,
      sourceType: "expense_restore",
      sourceId: `${expense.id}:${operationId}`,
      keyBase: `expense:${expense.id}:restore:${operationId}`,
      businessDate: operationAt,
    });
    await writeRequiredExpenseAudit({
      shopId,
      userId: identity.userId ?? null,
      deviceId: identity.sourceDeviceId ?? identity.deviceId ?? null,
      action: "EXPENSE_RESTORED",
      entityType: "Expense",
      entityId: expense.id,
      before: { id: expense.id, title: expense.title, deletedAt: expense.deletedAt },
      after: { id: restored.id, title: restored.title, deletedAt: restored.deletedAt },
      metadata: { softDelete: false },
      req: identity.req ?? null,
    }, tx);
    return restored;
  });
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
