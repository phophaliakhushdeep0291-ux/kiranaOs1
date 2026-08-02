import crypto from "node:crypto";
import db from "../../db.js";
import { sanitizeText, sanitizeTelemetry } from "../../lib/errorTracking.js";
import { EVENT_TOPICS, publishEvent } from "../../lib/eventBus.js";
import { putObject } from "../../lib/objectStorage.js";

const MAX_MESSAGE = 4000;
const MAX_STACK = 20000;
const MAX_TITLE = 200;
const MAX_CONTEXT_BYTES = 64 * 1024;
const SCREENSHOT_MAX_BYTES = 3 * 1024 * 1024;
const SCREENSHOT_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

const GROUP_STATUSES = new Set(["open", "resolved", "ignored"]);
const SUPPORT_STATUSES = new Set(["open", "triaged", "resolved"]);
const SOURCES = new Set(["frontend", "backend", "worker"]);

function clampStr(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * normalizeForFingerprint — collapse volatile tokens (ids, numbers, uuids, hex,
 * quoted values) so "Product 982 no longer exists" and "Product 17 no longer
 * exists" are recognized as the same recurring issue instead of thousands of
 * distinct ones.
 */
export function normalizeForFingerprint(message = "") {
  return String(message)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\bc[a-z0-9]{20,}\b/gi, "<id>")
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/\d[\d.,:_-]*\d|\d/g, "<n>")
    .replace(/["'`][^"'`]{0,120}["'`]/g, "<str>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE);
}

function topStackFrame(stack, fileName, lineNumber) {
  if (fileName) return `${String(fileName).replace(/^.*[\\/]/, "")}:${lineNumber ?? 0}`;
  if (typeof stack !== "string") return "";
  const frame = stack.split("\n").map((l) => l.trim()).find((l) => l.startsWith("at "));
  if (!frame) return "";
  // Keep the callee + file, drop the volatile line:col and absolute path prefix.
  return frame.replace(/:\d+\)?$/, "").replace(/\(.*[\\/]/, "(").slice(0, 200);
}

export function computeFingerprint({ source, shopId, message, errorCode, stack, fileName, lineNumber }) {
  const basis = [
    source,
    shopId ?? "global",
    normalizeForFingerprint(message),
    errorCode ?? "",
    topStackFrame(stack, fileName, lineNumber),
  ].join("|");
  return crypto.createHash("sha1").update(basis).digest("hex");
}

/**
 * recordErrorEvent — persist one occurrence into our own store, grouped by a
 * content fingerprint. MUST NOT throw into the caller: diagnostics can never be
 * the reason a user action fails (mirrors createAuditLog's swallow contract).
 * Returns { groupId, fingerprint, count } or null if it was dropped.
 */
export async function recordErrorEvent(input = {}, { client = db } = {}) {
  try {
    const source = SOURCES.has(input.source) ? input.source : "frontend";
    const shopId = input.shopId ?? null;
    const message = clampStr(sanitizeText(input.message) || "Unknown error", MAX_MESSAGE);
    const stack = clampStr(sanitizeText(input.stack), MAX_STACK);
    const errorCode = clampStr(input.errorCode, 120);
    const lineNumber = Number.isInteger(input.lineNumber) ? input.lineNumber : null;
    const fingerprint = computeFingerprint({
      source, shopId, message, errorCode, stack, fileName: input.fileName, lineNumber,
    });
    const title = clampStr((message || "").split("\n")[0], MAX_TITLE);
    const now = new Date();

    const group = await client.errorGroup.upsert({
      where: { fingerprint },
      create: {
        shopId, fingerprint, source, title, errorCode,
        sampleMessage: message, sampleStack: stack,
        count: 1, status: "open", firstSeenAt: now, lastSeenAt: now,
      },
      update: {
        count: { increment: 1 }, lastSeenAt: now,
        sampleMessage: message, sampleStack: stack,
      },
      select: { id: true, fingerprint: true, count: true },
    });

    await client.errorEvent.create({
      data: {
        groupId: group.id,
        shopId,
        userId: clampStr(input.userId, 200),
        deviceId: clampStr(input.deviceId, 200),
        orgId: clampStr(input.orgId, 200),
        source,
        message,
        stack,
        errorCode,
        endpoint: clampStr(input.endpoint, 300),
        functionName: clampStr(input.functionName, 200),
        fileName: clampStr(input.fileName, 400),
        lineNumber,
        appVersion: clampStr(input.appVersion, 60),
        backendVersion: clampStr(input.backendVersion, 60),
        os: clampStr(input.os, 120),
        browser: clampStr(input.browser, 300),
        networkStatus: clampStr(input.networkStatus, 20),
        onlineMode: typeof input.onlineMode === "boolean" ? input.onlineMode : null,
        memoryUsageMb: Number.isFinite(input.memoryUsageMb) ? input.memoryUsageMb : null,
        route: clampStr(input.route, 300),
      },
    });

    // §11: mirror the error onto the platform event bus for fleet-wide
    // streaming. No-op unless an operator enables a provider, and never awaited
    // for correctness — the DB row above is the source of truth.
    publishEvent(
      EVENT_TOPICS.ERROR_RECORDED,
      shopId,
      {
        fingerprint: group.fingerprint,
        title: clampStr(message, 200),
        source,
        errorCode,
        occurrences: group.count,
      },
      { deviceId: input.deviceId ?? null },
    ).catch(() => {});

    return { groupId: group.id, fingerprint: group.fingerprint, count: group.count };
  } catch (error) {
    // Diagnostics must never break the caller. Surface to operator logs only.
    console.error("recordErrorEvent failed", error?.message || error);
    return null;
  }
}

function serializeContext(context) {
  try {
    // sanitizeTelemetry redacts private keys (userId/shopId/phone/email/tokens…),
    // strips query strings from url-ish values, and caps depth.
    const safe = sanitizeTelemetry(context ?? {});
    let json = JSON.stringify(safe ?? {});
    if (json.length > MAX_CONTEXT_BYTES) {
      json = JSON.stringify({ truncated: true, reason: "context exceeded size cap", originalBytes: json.length });
    }
    return json;
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

/**
 * createSupportRequest — persist a user-reported issue plus its auto-collected,
 * sanitized context bundle. Unlike recordErrorEvent this DOES surface failures,
 * so the UI can tell the user their report was not saved.
 */
export async function createSupportRequest(input = {}, { client = db } = {}) {
  return client.supportRequest.create({
    data: {
      shopId: input.shopId,
      userId: clampStr(input.userId, 200),
      deviceId: clampStr(input.deviceId, 200),
      description: clampStr(input.description, 2000) || "(no description)",
      page: clampStr(input.page, 300),
      appVersion: clampStr(input.appVersion, 60),
      contextJson: serializeContext(input.context),
      screenshotKey: clampStr(input.screenshotKey, 500),
      status: "open",
    },
  });
}

export async function listErrorGroups({ shopId, status, limit = 50 } = {}, { client = db } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const st = GROUP_STATUSES.has(status) ? status : undefined;
  return client.errorGroup.findMany({
    where: { shopId, ...(st ? { status: st } : {}) },
    orderBy: { lastSeenAt: "desc" },
    take,
    select: {
      id: true, fingerprint: true, source: true, title: true, errorCode: true,
      sampleMessage: true, count: true, status: true, firstSeenAt: true, lastSeenAt: true,
    },
  });
}

export async function getErrorGroupDetail({ shopId, id, eventLimit = 20 } = {}, { client = db } = {}) {
  const group = await client.errorGroup.findFirst({ where: { id, shopId } });
  if (!group) return null;
  const take = Math.min(Math.max(Number(eventLimit) || 20, 1), 100);
  const events = await client.errorEvent.findMany({
    where: { groupId: id, shopId },
    orderBy: { createdAt: "desc" },
    take,
  });
  return { group, events };
}

export async function listSupportRequests({ shopId, status, limit = 50 } = {}, { client = db } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const st = SUPPORT_STATUSES.has(status) ? status : undefined;
  return client.supportRequest.findMany({
    where: { shopId, ...(st ? { status: st } : {}) },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * maybeUploadScreenshot — best-effort store of an optional data-URL screenshot.
 * Returns a storage key, or null when there's no image, it's malformed/too big,
 * or object storage isn't configured. Never throws.
 */
export async function maybeUploadScreenshot(dataUrl, { shopId } = {}) {
  try {
    if (!dataUrl || typeof dataUrl !== "string") return null;
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
    if (!match) return null;
    const contentType = match[1];
    const body = Buffer.from(match[2], "base64");
    if (!body.length || body.length > SCREENSHOT_MAX_BYTES) return null;
    const ext = SCREENSHOT_EXT[contentType] ?? "png";
    const key = `support-screenshots/${shopId ?? "global"}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
    await putObject({ key, body, contentType, metadata: { kind: "support-screenshot" } });
    return key;
  } catch (error) {
    console.error("maybeUploadScreenshot failed", error?.message || error);
    return null;
  }
}
