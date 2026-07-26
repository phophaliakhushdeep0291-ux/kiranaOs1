import db from "../../db.js";
import * as svc from "./expenses.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { requestLocationId } from "../stores/location-context.service.js";

export async function list(req, res, next) {
  try { res.json({ success: true, data: await svc.listExpenses(req.shopId, { ...req.query, locationId: requestLocationId(req) }) }); }
  catch (err) { next(err); }
}

export async function summary(req, res, next) {
  try { res.json({ success: true, data: await svc.getExpenseSummary(req.shopId, { ...req.query, locationId: requestLocationId(req) }) }); }
  catch (err) { next(err); }
}

export async function overview(req, res, next) {
  try { res.json({ success: true, data: await svc.getExpenseOverview(req.shopId, { ...req.query, locationId: requestLocationId(req) }) }); }
  catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    // Stamp who recorded it (display-only) without trusting client input.
    const user = req.user?.userId ? await db.user.findUnique({ where: { id: req.user.userId }, select: { name: true } }) : null;
    const deviceHeader = req.headers?.["x-device-id"];
    const expense = await svc.createExpense(
      req.shopId,
      { ...req.body, locationId: requestLocationId(req), recordedBy: user?.name ?? null },
      {
        idempotencyKey: req.body.idempotencyKey,
        clientExpenseId: req.body.clientExpenseId ?? req.body.idempotencyKey,
        sourceDeviceId: Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader ?? null,
      },
    );
    if (!expense.idempotentReplay) await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "EXPENSE_CREATED",
      entityType: "Expense", entityId: expense.id,
      after: { id: expense.id, title: expense.title, amount: expense.amount, category: expense.category },
      req,
    });
    res.status(expense.idempotentReplay ? 200 : 201).json({ success: true, data: expense });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try { res.json({ success: true, data: await svc.updateExpense(req.shopId, req.params.id, req.body) }); }
  catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const expense = await svc.softDeleteExpense(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "EXPENSE_DELETED",
      entityType: "Expense", entityId: expense.id,
      after: { id: expense.id, title: expense.title, deletedAt: expense.deletedAt },
      metadata: { softDelete: true }, req,
    });
    res.json({ success: true, message: "Expense moved to recycle bin", data: expense });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try {
    const expense = await svc.restoreExpense(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "EXPENSE_RESTORED",
      entityType: "Expense", entityId: expense.id,
      after: { id: expense.id, title: expense.title }, metadata: { softDelete: false }, req,
    });
    res.json({ success: true, message: "Expense restored", data: expense });
  } catch (err) { next(err); }
}
