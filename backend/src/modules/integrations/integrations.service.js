import crypto from "crypto";
import dns from "dns/promises";
import net from "net";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { getObjectStorageStatus } from "../../lib/objectStorage.js";
import { recordIntegrationApiAuth, recordWebhookDelivery } from "../../lib/metrics.js";
import { dateRangeForDateOnly, daysBetweenInclusive, formatDateInTimeZone } from "../../utils/dates.js";
import { getWhatsAppProviderStatus } from "../reminders/whatsapp.provider.js";
import { hasFeature, requireFeatureAccess } from "../feature-gates/featureGate.service.js";
import { addJob } from "../../lib/queue.js";
import { JOB_NAMES, QUEUE_NAMES } from "../../workers/queueNames.js";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const MAX_ACTIVE_API_KEYS = 10;
const MAX_WEBHOOK_ENDPOINTS = 10;
const MAX_TALLY_BILLS = 10000;

function jsonArray(value) {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export function hashApiKey(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest("hex");
}

export function deriveWebhookSecret(endpointId) {
  const root = env.INTEGRATION_SIGNING_SECRET || env.JWT_SECRET;
  return `whsec_${crypto.createHmac("sha256", root).update(`kiranaos:webhook:${endpointId}`).digest("base64url")}`;
}

export function signWebhookPayload({ endpointId, timestamp, body }) {
  return crypto.createHmac("sha256", deriveWebhookSecret(endpointId)).update(`${timestamp}.${body}`).digest("hex");
}

function isPrivateIp(address) {
  if (!address) return true;
  if (address === "::1" || address === "::" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  const normalized = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (!net.isIPv4(normalized)) return false;
  const [a, b] = normalized.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

export function assertWebhookUrlSyntax(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new AppError("Webhook URL is invalid", 400, "WEBHOOK_URL_INVALID"); }
  if (url.username || url.password) throw new AppError("Webhook URL cannot contain credentials", 400, "WEBHOOK_URL_CREDENTIALS_FORBIDDEN");
  if (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && url.protocol === "http:")) {
    throw new AppError("Webhook URL must use HTTPS", 400, "WEBHOOK_HTTPS_REQUIRED");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || isPrivateIp(hostname)) {
    throw new AppError("Private and local webhook destinations are blocked", 400, "WEBHOOK_PRIVATE_DESTINATION");
  }
  return url;
}

async function assertPublicDestination(rawUrl) {
  const url = assertWebhookUrlSyntax(rawUrl);
  const results = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!results.length || results.some(({ address }) => isPrivateIp(address))) {
    throw new AppError("Webhook destination resolved to a private address", 400, "WEBHOOK_PRIVATE_DESTINATION");
  }
  return url;
}

export async function getOverview(shopId) {
  const [activeKeys, activeWebhooks, recentDeliveries] = await Promise.all([
    db.integrationApiKey.count({ where: { shopId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
    db.webhookEndpoint.count({ where: { shopId, enabled: true, deletedAt: null } }),
    db.webhookDelivery.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, eventType: true, status: true, httpStatus: true, durationMs: true, createdAt: true, lastAttemptAt: true } }),
  ]);
  const storage = getObjectStorageStatus();
  const whatsapp = getWhatsAppProviderStatus();
  const providers = [
    { id: "razorpay", name: "Razorpay", category: "Payments", status: env.RAZORPAY_ENABLED && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET ? "ready" : "setup_required", detail: "Hosted subscription checkout and verified payment webhooks" },
    { id: "whatsapp", name: "WhatsApp Business", category: "Messaging", status: whatsapp.implemented && whatsapp.configured ? "ready" : whatsapp.configured ? "adapter_required" : "setup_required", detail: whatsapp.implemented ? "Provider adapter configured" : "Reminder workflow exists; provider adapter is not yet certified" },
    { id: "storage", name: storage.provider === "local" ? "Local export storage" : `${storage.provider.toUpperCase()} object storage`, category: "Storage", status: storage.provider === "local" ? "development_only" : storage.bucketConfigured ? "ready" : "setup_required", detail: storage.provider === "local" ? "Use S3, R2, or MinIO before production" : "Encrypted export object storage" },
    { id: "tally", name: "TallyPrime XML", category: "Accounting", status: "ready", detail: "Tenant-scoped voucher export with date filters" },
    { id: "api", name: "KiranaOS API", category: "Developer", status: activeKeys > 0 ? "ready" : "available", detail: `${activeKeys} active scoped key${activeKeys === 1 ? "" : "s"}` },
    { id: "webhooks", name: "Signed webhooks", category: "Developer", status: activeWebhooks > 0 ? "ready" : "available", detail: `${activeWebhooks} active endpoint${activeWebhooks === 1 ? "" : "s"}; HMAC-SHA256 signatures and delivery logs` },
  ];
  const ready = providers.filter((provider) => provider.status === "ready").length;
  return { maturityScore: Math.round((ready / providers.length) * 100), activeKeys, activeWebhooks, providers, recentDeliveries, supportedEvents: ["bill.created", "payment.recorded", "customer.updated", "integration.test"] };
}

export async function listApiKeys(shopId) {
  const rows = await db.integrationApiKey.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, keyPrefix: true, scopesJson: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true } });
  return rows.map((row) => ({ ...row, scopes: jsonArray(row.scopesJson), scopesJson: undefined }));
}

export async function createApiKey({ shopId, userId, input }) {
  const activeCount = await db.integrationApiKey.count({ where: { shopId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  if (activeCount >= MAX_ACTIVE_API_KEYS) throw new AppError(`A shop can have at most ${MAX_ACTIVE_API_KEYS} active API keys`, 409, "INTEGRATION_KEY_LIMIT_REACHED");
  const raw = crypto.randomBytes(32).toString("base64url");
  const secret = `kos_${env.NODE_ENV === "production" ? "live" : "test"}_${raw}`;
  const row = await db.integrationApiKey.create({ data: { shopId, name: input.name, keyPrefix: secret.slice(0, 18), keyHash: hashApiKey(secret), scopesJson: JSON.stringify([...new Set(input.scopes)].sort()), createdByUserId: userId || null, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }, select: { id: true, name: true, keyPrefix: true, scopesJson: true, expiresAt: true, createdAt: true } });
  return { ...row, scopes: jsonArray(row.scopesJson), scopesJson: undefined, secret };
}

export async function revokeApiKey(shopId, id) {
  const result = await db.integrationApiKey.updateMany({ where: { id, shopId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!result.count) throw new AppError("API key not found or already revoked", 404, "INTEGRATION_KEY_NOT_FOUND");
}

export async function authenticateApiKey(secret) {
  if (!/^kos_(live|test)_[A-Za-z0-9_-]{32,}$/.test(secret || "")) {
    recordIntegrationApiAuth("invalid_format");
    throw new AppError("Valid integration API key required", 401, "INTEGRATION_KEY_INVALID");
  }
  const row = await db.integrationApiKey.findUnique({ where: { keyHash: hashApiKey(secret) } });
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= new Date())) {
    recordIntegrationApiAuth(row?.revokedAt ? "revoked" : row?.expiresAt ? "expired" : "not_found");
    throw new AppError("Integration API key is invalid, expired, or revoked", 401, "INTEGRATION_KEY_INVALID");
  }
  await requireFeatureAccess(row.shopId, "api_webhook_later");
  recordIntegrationApiAuth("success");
  void db.integrationApiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { id: row.id, shopId: row.shopId, scopes: jsonArray(row.scopesJson) };
}

export async function listWebhookEndpoints(shopId) {
  const rows = await db.webhookEndpoint.findMany({ where: { shopId, deletedAt: null }, orderBy: { createdAt: "desc" }, include: { _count: { select: { deliveries: true } } } });
  return rows.map((row) => ({ ...row, events: jsonArray(row.eventsJson), eventsJson: undefined, signingSecretConfigured: true }));
}

export async function createWebhookEndpoint({ shopId, userId, input }) {
  const url = assertWebhookUrlSyntax(input.url).toString();
  const [endpointCount, duplicate] = await Promise.all([
    db.webhookEndpoint.count({ where: { shopId, deletedAt: null } }),
    db.webhookEndpoint.findFirst({ where: { shopId, deletedAt: null, url }, select: { id: true } }),
  ]);
  if (endpointCount >= MAX_WEBHOOK_ENDPOINTS) throw new AppError(`A shop can have at most ${MAX_WEBHOOK_ENDPOINTS} webhook endpoints`, 409, "WEBHOOK_LIMIT_REACHED");
  if (duplicate) throw new AppError("This webhook URL is already configured", 409, "WEBHOOK_URL_DUPLICATE");
  const row = await db.webhookEndpoint.create({ data: { shopId, name: input.name, url, eventsJson: JSON.stringify([...new Set(input.events)].sort()), createdByUserId: userId || null } });
  return { ...row, events: jsonArray(row.eventsJson), eventsJson: undefined, secret: deriveWebhookSecret(row.id) };
}

export async function updateWebhookEndpoint(shopId, id, input) {
  const normalizedUrl = input.url ? assertWebhookUrlSyntax(input.url).toString() : undefined;
  const existing = await db.webhookEndpoint.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!existing) throw new AppError("Webhook endpoint not found", 404, "WEBHOOK_NOT_FOUND");
  if (normalizedUrl) {
    const duplicate = await db.webhookEndpoint.findFirst({ where: { shopId, url: normalizedUrl, deletedAt: null, NOT: { id } }, select: { id: true } });
    if (duplicate) throw new AppError("This webhook URL is already configured", 409, "WEBHOOK_URL_DUPLICATE");
  }
  const row = await db.webhookEndpoint.update({ where: { id }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(normalizedUrl !== undefined ? { url: normalizedUrl } : {}), ...(input.events !== undefined ? { eventsJson: JSON.stringify([...new Set(input.events)].sort()) } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) } });
  return { ...row, events: jsonArray(row.eventsJson), eventsJson: undefined };
}

export async function deleteWebhookEndpoint(shopId, id) {
  const result = await db.webhookEndpoint.updateMany({ where: { id, shopId, deletedAt: null }, data: { enabled: false, deletedAt: new Date() } });
  if (!result.count) throw new AppError("Webhook endpoint not found", 404, "WEBHOOK_NOT_FOUND");
}

export async function listWebhookDeliveries(shopId, { limit, cursor }) {
  return db.webhookDelivery.findMany({ where: { shopId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, endpointId: true, eventId: true, eventType: true, status: true, attemptCount: true, httpStatus: true, durationMs: true, responseSnippet: true, lastError: true, lastAttemptAt: true, deliveredAt: true, createdAt: true } });
}

export async function testWebhookEndpoint(shopId, endpointId) {
  const endpoint = await db.webhookEndpoint.findFirst({ where: { id: endpointId, shopId, deletedAt: null } });
  if (!endpoint) throw new AppError("Webhook endpoint not found", 404, "WEBHOOK_NOT_FOUND");
  return deliverWebhook(endpoint, "integration.test", { message: "KiranaOS webhook connection test", shopId, sentAt: new Date().toISOString() });
}

export async function retryWebhookDelivery(shopId, deliveryId) {
  const delivery = await db.webhookDelivery.findFirst({ where: { id: deliveryId, shopId }, include: { endpoint: true } });
  if (!delivery || delivery.endpoint.deletedAt) throw new AppError("Webhook delivery not found or endpoint has been archived", 404, "WEBHOOK_DELIVERY_NOT_FOUND");
  return deliverWebhook(delivery.endpoint, delivery.eventType, JSON.parse(delivery.payloadJson), delivery.eventId, delivery.createdAt);
}

async function scheduleWebhookDelivery(delivery) {
  try {
    const queued = await addJob(
      QUEUE_NAMES.webhooksQueue,
      JOB_NAMES.DELIVER_WEBHOOK,
      { shopId: delivery.shopId, deliveryId: delivery.id },
      { jobId: `webhook_${delivery.id}` },
    );
    if (queued.queued) return { deliveryId: delivery.id, queued: true };
  } catch {
    // Redis is an accelerator here, not a reason to lose a persisted event.
  }
  setImmediate(() => {
    void retryWebhookDelivery(delivery.shopId, delivery.id).catch(() => {});
  });
  return { deliveryId: delivery.id, queued: false };
}

export async function recoverWebhookDeliveries({ limit = 100 } = {}) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const deliveries = await db.webhookDelivery.findMany({
    where: {
      status: { in: ["pending", "failed"] },
      attemptCount: { lt: 3 },
      createdAt: { gte: since },
      endpoint: { enabled: true, deletedAt: null },
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(Number(limit) || 100, 1), 500),
  });
  await Promise.all(deliveries.map(scheduleWebhookDelivery));
  return { recovered: deliveries.length };
}

export async function readResponseSnippet(response, maxBytes = 2048) {
  if (!response.body?.getReader) return (await response.text()).slice(0, 500);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      const remaining = maxBytes - total;
      chunks.push(chunk.subarray(0, remaining));
      total += Math.min(chunk.length, remaining);
      if (chunk.length > remaining) break;
    }
  } finally {
    try { await reader.cancel(); } catch { /* response stream already closed */ }
  }
  return Buffer.concat(chunks).toString("utf8").slice(0, 500);
}

function integrationJsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function deliverWebhook(endpoint, eventType, payload, existingEventId = null, existingCreatedAt = null) {
  if (!endpoint.enabled) throw new AppError("Webhook endpoint is disabled", 409, "WEBHOOK_DISABLED");
  const eventId = existingEventId || `evt_${crypto.randomUUID().replaceAll("-", "")}`;
  const eventCreatedAt = existingCreatedAt ? new Date(existingCreatedAt).toISOString() : new Date().toISOString();
  const payloadJson = JSON.stringify(payload, integrationJsonReplacer);
  const body = JSON.stringify({ id: eventId, type: eventType, createdAt: eventCreatedAt, data: JSON.parse(payloadJson) });
  if (Buffer.byteLength(body) > MAX_WEBHOOK_BODY_BYTES) throw new AppError("Webhook payload is too large", 413, "WEBHOOK_PAYLOAD_TOO_LARGE");
  const delivery = await db.webhookDelivery.upsert({ where: { endpointId_eventId: { endpointId: endpoint.id, eventId } }, create: { shopId: endpoint.shopId, endpointId: endpoint.id, eventId, eventType, payloadJson }, update: {} });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhookPayload({ endpointId: endpoint.id, timestamp, body });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.INTEGRATION_WEBHOOK_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    await assertPublicDestination(endpoint.url);
    const response = await fetch(endpoint.url, { method: "POST", redirect: "error", signal: controller.signal, headers: { "content-type": "application/json", "user-agent": "KiranaOS-Webhooks/1.0", "x-kiranaos-event": eventType, "x-kiranaos-delivery": delivery.id, "x-kiranaos-timestamp": timestamp, "x-kiranaos-signature": `v1=${signature}` }, body });
    const responseSnippet = await readResponseSnippet(response);
    const delivered = response.ok;
    const now = new Date();
    const updated = await db.webhookDelivery.update({ where: { id: delivery.id }, data: { status: delivered ? "delivered" : "failed", attemptCount: { increment: 1 }, httpStatus: response.status, durationMs: Date.now() - startedAt, responseSnippet, lastError: delivered ? null : `HTTP ${response.status}`, lastAttemptAt: now, deliveredAt: delivered ? now : null } });
    await db.webhookEndpoint.update({ where: { id: endpoint.id }, data: delivered ? { lastSuccessAt: now, lastError: null } : { lastFailureAt: now, lastError: `HTTP ${response.status}` } });
    recordWebhookDelivery({ eventType, status: updated.status, durationMs: updated.durationMs });
    return updated;
  } catch (error) {
    const message = error?.name === "AbortError" ? "Webhook request timed out" : String(error?.message || "Webhook request failed").slice(0, 500);
    const now = new Date();
    const updated = await db.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "failed", attemptCount: { increment: 1 }, httpStatus: null, responseSnippet: null, deliveredAt: null, durationMs: Date.now() - startedAt, lastError: message, lastAttemptAt: now } });
    await db.webhookEndpoint.update({ where: { id: endpoint.id }, data: { lastFailureAt: now, lastError: message } });
    recordWebhookDelivery({ eventType, status: "failed", durationMs: updated.durationMs });
    return updated;
  } finally { clearTimeout(timer); }
}

// Business writes call this only after their database transaction succeeds.
// Persist pending delivery evidence before returning, then perform network I/O
// in the background. A slow consumer never blocks the POS response, while an
// immediate process restart cannot make the event disappear without a trace.
export async function publishIntegrationEvent(shopId, eventType, payload) {
  if (!(await hasFeature(shopId, "api_webhook_later"))) return [];
  const endpoints = await db.webhookEndpoint.findMany({ where: { shopId, enabled: true, deletedAt: null } });
  const matching = endpoints.filter((endpoint) => jsonArray(endpoint.eventsJson).includes(eventType));
  if (!matching.length) return [];
  const eventId = `evt_${crypto.randomUUID().replaceAll("-", "")}`;
  const eventCreatedAt = new Date();
  const payloadJson = JSON.stringify(payload, integrationJsonReplacer);
  const envelope = JSON.stringify({ id: eventId, type: eventType, createdAt: eventCreatedAt.toISOString(), data: JSON.parse(payloadJson) });
  if (Buffer.byteLength(envelope) > MAX_WEBHOOK_BODY_BYTES) throw new AppError("Webhook payload is too large", 413, "WEBHOOK_PAYLOAD_TOO_LARGE");

  const pending = await Promise.all(matching.map((endpoint) => db.webhookDelivery.create({
    data: { shopId, endpointId: endpoint.id, eventId, eventType, payloadJson },
  })));

  await Promise.all(pending.map(scheduleWebhookDelivery));
  return pending;
}

export async function listApiResource({ shopId, resource, scope, query }) {
  if (!scope) throw new AppError("API key does not have the required scope", 403, "INTEGRATION_SCOPE_REQUIRED");
  const take = query.limit;
  const cursorFilter = query.cursor ? { id: { gt: query.cursor } } : {};
  let rows;
  if (resource === "catalog") rows = await db.product.findMany({ where: { shopId, deletedAt: null, ...cursorFilter }, orderBy: { id: "asc" }, take: take + 1, select: { id: true, name: true, category: true, sku: true, barcode: true, displayUnit: true, stockBaseQty: true, defaultPricePerRateUnit: true, gstRate: true, updatedAt: true } });
  else if (resource === "customers") rows = await db.customer.findMany({ where: { shopId, deletedAt: null, ...cursorFilter }, orderBy: { id: "asc" }, take: take + 1, select: { id: true, name: true, mobile: true, type: true, customerGroup: true, udharAmount: true, updatedAt: true } });
  else rows = await db.bill.findMany({ where: { shopId, ...cursorFilter }, orderBy: { id: "asc" }, take: take + 1, select: { id: true, billNo: true, billType: true, status: true, customerName: true, grandTotal: true, paidAmount: true, creditAmount: true, createdAt: true, updatedAt: true } });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, hasMore, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}

function xml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
function tallyDate(date, timeZone = env.DAILY_CLOSING_TIMEZONE) { return formatDateInTimeZone(date, timeZone).replaceAll("-", ""); }

export async function buildTallyExport(shopId, query) {
  const timeZone = env.DAILY_CLOSING_TIMEZONE;
  const toKey = query.to || formatDateInTimeZone(new Date(), timeZone);
  const defaultFromDate = new Date(`${toKey}T12:00:00.000Z`);
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 29);
  const fromKey = query.from || defaultFromDate.toISOString().slice(0, 10);
  const fromRange = dateRangeForDateOnly(fromKey, timeZone);
  const toRange = dateRangeForDateOnly(toKey, timeZone);
  const from = fromRange.start;
  const to = toRange.end;
  if (from > to || daysBetweenInclusive(from, to) > 366) throw new AppError("Choose a valid date range of up to 366 days", 400, "EXPORT_DATE_RANGE_INVALID");
  const [shop, bills] = await Promise.all([
    db.shop.findUnique({ where: { id: shopId }, select: { name: true, gstNumber: true } }),
    db.bill.findMany({ where: { shopId, status: "active", billType: { not: "estimate" }, createdAt: { gte: from, lte: to } }, orderBy: { createdAt: "asc" }, take: MAX_TALLY_BILLS + 1 }),
  ]);
  if (bills.length > MAX_TALLY_BILLS) throw new AppError(`Export exceeds ${MAX_TALLY_BILLS} bills. Choose a smaller date range.`, 422, "TALLY_EXPORT_TOO_LARGE");
  const vouchers = bills.map((bill) => {
    const isReturn = bill.billType === "sales_return";
    const voucherType = isReturn ? "Credit Note" : "Sales";
    const party = bill.customerName && bill.customerName !== "Walk-in" ? bill.customerName : "Cash";
    const total = Math.abs(Number(bill.grandTotal || 0)).toFixed(2);
    const partyAmount = isReturn ? total : `-${total}`;
    const salesAmount = isReturn ? `-${total}` : total;
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${voucherType}" ACTION="Create"><DATE>${tallyDate(bill.createdAt, timeZone)}</DATE><VOUCHERNUMBER>${xml(bill.billNo)}</VOUCHERNUMBER><PARTYLEDGERNAME>${xml(party)}</PARTYLEDGERNAME><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><NARRATION>KiranaOS ${xml(bill.billType)}</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>${isReturn ? "No" : "Yes"}</ISDEEMEDPOSITIVE><AMOUNT>${partyAmount}</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>${isReturn ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${salesAmount}</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>`;
  }).join("");
  return { filename: `kiranaos-tally-${fromKey}-${toKey}.xml`, xml: `<?xml version="1.0" encoding="UTF-8"?><ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xml(shop?.name || "KiranaOS")}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>${vouchers}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`, count: bills.length };
}
