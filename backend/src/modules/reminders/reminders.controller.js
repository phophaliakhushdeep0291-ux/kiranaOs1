import { AppError } from "../../middleware/error.js";
import {
  createReminderTemplate,
  deleteReminderTemplate,
  listReminderTemplates,
  updateReminderTemplate,
} from "./reminderTemplates.service.js";
import { getReminderStatus, listReminderLogs, sendReminder, sendStatementReminder } from "./reminders.service.js";
import { handleProviderWebhook, verifyMetaSubscription } from "./whatsapp.webhook.js";

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

export async function status(req, res, next) {
  try { data(res, await getReminderStatus()); } catch (error) { next(error); }
}

export function verifyMetaWebhook(req, res, next) {
  try {
    res.status(200).type("text/plain").send(verifyMetaSubscription(req.query));
  } catch (error) { next(error); }
}

export async function providerWebhook(req, res, next) {
  try {
    const queryIndex = req.originalUrl.indexOf("?");
    const result = await handleProviderWebhook({
      provider: String(req.params.provider || "").toLowerCase(),
      rawBody: Buffer.isBuffer(req.body) ? req.body : null,
      body: Buffer.isBuffer(req.body) ? null : req.body,
      headers: req.headers,
      query: req.query,
      rawQuery: queryIndex >= 0 ? req.originalUrl.slice(queryIndex + 1) : "",
    });
    res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
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
