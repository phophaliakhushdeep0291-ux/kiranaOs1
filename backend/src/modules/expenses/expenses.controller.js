import * as svc from "./expenses.service.js";
import { requestLocationId } from "../stores/location-context.service.js";
import { scheduleAuditEvaluation } from "../assurance/assurance.hooks.js";
import { ENTITY_TYPES } from "../assurance/assurance.constants.js";

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
    const deviceHeader = req.headers?.["x-device-id"];
    const expense = await svc.createExpense(
      req.shopId,
      { ...req.body, locationId: requestLocationId(req) },
      {
        idempotencyKey: req.body.idempotencyKey,
        clientExpenseId: req.body.clientExpenseId ?? req.body.idempotencyKey,
        sourceDeviceId: Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader ?? null,
        userId: req.user?.userId ?? null,
        userName: req.user?.userName ?? null,
        role: req.user?.role ?? null,
        req,
      },
    );
    res.status(expense.idempotentReplay ? 200 : 201).json({ success: true, data: expense });
    if (!expense.idempotentReplay) {
      scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.EXPENSE, expense.id, { userId: req.user?.userId });
    }
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const deviceHeader = req.headers?.["x-device-id"];
    const expense = await svc.updateExpense(req.shopId, req.params.id, req.body, {
      idempotencyKey: req.body.idempotencyKey,
      sourceDeviceId: Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader ?? null,
      userId: req.user?.userId ?? null,
      req,
    });
    res.json({ success: true, data: expense });
    scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.EXPENSE, req.params.id, { userId: req.user?.userId });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const deviceHeader = req.headers?.["x-device-id"];
    const expense = await svc.softDeleteExpense(req.shopId, req.params.id, {
      idempotencyKey: req.body?.idempotencyKey,
      sourceDeviceId: Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader ?? null,
      userId: req.user?.userId ?? null,
      req,
    });
    res.json({ success: true, message: "Expense moved to recycle bin", data: expense });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try {
    const deviceHeader = req.headers?.["x-device-id"];
    const expense = await svc.restoreExpense(req.shopId, req.params.id, {
      sourceDeviceId: Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader ?? null,
      userId: req.user?.userId ?? null,
      req,
    });
    res.json({ success: true, message: "Expense restored", data: expense });
  } catch (err) { next(err); }
}
