import db from "../db.js";
import { hasFeature } from "../modules/feature-gates/featureGate.service.js";
import { sendWhatsAppMessage } from "../modules/reminders/whatsapp.provider.js";
import { claimReminderForDispatch, markReminderFromProvider } from "../modules/reminders/reminders.service.js";
import { JOB_NAMES } from "./queueNames.js";

// Worker never fakes delivery. Provider disabled returns WHATSAPP_PROVIDER_NOT_CONFIGURED.

export async function handleReminderJob(job) {
  switch (job.name) {
    case JOB_NAMES.SEND_WHATSAPP_REMINDER:
      return sendWhatsAppReminder(job.data);
    default: {
      const error = new Error(`Unknown reminder job: ${job.name}`);
      error.code = "UNKNOWN_REMINDER_JOB";
      throw error;
    }
  }
}

async function sendWhatsAppReminder(payload = {}) {
  if (!payload.shopId || !payload.reminderLogId) {
    const error = new Error("shopId and reminderLogId are required for reminder jobs");
    error.code = "INVALID_REMINDER_JOB_PAYLOAD";
    throw error;
  }

  const allowed = await hasFeature(payload.shopId, "whatsapp_reminders");
  if (!allowed) {
    await markReminderFromProvider(payload.reminderLogId, { success: false, status: "failed", code: "FEATURE_NOT_AVAILABLE", provider: "disabled" });
    const error = new Error("WhatsApp reminders require Pro plan");
    error.code = "FEATURE_NOT_AVAILABLE";
    throw error;
  }

  const log = await db.reminderLog.findFirst({
    where: { id: payload.reminderLogId, shopId: payload.shopId },
    include: { customer: true, shop: { select: { id: true, name: true } } },
  });
  if (!log) {
    const error = new Error("Reminder log not found");
    error.code = "REMINDER_LOG_NOT_FOUND";
    throw error;
  }
  if (log.status !== "queued") {
    return { status: log.status, reminderLogId: log.id, alreadyProcessed: true, deliveryUncertain: log.status === "sending" };
  }
  if (!log.customer?.mobile) {
    const updated = await markReminderFromProvider(log.id, { success: false, status: "failed", code: "CUSTOMER_PHONE_REQUIRED", provider: "disabled" });
    return { status: updated.status, code: updated.error, reminderLogId: log.id };
  }

  const claim = await claimReminderForDispatch(log.id);
  if (!claim.claimed) {
    return { status: claim.log.status, reminderLogId: log.id, alreadyProcessed: true, deliveryUncertain: claim.log.status === "sending" };
  }

  const result = await sendWhatsAppMessage({
    to: log.customer.mobile,
    message: log.message,
    shopId: log.shopId,
    customerId: log.customerId,
    reminderLogId: log.id,
  });
  const updated = await markReminderFromProvider(log.id, result);
  if (!result.success && result.status !== "skipped") {
    const error = new Error(result.code || "WHATSAPP_SEND_FAILED");
    error.code = result.code || "WHATSAPP_SEND_FAILED";
    throw error;
  }
  return { status: updated.status, code: updated.error, reminderLogId: updated.id, provider: updated.provider };
}

export const __reminderWorkerInternals = { sendWhatsAppReminder };
