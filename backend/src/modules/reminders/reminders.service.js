import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { addJob, isQueueEnabled } from "../../lib/queue.js";
import { getWorkerHeartbeats } from "../../lib/workerHeartbeat.js";
import { logger } from "../../lib/logger.js";
import { recordReminderMetric, recordWhatsAppProviderError } from "../../lib/metrics.js";
import { QUEUE_NAMES, JOB_NAMES } from "../../workers/queueNames.js";
import { getWhatsAppProviderStatus } from "./whatsapp.provider.js";
import { reconcileReminderDeliveryEvents } from "./whatsapp.webhook.js";
import { createAuditLog } from "../audit/audit.service.js";
import { getReminderTemplate } from "./reminderTemplates.service.js";
import { calculateCustomerUdharBalance } from "../udhar/udharBalance.service.js";
import {
  DEFAULT_REMINDER_TEMPLATES,
  maskPhone,
  messagePreview,
  moneyForReminder,
  renderReminderTemplate,
  sanitizeTemplateValue,
  validateTemplateVariables,
} from "./reminderFormatter.js";

const reminderDecisionLocks = new Map();

async function withReminderDecisionLock(key, task) {
  const previous = reminderDecisionLocks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  reminderDecisionLocks.set(key, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (reminderDecisionLocks.get(key) === current) reminderDecisionLocks.delete(key);
  }
}

async function lockReminderCustomer(tx, shopId, customerId) {
  if (!/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL || "")) return;
  await tx.$queryRawUnsafe(
    'SELECT "id" FROM "Customer" WHERE "id" = $1 AND "shopId" = $2 FOR UPDATE',
    customerId,
    shopId,
  );
}

function appError(message, statusCode, code) {
  const err = new AppError(message, statusCode);
  err.code = code;
  return err;
}

async function writeRequiredReminderAudit(client, entry) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) throw appError("Reminder state could not be audited", 503, "AUDIT_WRITE_FAILED");
  return audit;
}

function nowMinusHours(hours) {
  const d = new Date();
  d.setHours(d.getHours() - Number(hours || 6));
  return d;
}

function canOverrideCooldown(user) {
  return ["owner", "admin"].includes(user?.role);
}

async function getShopAndCustomer(shopId, customerId, client = db) {
  const [shop, customer] = await Promise.all([
    client.shop.findUnique({ where: { id: shopId }, select: { id: true, name: true } }),
    client.customer.findFirst({ where: { id: customerId, shopId, deletedAt: null } }),
  ]);
  if (!shop) throw appError("Shop not found", 404, "SHOP_NOT_FOUND");
  if (!customer) throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  return { shop, customer };
}

async function lastPaymentDate(shopId, customerId, client = db) {
  const payment = await client.udharLedger.findFirst({
    // Real customer payments only: cancellation reversals are type "payment" with
    // mode "reversal" and must not read as "last paid on ...".
    where: { shopId, customerId, type: "payment", mode: { not: "reversal" }, reversedAt: null },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return payment?.createdAt ? payment.createdAt.toISOString().slice(0, 10) : "N/A";
}

async function buildVariables(shop, customer, extra = {}, client = db) {
  return {
    customerName: customer.name,
    shopName: shop.name,
    balance: moneyForReminder(customer.udharAmount),
    dueDate: customer.reminderOverrideUntil ? customer.reminderOverrideUntil.toISOString().slice(0, 10) : "N/A",
    lastPaymentDate: await lastPaymentDate(customer.shopId, customer.id, client),
    billCount: extra.billCount ?? 0,
    paidAmount: moneyForReminder(extra.paidAmount ?? 0),
    statementPeriod: extra.statementPeriod ?? "",
  };
}

async function checkCooldown(shopId, customerId, channel, client = db) {
  const since = nowMinusHours(env.REMINDER_COOLDOWN_HOURS);
  return client.reminderLog.findFirst({
    where: {
      shopId,
      customerId,
      channel,
      status: { in: ["queued", "sending", "accepted", "sent", "delivered", "read"] },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function createReminderLog({ shopId, customerId, channel, templateId = null, message, status, provider, error = null, requestedByUserId }, client = db) {
  return client.reminderLog.create({
    data: { shopId, customerId, channel, templateId, message, status, provider, error, requestedByUserId },
  });
}

async function createAuditedReminderLog(logData, auditData, client) {
  const log = await createReminderLog(logData, client);
  await writeRequiredReminderAudit(client, {
    shopId: log.shopId,
    userId: log.requestedByUserId,
    entityType: "ReminderLog",
    entityId: log.id,
    ...auditData,
  });
  return log;
}

export async function listReminderLogs(shopId, filters = {}, user = {}) {
  const where = {
    shopId,
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...((filters.from || filters.to) ? { createdAt: { ...(filters.from ? { gte: new Date(filters.from) } : {}), ...(filters.to ? { lte: new Date(filters.to) } : {}) } } : {}),
  };
  const rows = await db.reminderLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(filters.limit || 50), 1), 100),
    include: { customer: { select: { id: true, name: true, mobile: true } } },
  });
  const canViewFull = ["owner", "admin"].includes(user?.role);
  return rows.map((row) => ({
    id: row.id,
    customerId: row.customerId,
    customerName: row.customer?.name ?? null,
    customerMobileMasked: maskPhone(row.customer?.mobile),
    channel: row.channel,
    templateId: row.templateId,
    status: row.status,
    provider: row.provider,
    providerMessageId: row.providerMessageId,
    error: row.error,
    acceptedAt: row.acceptedAt,
    sentAt: row.sentAt,
    deliveredAt: row.deliveredAt,
    readAt: row.readAt,
    failedAt: row.failedAt,
    lastStatusAt: row.lastStatusAt,
    createdAt: row.createdAt,
    messagePreview: messagePreview(row.message),
    ...(canViewFull ? { message: row.message } : {}),
  }));
}

export async function getReminderStatus() {
  const provider = getWhatsAppProviderStatus();
  const queueEnabled = isQueueEnabled();
  const worker = await getWorkerHeartbeats();
  const workerHealthy = queueEnabled && worker.healthy;
  const operational = provider.configured && queueEnabled && workerHealthy;
  const code = !provider.configured
    ? "PROVIDER_SETUP_REQUIRED"
    : !queueEnabled
      ? "QUEUE_SETUP_REQUIRED"
      : !workerHealthy
        ? "WORKER_OFFLINE"
        : "OPERATIONAL";
  return {
    channel: "whatsapp",
    provider: provider.provider,
    providerSendConfigured: provider.sendConfigured,
    providerConfigured: provider.configured,
    webhookConfigured: provider.webhookConfigured,
    queueEnabled,
    workerHealthy,
    operational,
    code,
  };
}

async function enqueueOrSkip(log, userId, req) {
  recordReminderMetric({ status: "requested", provider: log.provider, channel: log.channel });
  if (!isQueueEnabled()) {
    const updated = await db.$transaction(async (tx) => {
      const saved = await tx.reminderLog.update({ where: { id: log.id }, data: { status: "skipped", error: "JOB_QUEUE_DISABLED" } });
      await writeRequiredReminderAudit(tx, { shopId: log.shopId, userId, action: "REMINDER_PROVIDER_NOT_CONFIGURED", entityType: "ReminderLog", entityId: log.id, metadata: { customerId: log.customerId, channel: log.channel, status: "skipped", provider: log.provider, reason: "JOB_QUEUE_DISABLED" }, req });
      return saved;
    }, { isolationLevel: "Serializable" });
    recordReminderMetric({ status: "skipped", provider: updated.provider, channel: updated.channel });
    return { log: updated, queued: false, code: "JOB_QUEUE_DISABLED" };
  }
  const queueResult = await addJob(QUEUE_NAMES.reminderQueue, JOB_NAMES.SEND_WHATSAPP_REMINDER, {
    reminderLogId: log.id,
    shopId: log.shopId,
    customerId: log.customerId,
    requestedAt: new Date().toISOString(),
  }, { jobId: `whatsapp-reminder-${log.id}` });
  if (!queueResult.success) {
    const code = queueResult.code || "JOB_QUEUE_UNAVAILABLE";
    const updated = await db.$transaction(async (tx) => {
      const saved = await tx.reminderLog.update({ where: { id: log.id }, data: { status: "failed", error: code, failedAt: new Date(), lastStatusAt: new Date() } });
      await writeRequiredReminderAudit(tx, { shopId: log.shopId, userId, action: "REMINDER_FAILED", entityType: "ReminderLog", entityId: log.id, metadata: { customerId: log.customerId, channel: log.channel, status: "failed", provider: log.provider, reason: code }, req });
      return saved;
    }, { isolationLevel: "Serializable" });
    recordReminderMetric({ status: "failed", provider: updated.provider, channel: updated.channel });
    return { log: updated, queued: false, code };
  }
  return { log, queued: true, queueJobId: queueResult.jobId };
}

async function reserveReminderDecision(shopId, user, input, { req = null, variables: extraVariables = {} } = {}) {
  const { customerId, channel, template, templateText, overrideCooldown } = input;
  const lockKey = `${shopId}:${customerId}:${channel}`;
  return withReminderDecisionLock(lockKey, () => db.$transaction(async (tx) => {
    // PostgreSQL's row lock closes the same race across app instances. The
    // in-process lock above provides deterministic parity for local SQLite.
    await lockReminderCustomer(tx, shopId, customerId);
    const { shop, customer } = await getShopAndCustomer(shopId, customerId, tx);
    if (!customer.mobile) throw appError("Customer phone/mobile is required for WhatsApp reminder", 400, "CUSTOMER_PHONE_REQUIRED");
    const derivedBalance = await calculateCustomerUdharBalance(tx, shopId, customerId);
    customer.udharAmount = derivedBalance.balance;
    const variables = await buildVariables(shop, customer, extraVariables, tx);
    const message = renderReminderTemplate(templateText, variables);

    if (Number(customer.udharAmount || 0) <= 0) {
      const log = await createAuditedReminderLog(
        { shopId, customerId, channel, templateId: template?.id ?? null, message, status: "skipped", provider: "disabled", error: "CUSTOMER_HAS_NO_PENDING_UDHAR", requestedByUserId: user?.userId },
        { action: "REMINDER_SKIPPED_NO_BALANCE", metadata: { customerId, channel, status: "skipped", reason: "CUSTOMER_HAS_NO_PENDING_UDHAR" }, req },
        tx,
      );
      return { log, message, code: "CUSTOMER_HAS_NO_PENDING_UDHAR", queued: false };
    }

    const cooldown = await checkCooldown(shopId, customerId, channel, tx);
    if (cooldown && !overrideCooldown) {
      const log = await createAuditedReminderLog(
        { shopId, customerId, channel, templateId: template?.id ?? null, message, status: "skipped", provider: "disabled", error: "REMINDER_COOLDOWN_ACTIVE", requestedByUserId: user?.userId },
        { action: "REMINDER_SKIPPED_COOLDOWN", metadata: { customerId, channel, cooldownHours: env.REMINDER_COOLDOWN_HOURS, blockingReminderLogId: cooldown.id }, req },
        tx,
      );
      return { log, message, code: "REMINDER_COOLDOWN_ACTIVE", queued: false };
    }

    const log = await createAuditedReminderLog(
      { shopId, customerId, channel, templateId: template?.id ?? null, message, status: "queued", provider: "disabled", requestedByUserId: user?.userId },
      { action: "REMINDER_REQUESTED", metadata: { customerId, templateId: template?.id ?? null, channel, status: "queued", overrideCooldown: Boolean(overrideCooldown) }, req },
      tx,
    );
    return { log, message, code: null, queued: true };
  }, { isolationLevel: "Serializable" }));
}

export async function sendReminder(shopId, user, input, { req = null, variables = {} } = {}) {
  const { customerId, channel = "whatsapp", templateId, customMessage, overrideCooldown = false } = input;
  if (channel !== "whatsapp") throw appError("Only WhatsApp reminders are enabled in this phase", 400, "CHANNEL_NOT_SUPPORTED");
  if (overrideCooldown && !canOverrideCooldown(user)) throw appError("Only owner/admin can override reminder cooldown", 403, "REMINDER_COOLDOWN_OVERRIDE_FORBIDDEN");

  let template = null;
  let templateText = customMessage;
  if (customMessage) {
    validateTemplateVariables(customMessage);
  } else {
    template = templateId
      ? await getReminderTemplate(shopId, templateId)
      : { id: null, templateText: DEFAULT_REMINDER_TEMPLATES[0].templateText };
    if (template.channel && template.channel !== channel) throw appError("Template channel mismatch", 400, "TEMPLATE_CHANNEL_MISMATCH");
    templateText = template.templateText;
  }

  const decision = await reserveReminderDecision(
    shopId,
    user,
    { customerId, channel, template, templateText, overrideCooldown },
    { req, variables },
  );
  if (!decision.queued) {
    recordReminderMetric({ status: "skipped", provider: decision.log.provider, channel });
    return { reminderLogId: decision.log.id, status: decision.log.status, code: decision.code, messagePreview: messagePreview(decision.message), providerConfigured: getWhatsAppProviderStatus().configured, queued: false };
  }

  logger.info({ type: "reminder_request", shopId, userId: user?.userId, customerId, channel, reminderLogId: decision.log.id, customerPhone: "[REDACTED]" });
  const result = await enqueueOrSkip(decision.log, user?.userId, req);
  return { reminderLogId: result.log.id, status: result.log.status, code: result.code, messagePreview: messagePreview(decision.message), providerConfigured: getWhatsAppProviderStatus().configured, queued: result.queued, queueJobId: result.queueJobId };
}

export async function sendStatementReminder(shopId, user, input, { req = null } = {}) {
  const { customerId, channel = "whatsapp", from, to, overrideCooldown = false } = input;
  if (channel !== "whatsapp") throw appError("Only WhatsApp statement reminders are enabled in this phase", 400, "CHANNEL_NOT_SUPPORTED");
  const { customer } = await getShopAndCustomer(shopId, customerId);
  if (!customer.mobile) throw appError("Customer phone/mobile is required for WhatsApp reminder", 400, "CUSTOMER_PHONE_REQUIRED");

  const where = { shopId, customerId, ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) };
  const [billCount, paymentAgg] = await Promise.all([
    db.bill.count({ where: { shopId, customerId, status: "active", ...(from || to ? { createdAt: where.createdAt } : {}) } }),
    // Real payments only — exclude cancellation reversals and reversed payments so the
    // statement message doesn't tell the customer they paid more than they did.
    db.udharLedger.aggregate({ where: { ...where, type: "payment", mode: { not: "reversal" }, reversedAt: null }, _sum: { amount: true } }),
  ]);
  const variables = {
    billCount,
    paidAmount: paymentAgg._sum.amount || 0,
    statementPeriod: `${from || "start"} to ${to || "today"}`,
  };
  return sendReminder(shopId, user, { customerId, channel, customMessage: DEFAULT_REMINDER_TEMPLATES[2].templateText, overrideCooldown }, { req, variables });
}

/**
 * Claim a queued reminder before crossing the provider boundary. A worker crash
 * after this point leaves an explicit `sending`/delivery-uncertain state instead
 * of automatically sending the same customer message twice on retry.
 */
export async function claimReminderForDispatch(reminderLogId) {
  return db.$transaction(async (tx) => {
    const existing = await tx.reminderLog.findUnique({ where: { id: reminderLogId } });
    if (!existing) throw appError("Reminder log not found", 404, "REMINDER_LOG_NOT_FOUND");
    if (existing.status !== "queued") return { log: existing, claimed: false };
    const claimedAt = new Date();
    const changed = await tx.reminderLog.updateMany({
      where: { id: reminderLogId, status: "queued" },
      data: { status: "sending", lastStatusAt: claimedAt },
    });
    if (changed.count !== 1) {
      return { log: await tx.reminderLog.findUnique({ where: { id: reminderLogId } }), claimed: false };
    }
    const claimed = await tx.reminderLog.findUnique({ where: { id: reminderLogId } });
    await writeRequiredReminderAudit(tx, {
      shopId: claimed.shopId,
      userId: claimed.requestedByUserId,
      action: "REMINDER_DISPATCH_STARTED",
      entityType: "ReminderLog",
      entityId: claimed.id,
      before: { status: "queued" },
      after: { status: "sending" },
      metadata: { customerId: claimed.customerId, channel: claimed.channel, claimedAt },
    });
    return { log: claimed, claimed: true };
  }, { isolationLevel: "Serializable" });
}

export async function markReminderFromProvider(reminderLogId, result, { req = null } = {}) {
  const status = result?.success ? "accepted" : (result?.status === "skipped" ? "skipped" : "failed");
  const transition = await db.$transaction(async (tx) => {
    const existing = await tx.reminderLog.findUnique({ where: { id: reminderLogId } });
    if (!existing) throw appError("Reminder log not found", 404, "REMINDER_LOG_NOT_FOUND");
    const changed = await tx.reminderLog.updateMany({
      where: { id: reminderLogId, status: { in: ["queued", "sending"] } },
      data: {
        status,
        provider: result?.provider ?? existing.provider ?? "disabled",
        providerMessageId: result?.providerMessageId ?? null,
        error: result?.success ? null : (result?.code || "WHATSAPP_SEND_FAILED"),
        acceptedAt: result?.success ? new Date(result?.acceptedAt || Date.now()) : null,
        failedAt: status === "failed" ? new Date() : null,
        lastStatusAt: new Date(),
      },
    });
    const updated = await tx.reminderLog.findUnique({ where: { id: reminderLogId } });
    if (changed.count !== 1) return { updated, changed: false };
    await writeRequiredReminderAudit(tx, {
      shopId: updated.shopId,
      userId: updated.requestedByUserId,
      action: status === "accepted" ? "REMINDER_ACCEPTED" : (status === "skipped" ? "REMINDER_PROVIDER_NOT_CONFIGURED" : "REMINDER_FAILED"),
      entityType: "ReminderLog",
      entityId: updated.id,
      before: { status: existing.status, provider: existing.provider, providerMessageId: existing.providerMessageId },
      after: { status, provider: updated.provider, providerMessageId: updated.providerMessageId },
      metadata: { customerId: updated.customerId, channel: updated.channel, status, provider: updated.provider, errorCode: updated.error },
      req,
    });
    return { updated, changed: true };
  }, { isolationLevel: "Serializable" });
  const updated = transition.updated;
  if (!transition.changed) return updated;
  recordReminderMetric({ status, provider: updated.provider, channel: updated.channel });
  if (status === "failed") recordWhatsAppProviderError(updated.provider, status);
  logger.info({ type: status === "accepted" ? "reminder_accepted" : status === "skipped" ? "reminder_skipped" : "reminder_failed", shopId: updated.shopId, customerId: updated.customerId, reminderLogId: updated.id, provider: updated.provider, status });
  if (status === "accepted" && updated.providerMessageId) {
    await reconcileReminderDeliveryEvents(updated.provider, updated.providerMessageId, updated.id);
    return db.reminderLog.findUnique({ where: { id: reminderLogId } });
  }
  return updated;
}

export const __remindersInternals = { checkCooldown, createReminderLog, enqueueOrSkip, reserveReminderDecision, sanitizeTemplateValue, withReminderDecisionLock };
