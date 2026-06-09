import { AppError } from "../../middleware/error.js";
import {
  createReminderTemplate,
  deleteReminderTemplate,
  listReminderTemplates,
  updateReminderTemplate,
} from "./reminderTemplates.service.js";
import { listReminderLogs, sendReminder, sendStatementReminder } from "./reminders.service.js";

function data(res, payload, status = 200) {
  res.status(status).json({ success: true, data: payload });
}

export async function templates(req, res, next) {
  try { data(res, await listReminderTemplates(req.shopId)); } catch (error) { next(error); }
}

export async function createTemplate(req, res, next) {
  try { data(res, await createReminderTemplate(req.shopId, req.user?.userId, req.body, { req }), 201); } catch (error) { next(error); }
}

export async function updateTemplate(req, res, next) {
  try { data(res, await updateReminderTemplate(req.shopId, req.params.id, req.user?.userId, req.body, { req })); } catch (error) { next(error); }
}

export async function deleteTemplate(req, res, next) {
  try { data(res, await deleteReminderTemplate(req.shopId, req.params.id, req.user?.userId, { req })); } catch (error) { next(error); }
}

export async function logs(req, res, next) {
  try { data(res, await listReminderLogs(req.shopId, req.query, req.user)); } catch (error) { next(error); }
}

export async function send(req, res, next) {
  try { data(res, await sendReminder(req.shopId, req.user, req.body, { req }), 202); } catch (error) { next(error); }
}

export async function sendStatement(req, res, next) {
  try { data(res, await sendStatementReminder(req.shopId, req.user, req.body, { req }), 202); } catch (error) { next(error); }
}

export function featureNotAvailableError(message = "WhatsApp reminders require Pro plan") {
  const err = new AppError(message, 403);
  err.code = "FEATURE_NOT_AVAILABLE";
  return err;
}
