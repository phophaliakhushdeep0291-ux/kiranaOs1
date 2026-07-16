import crypto from "node:crypto";
import twilio from "twilio";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { recordReminderMetric, recordWhatsAppProviderError } from "../../lib/metrics.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";

const PROVIDERS = new Set(["meta", "twilio", "gupshup", "interakt"]);
const STATUS_PREDECESSORS = Object.freeze({
  accepted: ["queued"],
  sent: ["queued", "accepted"],
  delivered: ["queued", "accepted", "sent"],
  read: ["queued", "accepted", "sent", "delivered"],
  failed: ["queued", "accepted", "sent"],
});
const ACTION_BY_STATUS = Object.freeze({
  accepted: "REMINDER_ACCEPTED",
  sent: "REMINDER_SENT",
  delivered: "REMINDER_DELIVERED",
  read: "REMINDER_READ",
  failed: "REMINDER_FAILED",
});
const DELIVERY_EVENT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let lastDeliveryEventCleanupAt = 0;

function webhookError(message, statusCode, code) {
  return new AppError(message, statusCode, code);
}

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validReference(value) {
  const reference = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{6,256}$/.test(reference) ? reference : null;
}

function safeErrorCode(value) {
  const code = String(value || "").trim().replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 120);
  return code || null;
}

function eventDate(value) {
  let parsed;
  if (typeof value === "number" || /^\d{10,13}$/.test(String(value || ""))) {
    const numeric = Number(value);
    parsed = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
  } else {
    parsed = new Date(value || Date.now());
  }
  const minimum = Date.UTC(2000, 0, 1);
  const maximum = Date.now() + 86_400_000;
  return Number.isFinite(parsed.getTime()) && parsed.getTime() >= minimum && parsed.getTime() <= maximum ? parsed : new Date();
}

function normalizeStatus(value, eventType = "") {
  const type = String(eventType || "").toLowerCase();
  if (type === "read") return "read";
  const status = String(value || "").toLowerCase();
  if (["accepted", "queued", "sending", "submitted", "enqueued"].includes(status)) return "accepted";
  if (status === "sent") return "sent";
  if (status === "delivered") return "delivered";
  if (status === "read" || status === "seen") return "read";
  if (["failed", "undelivered", "rejected"].includes(status)) return "failed";
  return null;
}

export function buildWhatsAppWebhookUrl(provider, { query = {}, rawQuery = "" } = {}) {
  if (!PROVIDERS.has(provider) || !env.WHATSAPP_WEBHOOK_PUBLIC_URL) return null;
  const url = new URL(env.WHATSAPP_WEBHOOK_PUBLIC_URL);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${provider}`;
  url.search = "";
  if (rawQuery) url.search = rawQuery.startsWith("?") ? rawQuery : `?${rawQuery}`;
  else for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  return url.toString();
}

export function requiredWebhookConfiguration(provider = env.WHATSAPP_PROVIDER) {
  if (provider === "disabled") return [];
  const missing = [];
  if (!env.WHATSAPP_WEBHOOK_PUBLIC_URL) missing.push("WHATSAPP_WEBHOOK_PUBLIC_URL");
  if (["meta", "gupshup", "interakt"].includes(provider) && String(env.WHATSAPP_WEBHOOK_SECRET || "").length < 32) missing.push("WHATSAPP_WEBHOOK_SECRET");
  if (provider === "meta" && String(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "").length < 16) missing.push("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
  return missing;
}

function verifyHmac(rawBody, secret, received) {
  if (!Buffer.isBuffer(rawBody) || !secret || !received) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return constantTimeEqual(expected, received);
}

export function verifyMetaSubscription(query = {}) {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = String(query["hub.challenge"] || "").slice(0, 256);
  if (env.WHATSAPP_PROVIDER !== "meta" || String(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "").length < 16) {
    throw webhookError("Webhook provider is not active", 404, "WHATSAPP_WEBHOOK_PROVIDER_INACTIVE");
  }
  if (mode !== "subscribe" || !challenge || !constantTimeEqual(token, env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)) {
    throw webhookError("Webhook verification failed", 403, "WHATSAPP_WEBHOOK_VERIFICATION_FAILED");
  }
  return challenge;
}

export function verifyProviderWebhook({ provider, rawBody, body = {}, headers = {}, query = {}, rawQuery = "" }) {
  if (!PROVIDERS.has(provider) || provider !== env.WHATSAPP_PROVIDER) {
    throw webhookError("Webhook provider is not active", 404, "WHATSAPP_WEBHOOK_PROVIDER_INACTIVE");
  }
  const missing = requiredWebhookConfiguration(provider);
  if (missing.length) throw webhookError("Webhook is not configured", 503, "WHATSAPP_WEBHOOK_NOT_CONFIGURED");

  let valid = false;
  if (provider === "meta") {
    valid = verifyHmac(rawBody, env.WHATSAPP_WEBHOOK_SECRET, headerValue(headers, "x-hub-signature-256"));
  } else if (provider === "interakt") {
    valid = verifyHmac(rawBody, env.WHATSAPP_WEBHOOK_SECRET, headerValue(headers, "interakt-signature"));
  } else if (provider === "twilio") {
    const signature = headerValue(headers, "x-twilio-signature");
    const publicUrl = buildWhatsAppWebhookUrl(provider, { rawQuery });
    valid = Boolean(signature && publicUrl && twilio.validateRequest(env.WHATSAPP_API_SECRET, signature, publicUrl, body));
  } else if (provider === "gupshup") {
    const supplied = headerValue(headers, "x-kiranaos-webhook-secret") || query.token;
    valid = constantTimeEqual(supplied, env.WHATSAPP_WEBHOOK_SECRET);
  }
  if (!valid) throw webhookError("Invalid webhook signature", 401, "WHATSAPP_WEBHOOK_SIGNATURE_INVALID");
  return true;
}

function parseJsonBody(rawBody, body) {
  if (Buffer.isBuffer(rawBody)) {
    try { return JSON.parse(rawBody.toString("utf8")); }
    catch { throw webhookError("Invalid webhook JSON", 400, "WHATSAPP_WEBHOOK_JSON_INVALID"); }
  }
  if (body && typeof body === "object") return body;
  throw webhookError("Invalid webhook payload", 400, "WHATSAPP_WEBHOOK_PAYLOAD_INVALID");
}

function metaEvents(payload) {
  const rows = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      for (const item of Array.isArray(change?.value?.statuses) ? change.value.statuses : []) {
        const status = normalizeStatus(item?.status);
        const providerMessageId = validReference(item?.id);
        if (status && providerMessageId) rows.push({ providerMessageId, status, eventAt: eventDate(item?.timestamp), errorCode: safeErrorCode(item?.errors?.[0]?.code) });
      }
    }
  }
  return rows;
}

function twilioEvents(payload, fallbackReminderLogId) {
  const providerMessageId = validReference(payload?.MessageSid ?? payload?.SmsSid);
  const status = normalizeStatus(payload?.MessageStatus ?? payload?.SmsStatus, payload?.EventType);
  return providerMessageId && status
    ? [{ providerMessageId, status, eventAt: eventDate(payload?.Timestamp ?? payload?.DateUpdated), errorCode: safeErrorCode(payload?.ErrorCode), reminderLogId: fallbackReminderLogId }]
    : [];
}

function gupshupEvents(payload) {
  if (payload?.type === "message-event") {
    const status = normalizeStatus(payload?.payload?.type);
    const providerMessageId = validReference(payload?.payload?.gsId ?? payload?.payload?.id);
    return status && providerMessageId
      ? [{ providerMessageId, status, eventAt: eventDate(payload?.payload?.payload?.ts ?? payload?.timestamp), errorCode: safeErrorCode(payload?.payload?.payload?.code) }]
      : [];
  }
  const status = normalizeStatus(payload?.eventType ?? payload?.cause);
  const providerMessageId = validReference(payload?.externalId ?? payload?.messageId);
  return status && providerMessageId
    ? [{ providerMessageId, status, eventAt: eventDate(payload?.eventTs ?? payload?.timestamp), errorCode: safeErrorCode(payload?.errorCode) }]
    : [];
}

function interaktEvents(payload) {
  const type = String(payload?.type || "").toLowerCase();
  if (!/^message_(?:api|campaign)_(?:sent|delivered|read|failed)$/.test(type)) return [];
  const message = payload?.data?.message;
  const status = normalizeStatus(type.split("_").at(-1) ?? message?.message_status);
  const providerMessageId = validReference(message?.id);
  const reminderLogId = validReference(message?.meta_data?.source_data?.callback_data);
  const timestamp = status === "read" ? message?.seen_at_utc : status === "delivered" ? message?.delivered_at_utc : message?.received_at_utc;
  return status && providerMessageId
    ? [{ providerMessageId, status, eventAt: eventDate(timestamp ?? payload?.timestamp), errorCode: safeErrorCode(message?.channel_error_code), reminderLogId }]
    : [];
}

export function parseProviderStatusEvents(provider, rawBody, body = {}, query = {}) {
  const payload = provider === "twilio" ? body : parseJsonBody(rawBody, body);
  const fallbackReminderLogId = validReference(query.reminderLogId);
  if (provider === "meta") return metaEvents(payload);
  if (provider === "twilio") return twilioEvents(payload, fallbackReminderLogId);
  if (provider === "gupshup") return gupshupEvents(payload);
  if (provider === "interakt") return interaktEvents(payload);
  return [];
}

async function persistDeliveryEvent(provider, event) {
  try {
    return await db.reminderDeliveryEvent.create({ data: { provider, ...event } });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const existing = await db.reminderDeliveryEvent.findFirst({ where: { provider, providerMessageId: event.providerMessageId, status: event.status } });
    if (existing && !existing.reminderLogId && event.reminderLogId) {
      return db.reminderDeliveryEvent.update({ where: { id: existing.id }, data: { reminderLogId: event.reminderLogId } });
    }
    return existing;
  }
}

async function cleanupDeliveryEventsIfDue() {
  const now = Date.now();
  if (now - lastDeliveryEventCleanupAt < DELIVERY_EVENT_CLEANUP_INTERVAL_MS) return;
  lastDeliveryEventCleanupAt = now;
  try {
    await Promise.all([
      db.reminderDeliveryEvent.deleteMany({ where: { processedAt: { not: null }, receivedAt: { lt: new Date(now - 90 * 86_400_000) } } }),
      db.reminderDeliveryEvent.deleteMany({ where: { processedAt: null, receivedAt: { lt: new Date(now - 30 * 86_400_000) } } }),
    ]);
  } catch (error) {
    logger.warn({ type: "whatsapp_delivery_cleanup_failed", errorCode: error?.code ?? error?.name ?? "CLEANUP_FAILED" });
  }
}

function statusTimestampData(status, at) {
  if (status === "accepted") return { acceptedAt: at };
  if (status === "sent") return { sentAt: at };
  if (status === "delivered") return { deliveredAt: at };
  if (status === "read") return { readAt: at };
  if (status === "failed") return { failedAt: at };
  return {};
}

async function applyDeliveryEvent(event, fallbackReminderLogId = null) {
  let reminder = await db.reminderLog.findFirst({ where: { provider: event.provider, providerMessageId: event.providerMessageId } });
  const fallbackId = validReference(fallbackReminderLogId ?? event.reminderLogId);
  if (!reminder && fallbackId) {
    reminder = await db.reminderLog.findFirst({
      where: {
        id: fallbackId,
        provider: { in: ["disabled", event.provider] },
        OR: [{ providerMessageId: null }, { providerMessageId: event.providerMessageId }],
      },
    });
  }
  if (!reminder) return { matched: false, advanced: false };

  const allowedStatuses = STATUS_PREDECESSORS[event.status] ?? [];
  const failureCode = event.status === "failed" ? `WHATSAPP_DELIVERY_FAILED${event.errorCode ? `:${event.errorCode}` : ""}` : null;
  const changed = await db.reminderLog.updateMany({
    where: { id: reminder.id, status: { in: allowedStatuses } },
    data: {
      status: event.status,
      provider: event.provider,
      providerMessageId: reminder.providerMessageId ?? event.providerMessageId,
      error: failureCode,
      lastStatusAt: event.eventAt,
      ...statusTimestampData(event.status, event.eventAt),
    },
  });
  await db.reminderDeliveryEvent.update({ where: { id: event.id }, data: { reminderLogId: reminder.id, processedAt: new Date() } });
  if (changed.count !== 1) return { matched: true, advanced: false, reminderLogId: reminder.id };

  recordReminderMetric({ status: event.status, provider: event.provider, channel: reminder.channel });
  if (event.status === "failed") recordWhatsAppProviderError(event.provider, "delivery_failed");
  await createAuditLog({
    shopId: reminder.shopId,
    userId: reminder.requestedByUserId,
    action: ACTION_BY_STATUS[event.status],
    entityType: "ReminderLog",
    entityId: reminder.id,
    metadata: { customerId: reminder.customerId, channel: reminder.channel, provider: event.provider, status: event.status, errorCode: failureCode },
  });
  logger.info({ type: "whatsapp_delivery_status", shopId: reminder.shopId, customerId: reminder.customerId, reminderLogId: reminder.id, provider: event.provider, status: event.status });
  return { matched: true, advanced: true, reminderLogId: reminder.id };
}

export async function reconcileReminderDeliveryEvents(provider, providerMessageId, reminderLogId) {
  if (!validReference(providerMessageId)) return { matched: 0, advanced: 0 };
  const events = await db.reminderDeliveryEvent.findMany({
    where: { provider, providerMessageId, processedAt: null },
    orderBy: [{ eventAt: "asc" }, { receivedAt: "asc" }],
  });
  let matched = 0;
  let advanced = 0;
  for (const event of events) {
    const result = await applyDeliveryEvent(event, reminderLogId);
    if (result.matched) matched += 1;
    if (result.advanced) advanced += 1;
  }
  return { matched, advanced };
}

export async function handleProviderWebhook({ provider, rawBody, body, headers, query, rawQuery }) {
  verifyProviderWebhook({ provider, rawBody, body, headers, query, rawQuery });
  await cleanupDeliveryEventsIfDue();
  const parsed = parseProviderStatusEvents(provider, rawBody, body, query).slice(0, 100);
  let matched = 0;
  let advanced = 0;
  for (const candidate of parsed.sort((a, b) => a.eventAt - b.eventAt)) {
    const event = await persistDeliveryEvent(provider, candidate);
    if (!event) continue;
    const result = await applyDeliveryEvent(event, candidate.reminderLogId);
    if (result.matched) matched += 1;
    if (result.advanced) advanced += 1;
  }
  return { accepted: true, events: parsed.length, matched, advanced, pending: parsed.length - matched };
}

export const __whatsAppWebhookInternals = {
  constantTimeEqual,
  eventDate,
  gupshupEvents,
  interaktEvents,
  metaEvents,
  normalizeStatus,
  safeErrorCode,
  twilioEvents,
  verifyHmac,
};
