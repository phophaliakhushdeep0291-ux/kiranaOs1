import crypto from "crypto";
import dns from "dns/promises";
import http from "http";
import https from "https";
import net from "net";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { retailPaymentReadinessForShop } from "../payment-provider/retailPayment.service.js";
import { gspHttpReadiness } from "../compliance/gsp-http.provider.js";
import { AppError } from "../../middleware/error.js";
import { getObjectStorageStatus } from "../../lib/objectStorage.js";
import { recordIntegrationApiAuth, recordWebhookDelivery, recordWebhookQueueDispatch } from "../../lib/metrics.js";
import { dateRangeForDateOnly, daysBetweenInclusive, formatDateInTimeZone } from "../../utils/dates.js";
import { getWhatsAppProviderStatus } from "../reminders/whatsapp.provider.js";
import { hasFeature, requireFeatureAccess } from "../feature-gates/featureGate.service.js";
import { addJob } from "../../lib/queue.js";
import { JOB_NAMES, QUEUE_NAMES } from "../../workers/queueNames.js";
import { buildTallyEnvelope } from "./tally-voucher.js";
import { validateGstin } from "../../utils/gst.js";
import { createAuditLog } from "../audit/audit.service.js";
import { baseQtyToRateQty } from "../../utils/units.js";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const MAX_ACTIVE_API_KEYS = 10;
const MAX_WEBHOOK_ENDPOINTS = 10;
const MAX_TALLY_BILLS = 10000;
const MAX_TALLY_INVENTORY_BILLS = 2000;
const MAX_TALLY_VOUCHERS = 20000;

async function writeRequiredIntegrationAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Integration change was not saved because its audit record could not be stored",
      503,
      "INTEGRATION_AUDIT_UNAVAILABLE",
    );
  }
  return audit;
}

function apiKeyAuditSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: jsonArray(row.scopesJson),
    expiresAt: row.expiresAt ?? null,
    revokedAt: row.revokedAt ?? null,
  };
}

function webhookAuditSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: jsonArray(row.eventsJson),
    enabled: row.enabled,
    deletedAt: row.deletedAt ?? null,
  };
}

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
  const lower = String(address).toLowerCase();
  if (lower === "::1" || lower === "::" || /^fe[89ab]/.test(lower) || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("ff") || lower.startsWith("2001:db8:")) return true;
  const normalized = lower.startsWith("::ffff:") ? lower.slice(7) : lower;
  if (!net.isIPv4(normalized)) return false;
  const [a, b, c] = normalized.split(".").map(Number);
  return a === 0 || a === 10 || (a === 100 && b >= 64 && b <= 127) || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113) || a >= 224;
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

async function resolvePublicDestination(rawUrl) {
  const url = assertWebhookUrlSyntax(rawUrl);
  const results = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!results.length || results.some(({ address }) => isPrivateIp(address))) {
    throw new AppError("Webhook destination resolved to a private address", 400, "WEBHOOK_PRIVATE_DESTINATION");
  }
  return { url, address: results[0].address, family: results[0].family };
}

export function createPinnedLookup({ address, family }) {
  return (_hostname, _options, callback) => callback(null, address, family);
}

async function postWebhookRequest({ rawUrl, headers, body, signal, maxResponseBytes = 2048 }) {
  const destination = await resolvePublicDestination(rawUrl);
  const transport = destination.url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    const request = transport.request(destination.url, {
      method: "POST",
      headers: { ...headers, "content-length": Buffer.byteLength(body) },
      lookup: createPinnedLookup(destination),
      agent: false,
    }, (response) => {
      const chunks = [];
      let total = 0;
      response.on("data", (value) => {
        if (total >= maxResponseBytes) return;
        const chunk = Buffer.from(value);
        const remaining = maxResponseBytes - total;
        chunks.push(chunk.subarray(0, remaining));
        total += Math.min(chunk.length, remaining);
      });
      response.on("end", () => finish(null, {
        status: response.statusCode || 0,
        ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300,
        responseSnippet: Buffer.concat(chunks).toString("utf8").slice(0, 500),
      }));
      response.on("error", (error) => finish(error));
      response.on("aborted", () => finish(new Error("Webhook response ended unexpectedly")));
      response.on("close", () => {
        if (!response.complete) finish(new Error("Webhook response closed before completion"));
      });
    });
    const abort = () => {
      const error = new Error("Webhook request timed out");
      error.name = "AbortError";
      request.destroy(error);
    };
    request.on("error", (error) => finish(error));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    request.end(body);
  });
}

export async function getOverview(shopId) {
  const [activeKeys, activeWebhooks, recentDeliveries, developerAllowed, tallyAllowed, shopSettings] = await Promise.all([
    db.integrationApiKey.count({ where: { shopId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
    db.webhookEndpoint.count({ where: { shopId, enabled: true, deletedAt: null } }),
    db.webhookDelivery.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, eventType: true, status: true, httpStatus: true, durationMs: true, createdAt: true, lastAttemptAt: true } }),
    hasFeature(shopId, "api_webhook_later"),
    hasFeature(shopId, "tally_export"),
    db.shop.findUnique({ where: { id: shopId }, select: { settingsJson: true } }),
  ]);
  const storage = getObjectStorageStatus();
  const whatsapp = getWhatsAppProviderStatus();
  const retailPayment = await retailPaymentReadinessForShop(shopId);
  const gstProvider = env.GST_PROVIDER === "gsp_http" ? gspHttpReadiness() : { configured: env.GST_PROVIDER === "sandbox", legalSubmission: false, providerName: env.GST_PROVIDER === "sandbox" ? "Sandbox" : null };
  let flipkartLocationCount = 0;
  try {
    const mapping = JSON.parse(env.FLIPKART_LOCATION_MAP_JSON || "{}");
    if (mapping && !Array.isArray(mapping) && typeof mapping === "object") flipkartLocationCount = Object.keys(mapping).length;
  } catch { /* readiness remains setup_required */ }
  const flipkartBound = Boolean(
    env.FLIPKART_SELLER_API_ENABLED
    && env.FLIPKART_APP_ID
    && env.FLIPKART_APP_SECRET
    && env.FLIPKART_SHOP_ID === shopId
    && flipkartLocationCount > 0,
  );
  let printerConnection = "browser";
  try { printerConnection = JSON.parse(shopSettings?.settingsJson || "{}")?.printer?.connection || "browser"; } catch { printerConnection = "browser"; }
  const providers = [
    { id: "razorpay", name: "Razorpay subscriptions", category: "Payments", status: env.RAZORPAY_ENABLED && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET ? "ready" : "setup_required", detail: "Hosted subscription checkout and verified payment webhooks" },
    { id: "retail_payments", name: "Verified retail payments", category: "Payments", status: retailPayment.configured ? "ready" : "setup_required", detail: retailPayment.configured ? `Server-verified ${retailPayment.provider} intents; confirmation ${retailPayment.confirmationRequired ? "required" : "optional"}` : "Cash and operator-confirmed UPI work; provider verification is not configured" },
    { id: "gstn", name: "GSTN e-invoice provider", category: "Compliance", status: gstProvider.legalSubmission ? "ready" : gstProvider.configured ? "sandbox_only" : "setup_required", detail: gstProvider.legalSubmission ? `${gstProvider.providerName} legal IRN submission enabled` : "GST register export works; legal IRN submission remains disabled" },
    { id: "hardware_bridge", name: "Thermal printer & counter hardware", category: "Hardware", status: printerConnection === "bridge" ? "available" : "adapter_required", detail: printerConnection === "bridge" ? "Loopback-only hardware bridge selected; readiness is verified on each counter device" : "Browser/system printing works; select the local bridge for direct cutter, drawer and scale commands" },
    { id: "whatsapp", name: "WhatsApp Business", category: "Messaging", status: whatsapp.implemented && whatsapp.configured ? "ready" : whatsapp.configured ? "adapter_required" : "setup_required", detail: whatsapp.implemented ? "Provider adapter configured" : "Reminder workflow exists; provider adapter is not yet certified" },
    { id: "storage", name: storage.provider === "local" ? "Local export storage" : `${storage.provider.toUpperCase()} object storage`, category: "Storage", status: storage.provider === "local" ? "development_only" : storage.bucketConfigured ? "ready" : "setup_required", detail: storage.provider === "local" ? "Use S3, R2, or MinIO before production" : "Encrypted export object storage" },
    { id: "tally", name: "TallyPrime XML", category: "Accounting", status: tallyAllowed ? "ready" : "upgrade_required", detail: tallyAllowed ? "Tenant-scoped voucher export with date filters" : "Available on the Pro plan" },
    { id: "flipkart", name: "Flipkart Seller", category: "Marketplace", status: !flipkartBound ? "setup_required" : developerAllowed ? "ready" : "upgrade_required", detail: !flipkartBound ? "Bind Seller API credentials and warehouse mappings to this shop" : developerAllowed ? `${flipkartLocationCount} seller warehouse mapping${flipkartLocationCount === 1 ? "" : "s"}; official order pull, invoices, and labels` : "Order sync is available on the Pro plan; connection settings remain protected" },
    { id: "api", name: "KiranaOS API", category: "Developer", status: developerAllowed ? activeKeys > 0 ? "ready" : "available" : "upgrade_required", detail: developerAllowed ? `${activeKeys} active scoped key${activeKeys === 1 ? "" : "s"}` : "API credentials require the Pro plan" },
    { id: "webhooks", name: "Signed webhooks", category: "Developer", status: developerAllowed ? activeWebhooks > 0 ? "ready" : "available" : "upgrade_required", detail: developerAllowed ? `${activeWebhooks} active endpoint${activeWebhooks === 1 ? "" : "s"}; HMAC-SHA256 signatures and delivery logs` : "Signed webhooks require the Pro plan" },
  ];
  const ready = providers.filter((provider) => provider.status === "ready").length;
  return { maturityScore: Math.round((ready / providers.length) * 100), activeKeys, activeWebhooks, providers, recentDeliveries, supportedEvents: ["bill.created", "payment.recorded", "customer.updated", "customer_order.created", "customer_order.updated", "purchase_order.created", "purchase_order.received", "purchase_receipt.reconciled", "integration.test"] };
}

export async function listApiKeys(shopId) {
  const rows = await db.integrationApiKey.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, keyPrefix: true, scopesJson: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true } });
  return rows.map((row) => ({ ...row, scopes: jsonArray(row.scopesJson), scopesJson: undefined }));
}

export async function createApiKey({ shopId, userId, input, actor = {} }) {
  const raw = crypto.randomBytes(32).toString("base64url");
  const secret = `kos_${env.NODE_ENV === "production" ? "live" : "test"}_${raw}`;
  const row = await db.$transaction(async (tx) => {
    const activeCount = await tx.integrationApiKey.count({ where: { shopId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (activeCount >= MAX_ACTIVE_API_KEYS) throw new AppError(`A shop can have at most ${MAX_ACTIVE_API_KEYS} active API keys`, 409, "INTEGRATION_KEY_LIMIT_REACHED");
    const created = await tx.integrationApiKey.create({ data: { shopId, name: input.name, keyPrefix: secret.slice(0, 18), keyHash: hashApiKey(secret), scopesJson: JSON.stringify([...new Set(input.scopes)].sort()), createdByUserId: userId || null, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } });
    await writeRequiredIntegrationAudit({
      shopId,
      userId: actor.userId ?? userId ?? null,
      deviceId: actor.deviceId ?? undefined,
      action: "INTEGRATION_API_KEY_CREATED",
      entityType: "IntegrationApiKey",
      entityId: created.id,
      before: null,
      after: apiKeyAuditSnapshot(created),
      req: actor.req ?? null,
    }, tx);
    return created;
  }, { isolationLevel: "Serializable" });
  return { ...row, scopes: jsonArray(row.scopesJson), scopesJson: undefined, secret };
}

export async function revokeApiKey(shopId, id, actor = {}) {
  await db.$transaction(async (tx) => {
    const existing = await tx.integrationApiKey.findFirst({ where: { id, shopId, revokedAt: null } });
    if (!existing) throw new AppError("API key not found or already revoked", 404, "INTEGRATION_KEY_NOT_FOUND");
    const revokedAt = new Date();
    const result = await tx.integrationApiKey.updateMany({ where: { id, shopId, revokedAt: null }, data: { revokedAt } });
    if (!result.count) throw new AppError("API key changed while it was being revoked", 409, "CONCURRENT_INTEGRATION_KEY_UPDATE");
    await writeRequiredIntegrationAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? undefined,
      action: "INTEGRATION_API_KEY_REVOKED",
      entityType: "IntegrationApiKey",
      entityId: id,
      before: apiKeyAuditSnapshot(existing),
      after: apiKeyAuditSnapshot({ ...existing, revokedAt }),
      req: actor.req ?? null,
    }, tx);
  }, { isolationLevel: "Serializable" });
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

export async function createWebhookEndpoint({ shopId, userId, input, actor = {} }) {
  const url = assertWebhookUrlSyntax(input.url).toString();
  const row = await db.$transaction(async (tx) => {
    const endpointCount = await tx.webhookEndpoint.count({ where: { shopId, deletedAt: null } });
    const duplicate = await tx.webhookEndpoint.findFirst({ where: { shopId, deletedAt: null, url }, select: { id: true } });
    if (endpointCount >= MAX_WEBHOOK_ENDPOINTS) throw new AppError(`A shop can have at most ${MAX_WEBHOOK_ENDPOINTS} webhook endpoints`, 409, "WEBHOOK_LIMIT_REACHED");
    if (duplicate) throw new AppError("This webhook URL is already configured", 409, "WEBHOOK_URL_DUPLICATE");
    const created = await tx.webhookEndpoint.create({ data: { shopId, name: input.name, url, eventsJson: JSON.stringify([...new Set(input.events)].sort()), createdByUserId: userId || null } });
    await writeRequiredIntegrationAudit({
      shopId,
      userId: actor.userId ?? userId ?? null,
      deviceId: actor.deviceId ?? undefined,
      action: "WEBHOOK_ENDPOINT_CREATED",
      entityType: "WebhookEndpoint",
      entityId: created.id,
      before: null,
      after: webhookAuditSnapshot(created),
      req: actor.req ?? null,
    }, tx);
    return created;
  }, { isolationLevel: "Serializable" });
  return { ...row, events: jsonArray(row.eventsJson), eventsJson: undefined, secret: deriveWebhookSecret(row.id) };
}

export async function updateWebhookEndpoint(shopId, id, input, actor = {}) {
  const normalizedUrl = input.url ? assertWebhookUrlSyntax(input.url).toString() : undefined;
  const row = await db.$transaction(async (tx) => {
    const existing = await tx.webhookEndpoint.findFirst({ where: { id, shopId, deletedAt: null } });
    if (!existing) throw new AppError("Webhook endpoint not found", 404, "WEBHOOK_NOT_FOUND");
    if (normalizedUrl) {
      const duplicate = await tx.webhookEndpoint.findFirst({ where: { shopId, url: normalizedUrl, deletedAt: null, NOT: { id } }, select: { id: true } });
      if (duplicate) throw new AppError("This webhook URL is already configured", 409, "WEBHOOK_URL_DUPLICATE");
    }
    const data = { ...(input.name !== undefined ? { name: input.name } : {}), ...(normalizedUrl !== undefined ? { url: normalizedUrl } : {}), ...(input.events !== undefined ? { eventsJson: JSON.stringify([...new Set(input.events)].sort()) } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) };
    const claimed = await tx.webhookEndpoint.updateMany({ where: { id, shopId, deletedAt: null, updatedAt: existing.updatedAt }, data });
    if (claimed.count !== 1) throw new AppError("Webhook endpoint changed on another device. Refresh and try again.", 409, "CONCURRENT_WEBHOOK_UPDATE");
    const updated = await tx.webhookEndpoint.findUniqueOrThrow({ where: { id } });
    await writeRequiredIntegrationAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? undefined,
      action: "WEBHOOK_ENDPOINT_UPDATED",
      entityType: "WebhookEndpoint",
      entityId: id,
      before: webhookAuditSnapshot(existing),
      after: webhookAuditSnapshot(updated),
      req: actor.req ?? null,
    }, tx);
    return updated;
  }, { isolationLevel: "Serializable" });
  return { ...row, events: jsonArray(row.eventsJson), eventsJson: undefined };
}

export async function deleteWebhookEndpoint(shopId, id, actor = {}) {
  await db.$transaction(async (tx) => {
    const existing = await tx.webhookEndpoint.findFirst({ where: { id, shopId, deletedAt: null } });
    if (!existing) throw new AppError("Webhook endpoint not found", 404, "WEBHOOK_NOT_FOUND");
    const deletedAt = new Date();
    const result = await tx.webhookEndpoint.updateMany({ where: { id, shopId, deletedAt: null, updatedAt: existing.updatedAt }, data: { enabled: false, deletedAt } });
    if (!result.count) throw new AppError("Webhook endpoint changed on another device. Refresh and try again.", 409, "CONCURRENT_WEBHOOK_UPDATE");
    await writeRequiredIntegrationAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? undefined,
      action: "WEBHOOK_ENDPOINT_ARCHIVED",
      entityType: "WebhookEndpoint",
      entityId: id,
      before: webhookAuditSnapshot(existing),
      after: webhookAuditSnapshot({ ...existing, enabled: false, deletedAt }),
      req: actor.req ?? null,
    }, tx);
  }, { isolationLevel: "Serializable" });
}

export async function listWebhookDeliveries(shopId, { limit, cursor }) {
  const rows = await db.webhookDelivery.findMany({ where: { shopId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, endpointId: true, eventId: true, eventType: true, status: true, attemptCount: true, httpStatus: true, durationMs: true, responseSnippet: true, lastError: true, lastAttemptAt: true, deliveredAt: true, createdAt: true } });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, hasMore, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}

export async function testWebhookEndpoint(shopId, endpointId, actor = {}) {
  const delivery = await db.$transaction(async (tx) => {
    const endpoint = await tx.webhookEndpoint.findFirst({ where: { id: endpointId, shopId, deletedAt: null } });
    if (!endpoint) throw new AppError("Webhook endpoint not found", 404, "WEBHOOK_NOT_FOUND");
    if (!endpoint.enabled) throw new AppError("Webhook endpoint is disabled", 409, "WEBHOOK_DISABLED");
    const eventId = `evt_${crypto.randomUUID().replaceAll("-", "")}`;
    const payloadJson = JSON.stringify({ message: "KiranaOS webhook connection test", shopId, sentAt: new Date().toISOString() });
    const created = await tx.webhookDelivery.create({
      data: { shopId, endpointId, eventId, eventType: "integration.test", payloadJson },
    });
    await writeRequiredIntegrationAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? undefined,
      action: "WEBHOOK_ENDPOINT_TEST_REQUESTED",
      entityType: "WebhookEndpoint",
      entityId: endpointId,
      before: null,
      after: { deliveryId: created.id, status: created.status },
      req: actor.req ?? null,
    }, tx);
    return created;
  }, { isolationLevel: "Serializable" });
  // The durable request and audit are committed before the network call. A crash
  // here leaves a pending row that recoverWebhookDeliveries will pick up.
  return retryWebhookDelivery(shopId, delivery.id);
}

export async function retryWebhookDelivery(shopId, deliveryId) {
  const delivery = await db.webhookDelivery.findFirst({ where: { id: deliveryId, shopId }, include: { endpoint: true } });
  if (!delivery || delivery.endpoint.deletedAt) throw new AppError("Webhook delivery not found or endpoint has been archived", 404, "WEBHOOK_DELIVERY_NOT_FOUND");
  return deliverWebhook(delivery.endpoint, delivery.eventType, JSON.parse(delivery.payloadJson), delivery.eventId, delivery.createdAt);
}

export async function requestWebhookDeliveryRetry(shopId, deliveryId, actor = {}) {
  await db.$transaction(async (tx) => {
    const delivery = await tx.webhookDelivery.findFirst({ where: { id: deliveryId, shopId }, include: { endpoint: true } });
    if (!delivery || delivery.endpoint.deletedAt) throw new AppError("Webhook delivery not found or endpoint has been archived", 404, "WEBHOOK_DELIVERY_NOT_FOUND");
    if (!delivery.endpoint.enabled) throw new AppError("Webhook endpoint is disabled", 409, "WEBHOOK_DISABLED");
    await tx.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "pending", deliveredAt: null },
    });
    await writeRequiredIntegrationAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? undefined,
      action: "WEBHOOK_DELIVERY_RETRY_REQUESTED",
      entityType: "WebhookDelivery",
      entityId: delivery.id,
      before: { status: delivery.status, attemptCount: delivery.attemptCount, lastError: delivery.lastError },
      after: { status: "pending", attemptCount: delivery.attemptCount },
      metadata: { endpointId: delivery.endpointId, eventId: delivery.eventId, eventType: delivery.eventType },
      req: actor.req ?? null,
    }, tx);
  }, { isolationLevel: "Serializable" });
  // If the process exits after commit, the recovery scan sees status=pending.
  return retryWebhookDelivery(shopId, deliveryId);
}

async function scheduleWebhookDelivery(delivery) {
  try {
    const queued = await addJob(
      QUEUE_NAMES.webhooksQueue,
      JOB_NAMES.DELIVER_WEBHOOK,
      { shopId: delivery.shopId, deliveryId: delivery.id },
      { jobId: `webhook_${delivery.id}` },
    );
    if (queued.queued) {
      recordWebhookQueueDispatch("queued");
      return { deliveryId: delivery.id, queued: true };
    }
  } catch {
    // Redis is an accelerator here, not a reason to lose a persisted event.
  }
  scheduleLocalWebhookDelivery(delivery.shopId, delivery.id);
  recordWebhookQueueDispatch("local_fallback");
  return { deliveryId: delivery.id, queued: false };
}

function scheduleLocalWebhookDelivery(shopId, deliveryId, delayMs = 0) {
  const timer = setTimeout(async () => {
    try {
      const result = await retryWebhookDelivery(shopId, deliveryId);
      if (result.status === "failed" && result.attemptCount < 3) {
        scheduleLocalWebhookDelivery(shopId, deliveryId, result.attemptCount === 1 ? 30_000 : 120_000);
      }
    } catch { /* delivery evidence already contains actionable failure state */ }
  }, delayMs);
  timer.unref?.();
}

export async function recoverWebhookDeliveries({ limit = 5000 } = {}) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const maximum = Math.min(Math.max(Number(limit) || 5000, 1), 10_000);
  let cursor;
  let recovered = 0;
  while (recovered < maximum) {
    const deliveries = await db.webhookDelivery.findMany({
      where: {
        OR: [
          { status: "pending" },
          { status: "failed", attemptCount: { lt: 3 }, createdAt: { gte: since } },
        ],
        endpoint: { enabled: true, deletedAt: null },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.min(100, maximum - recovered),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!deliveries.length) break;
    await Promise.all(deliveries.map(scheduleWebhookDelivery));
    recovered += deliveries.length;
    cursor = deliveries.at(-1).id;
  }
  return { recovered, truncated: recovered === maximum };
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
    const response = await postWebhookRequest({ rawUrl: endpoint.url, signal: controller.signal, headers: { "content-type": "application/json", "user-agent": "KiranaOS-Webhooks/1.0", "x-kiranaos-event": eventType, "x-kiranaos-delivery": delivery.id, "x-kiranaos-timestamp": timestamp, "x-kiranaos-signature": `v1=${signature}` }, body });
    const responseSnippet = response.responseSnippet;
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

/**
 * Persist webhook-outbox rows on the caller's transaction client.
 *
 * Business mutations use this inside their own transaction so an order/payment
 * and the durable event describing it either both commit or neither does. Network
 * dispatch is deliberately separate and happens only after commit.
 */
export async function stageIntegrationEvent(shopId, eventType, payload, { client = db } = {}) {
  const endpoints = await client.webhookEndpoint.findMany({ where: { shopId, enabled: true, deletedAt: null } });
  const matching = endpoints.filter((endpoint) => jsonArray(endpoint.eventsJson).includes(eventType));
  if (!matching.length) return [];
  // Most shops have no endpoint, so only perform the subscription/entitlement
  // reads once there is real outbox work to stage. This keeps billing fast while
  // still disabling leftover endpoints immediately after a plan downgrade.
  if (!(await hasFeature(shopId, "api_webhook_later", client))) return [];
  const eventId = `evt_${crypto.randomUUID().replaceAll("-", "")}`;
  const eventCreatedAt = new Date();
  const payloadJson = JSON.stringify(payload, integrationJsonReplacer);
  const envelope = JSON.stringify({ id: eventId, type: eventType, createdAt: eventCreatedAt.toISOString(), data: JSON.parse(payloadJson) });
  if (Buffer.byteLength(envelope) > MAX_WEBHOOK_BODY_BYTES) throw new AppError("Webhook payload is too large", 413, "WEBHOOK_PAYLOAD_TOO_LARGE");

  const pending = [];
  for (const endpoint of matching) {
    pending.push(await client.webhookDelivery.create({
      data: { shopId, endpointId: endpoint.id, eventId, eventType, payloadJson },
    }));
  }
  return pending;
}

export async function dispatchIntegrationDeliveries(deliveries = []) {
  await Promise.all(deliveries.map(scheduleWebhookDelivery));
  return deliveries;
}

// Standalone publishers keep the same API. Transactional business services use
// stageIntegrationEvent(...) within their transaction, then dispatch this result
// after commit so external I/O never holds a database lock.
export async function publishIntegrationEvent(shopId, eventType, payload) {
  const pending = await stageIntegrationEvent(shopId, eventType, payload);
  return dispatchIntegrationDeliveries(pending);
}

export async function listApiResource({ shopId, resource, scope, query }) {
  if (!scope) throw new AppError("API key does not have the required scope", 403, "INTEGRATION_SCOPE_REQUIRED");
  const take = query.limit;
  const cursorFilter = query.cursor ? { id: { gt: query.cursor } } : {};
  let rows;
  if (resource === "catalog") rows = await db.product.findMany({ where: { shopId, deletedAt: null, ...cursorFilter }, orderBy: { id: "asc" }, take: take + 1, select: { id: true, name: true, category: true, sku: true, barcode: true, displayUnit: true, stockBaseQty: true, defaultPricePerRateUnit: true, gstRate: true, updatedAt: true } });
  else if (resource === "customers") rows = await db.customer.findMany({ where: { shopId, deletedAt: null, ...cursorFilter }, orderBy: { id: "asc" }, take: take + 1, select: { id: true, name: true, mobile: true, type: true, customerGroup: true, udharAmount: true, updatedAt: true } });
  // `deletedAt: null` to match the catalog and customer branches above: soft-delete leaves
  // `status` as "active", so without it a partner integration keeps pulling binned bills.
  else rows = await db.bill.findMany({ where: { shopId, deletedAt: null, ...cursorFilter }, orderBy: { id: "asc" }, take: take + 1, select: { id: true, billNo: true, billType: true, status: true, customerName: true, grandTotal: true, paidAmount: true, creditAmount: true, createdAt: true, updatedAt: true } });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, hasMore, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}

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

  // Loading every line of every bill is a different order of query, so the
  // inventory variant gets its own, much lower ceiling.
  const inventory = Boolean(query.inventory);
  const maxBills = inventory ? MAX_TALLY_INVENTORY_BILLS : MAX_TALLY_BILLS;
  const wants = (document) => query.include.includes(document);

  const [shop, bills, purchases, purchaseReturns, receipts, expenses, productionRuns] = await Promise.all([
    db.shop.findUnique({ where: { id: shopId }, select: { name: true, gstNumber: true } }),

    wants("sales")
      ? db.bill.findMany({
          // businessDate, not createdAt: a bill written offline on the 31st and
          // synced on the 2nd belongs to the month it was sold in, or the export
          // silently disagrees with the GST report it is supposed to match.
          // deletedAt is checked explicitly because soft-deleting a bill does not
          // change its status, so status:"active" alone still returns deleted ones.
          where: { shopId, status: "active", deletedAt: null, billType: { not: "estimate" }, businessDate: { gte: from, lte: to } },
          orderBy: { businessDate: "asc" },
          take: maxBills + 1,
          // Payments decide which ledger each bill is actually debited to, so
          // they are needed even when stock lines are not.
          include: { payments: true, ...(inventory && { items: true }) },
        })
      : [],

    wants("purchases")
      ? db.purchaseReceipt.findMany({
          where: { shopId, createdAt: { gte: from, lte: to } },
          orderBy: { createdAt: "asc" },
          take: MAX_TALLY_BILLS + 1,
          // gstin decides whether input tax posts as central+state or integrated.
          include: { supplier: { select: { name: true, gstin: true } } },
        })
      : [],

    wants("returns")
      ? db.purchaseReturn.findMany({
          where: { shopId, status: "active", createdAt: { gte: from, lte: to } },
          orderBy: { createdAt: "asc" },
          take: MAX_TALLY_BILLS + 1,
          // gstin decides whether input tax posts as central+state or integrated.
          include: { supplier: { select: { name: true, gstin: true } } },
        })
      : [],

    wants("receipts")
      ? db.udharLedger.findMany({
          // The same filter the udhar reports use: a reversed collection never
          // happened, and a "reversal" row is the undo, not a second payment.
          where: { shopId, type: "payment", mode: { not: "reversal" }, reversedAt: null, businessDate: { gte: from, lte: to } },
          orderBy: { businessDate: "asc" },
          take: MAX_TALLY_BILLS + 1,
        })
      : [],

    wants("expenses")
      ? db.expense.findMany({
          // A Payment voucher asserts money left the shop, so a pending expense
          // is an accrual this export has no business posting.
          where: { shopId, deletedAt: null, status: "paid", spentAt: { gte: from, lte: to } },
          orderBy: { spentAt: "asc" },
          take: MAX_TALLY_BILLS + 1,
        })
      : [],

    wants("production")
      ? db.productionRun.findMany({
          where: { shopId, status: "completed", completedAt: { gte: from, lte: to } },
          orderBy: { completedAt: "asc" }, take: MAX_TALLY_BILLS + 1,
          include: { consumptions: true, outputs: true },
        })
      : [],
  ]);

  if (bills.length > maxBills) throw new AppError(`Export exceeds ${maxBills} bills. Choose a smaller date range.`, 422, "TALLY_EXPORT_TOO_LARGE");
  const documentCount = bills.length + purchases.length + purchaseReturns.length + receipts.length + expenses.length + productionRuns.length;
  if (documentCount > MAX_TALLY_VOUCHERS) throw new AppError(`Export exceeds ${MAX_TALLY_VOUCHERS} vouchers. Choose a smaller date range.`, 422, "TALLY_EXPORT_TOO_LARGE");

  const selected = query.unsent
    ? await withoutAlreadyPosted(shopId, { bills, purchases, purchaseReturns, receipts, expenses, productionRuns })
    : { bills, purchases, purchaseReturns, receipts, expenses, productionRuns };

  if (selected.productionRuns.length) {
    const ids = [...new Set(selected.productionRuns.flatMap((run) => [...run.consumptions, ...run.outputs].map((row) => row.productId)))];
    const products = await db.product.findMany({ where: { shopId, id: { in: ids } }, select: { id: true, name: true, baseUnit: true, rateUnit: true, hsn: true, costPerRateUnit: true } });
    const byId = new Map(products.map((row) => [row.id, row]));
    selected.productionRuns = selected.productionRuns.map((run) => {
      const consumptions = run.consumptions.map((row) => {
        const product = byId.get(row.productId);
        let rateQty = Number(row.actualBaseQty);
        try { rateQty = baseQtyToRateQty(rateQty, product?.rateUnit, product?.baseUnit); } catch { /* use base quantity */ }
        return { ...row, productName: product?.name, baseUnit: product?.baseUnit, hsn: product?.hsn, stockValue: rateQty * Number(product?.costPerRateUnit || 0) };
      });
      const totalInputValue = consumptions.reduce((sum, row) => sum + Number(row.stockValue || 0), 0);
      const totalOutputQty = run.outputs.reduce((sum, row) => sum + Number(row.quantityBaseQty || 0), 0);
      const outputs = run.outputs.map((row) => {
        const product = byId.get(row.productId);
        return { ...row, productName: product?.name, baseUnit: product?.baseUnit, hsn: product?.hsn, stockValue: totalOutputQty > 0 ? totalInputValue * Number(row.quantityBaseQty) / totalOutputQty : 0 };
      });
      return { ...run, consumptions, outputs };
    });
  }

  const { xml, count, masterCount, counts, documents } = buildTallyEnvelope({
    companyName: shop?.name || "KiranaOS",
    shopId,
    sellerStateCode: validateGstin(shop?.gstNumber).stateCode || "",
    ...selected,
    timeZone,
    inventory,
  });
  return { filename: `kiranaos-tally-${fromKey}-${toKey}.xml`, xml, count, masterCount, counts, documents, skipped: documentCount - count };
}

function saleDocumentType(bill) {
  return bill.billType === "sales_return" ? "sales_return" : "sale";
}

/**
 * Drop anything already pushed into Tally.
 *
 * Without this, a shopkeeper who clicks "Send to Tally" twice — after a timeout,
 * or simply unsure whether the first click worked — books the month twice.
 * Tally's importer will not stop them, so this is where it has to stop.
 */
async function withoutAlreadyPosted(shopId, { bills, purchases, purchaseReturns, receipts, expenses, productionRuns = [] }) {
  const groups = [
    ["sale", bills.filter((bill) => saleDocumentType(bill) === "sale").map((bill) => bill.id)],
    ["sales_return", bills.filter((bill) => saleDocumentType(bill) === "sales_return").map((bill) => bill.id)],
    ["purchase", purchases.map((row) => row.id)],
    ["purchase_return", purchaseReturns.map((row) => row.id)],
    ["receipt", receipts.map((row) => row.id)],
    ["expense", expenses.map((row) => row.id)],
    ["production", productionRuns.map((row) => row.id)],
  ].filter(([, ids]) => ids.length > 0);

  if (groups.length === 0) return { bills, purchases, purchaseReturns, receipts, expenses, productionRuns };

  const posted = await db.tallyPost.findMany({
    where: { shopId, OR: groups.map(([documentType, ids]) => ({ documentType, documentId: { in: ids } })) },
    select: { documentType: true, documentId: true },
  });
  const sent = new Set(posted.map((row) => `${row.documentType}:${row.documentId}`));
  const keep = (type) => (row) => !sent.has(`${type}:${row.id}`);

  return {
    bills: bills.filter((bill) => !sent.has(`${saleDocumentType(bill)}:${bill.id}`)),
    purchases: purchases.filter(keep("purchase")),
    purchaseReturns: purchaseReturns.filter(keep("purchase_return")),
    receipts: receipts.filter(keep("receipt")),
    expenses: expenses.filter(keep("expense")),
    productionRuns: productionRuns.filter(keep("production")),
  };
}

/**
 * Record what TallyPrime accepted.
 *
 * Called only after the bridge reports a successful import, which leaves a real
 * at-least-once window: if the shop loses power between Tally accepting and this
 * landing, those documents look unsent and would be pushed again. That is why
 * every voucher also carries a derived REMOTEID — Tally recognises the repeat as
 * the same object instead of a second one.
 */
export async function markTallyPosted(shopId, documents, actor = {}) {
  const rows = documents.map((document) => ({
    shopId,
    documentType: document.type,
    documentId: document.id,
    voucherNumber: document.voucherNumber,
    remoteId: document.remoteId,
  }));
  if (rows.length === 0) return { recorded: 0 };

  const recordAudit = async (tx, recorded) => {
    await writeRequiredIntegrationAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? undefined,
      action: "TALLY_VOUCHERS_POSTED",
      entityType: "Shop",
      entityId: shopId,
      before: null,
      after: { recorded },
      metadata: {
        documentTypes: [...new Set(rows.map((row) => row.documentType))],
        firstRemoteId: rows[0]?.remoteId ?? null,
        lastRemoteId: rows.at(-1)?.remoteId ?? null,
      },
      req: actor.req ?? null,
    }, tx);
  };

  try {
    return await db.$transaction(async (tx) => {
      let recorded = 0;
      for (let index = 0; index < rows.length; index += 500) {
        const result = await tx.tallyPost.createMany({ data: rows.slice(index, index + 500) });
        recorded += result.count;
      }
      await recordAudit(tx, recorded);
      return { recorded };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    // Two tills confirming the same batch can collide. SQLite has no
    // skipDuplicates for createMany, so retry the whole confirmation as
    // idempotent upserts in one fresh transaction. Audit remains atomic with it.
    return db.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.tallyPost.upsert({
          where: { shopId_documentType_documentId: { shopId, documentType: row.documentType, documentId: row.documentId } },
          update: {},
          create: row,
        });
      }
      await recordAudit(tx, rows.length);
      return { recorded: rows.length };
    }, { isolationLevel: "Serializable" });
  }
}

export function parseTallyImportResponse(xml, expectedCount, status = 200) {
  const metric = (name) => Number(String(xml).match(new RegExp(`<${name}>(\\d+)</${name}>`, "i"))?.[1] || 0);
  const created = metric("CREATED"); const altered = metric("ALTERED"); const ignored = metric("IGNORED"); const errors = metric("ERRORS");
  const lineError = String(xml).match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i)?.[1]?.replace(/<[^>]+>/g, " ").trim();
  if (status < 200 || status >= 300 || errors > 0 || lineError) throw new AppError(lineError || `TallyPrime rejected the envelope (${status})`, 502, "TALLY_IMPORT_REJECTED");
  if (created + altered < expectedCount) throw new AppError(`TallyPrime acknowledged ${created + altered} of ${expectedCount} vouchers`, 502, "TALLY_IMPORT_INCOMPLETE");
  return { created, altered, ignored };
}

export async function pushTallyExport(shopId, query, actor = {}) {
  const envelope = await buildTallyExport(shopId, { ...query, unsent: true });
  if (envelope.documents.length === 0) return { posted: 0, created: 0, altered: 0, ignored: 0, message: "No unsent vouchers" };
  let response;
  try {
    response = await fetch(env.TALLY_BASE_URL, { method: "POST", headers: { "content-type": "application/xml; charset=utf-8" }, body: envelope.xml, signal: AbortSignal.timeout(env.TALLY_PUSH_TIMEOUT_MS) });
  } catch (error) {
    throw new AppError(`Could not reach TallyPrime at the configured address: ${error.message}`, 502, "TALLY_UNREACHABLE");
  }
  const xml = await response.text();
  const { created, altered, ignored } = parseTallyImportResponse(xml, envelope.count, response.status);
  const result = await markTallyPosted(shopId, envelope.documents, actor);
  return { posted: result.recorded, created, altered, ignored, counts: envelope.counts };
}
