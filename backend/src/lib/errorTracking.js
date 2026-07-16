import * as Sentry from "@sentry/node";
import { env } from "../config/env.js";
import { logger, redactSensitive } from "./logger.js";

let initialized = false;

const PRIVATE_CONTEXT_KEY = /^(?:user|userId|shopId|customerId|deviceId|billId|phone|mobile|email|address|password|pin|token|jwt|secret|signature|authorization|apiKey|accessKey|refreshToken|cookie)$/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g;

function stripQuery(value) {
  if (typeof value !== "string") return value;
  const queryIndex = value.indexOf("?");
  return queryIndex >= 0 ? value.slice(0, queryIndex) : value;
}

function sanitizeText(value) {
  if (typeof value !== "string") return value;
  return redactSensitive(value)
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(PHONE_PATTERN, "[REDACTED_PHONE]");
}

function sanitizeTelemetry(value, depth = 0, key = "") {
  if (value === null || value === undefined) return value;
  if (PRIVATE_CONTEXT_KEY.test(key)) return "[REDACTED]";
  if (depth > 8) return "[REDACTED_DEPTH]";
  if (typeof value === "string") {
    const safe = sanitizeText(value);
    return /(?:url|uri|path)$/i.test(key) ? stripQuery(safe) : safe;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeTelemetry(item, depth + 1));

  const safe = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    safe[childKey] = sanitizeTelemetry(childValue, depth + 1, childKey);
  }
  return redactSensitive(safe);
}

function requestPath(value) {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return new URL(value, "http://kiranaos.invalid").pathname;
  } catch {
    return stripQuery(value);
  }
}

function sanitizeSentryEvent(event) {
  if (!event || typeof event !== "object") return event;
  const safe = { ...event };

  // KiranaOS deliberately avoids attaching identities or request payloads to
  // third-party telemetry. A request id is sufficient for correlation with the
  // application's redacted structured logs.
  delete safe.user;
  if (safe.request) {
    safe.request = {
      method: safe.request.method,
      url: requestPath(safe.request.url),
    };
  }
  if (safe.message) safe.message = sanitizeText(safe.message);
  if (safe.transaction) safe.transaction = requestPath(safe.transaction);
  if (safe.extra) safe.extra = sanitizeTelemetry(safe.extra);
  if (safe.contexts) safe.contexts = sanitizeTelemetry(safe.contexts);
  if (safe.tags) safe.tags = sanitizeTelemetry(safe.tags);
  if (safe.fingerprint) safe.fingerprint = sanitizeTelemetry(safe.fingerprint);
  if (Array.isArray(safe.breadcrumbs)) {
    safe.breadcrumbs = safe.breadcrumbs.map((breadcrumb) => ({
      ...breadcrumb,
      message: sanitizeText(breadcrumb?.message),
      data: sanitizeTelemetry(breadcrumb?.data),
    }));
  }
  if (Array.isArray(safe.exception?.values)) {
    safe.exception = {
      ...safe.exception,
      values: safe.exception.values.map((exception) => ({
        ...exception,
        value: sanitizeText(exception?.value),
        mechanism: sanitizeTelemetry(exception?.mechanism),
        stacktrace: exception?.stacktrace
          ? {
              ...exception.stacktrace,
              frames: exception.stacktrace.frames?.map((frame) => {
                const frameCopy = { ...frame };
                delete frameCopy.vars;
                if (frameCopy.filename) frameCopy.filename = stripQuery(frameCopy.filename);
                return frameCopy;
              }),
            }
          : exception?.stacktrace,
      })),
    };
  }
  return safe;
}

export function isErrorTrackingEnabled() {
  return Boolean(env.ERROR_TRACKING_ENABLED && env.SENTRY_DSN);
}

export function initErrorTracking() {
  if (initialized) return { enabled: true, provider: "sentry", sdkLoaded: true, mode: "sdk" };
  if (!env.ERROR_TRACKING_ENABLED) {
    logger.info({ type: "error_tracking_disabled", provider: "sentry", enabled: false });
    return { enabled: false, provider: "sentry", sdkLoaded: true, mode: "disabled" };
  }
  if (!env.SENTRY_DSN) {
    const error = new Error("SENTRY_DSN is required when ERROR_TRACKING_ENABLED=true");
    error.code = "ERROR_TRACKING_CONFIG_MISSING";
    throw error;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
    release: env.SENTRY_RELEASE || undefined,
    enabled: true,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 50,
    normalizeDepth: 5,
    attachStacktrace: true,
    beforeSend: sanitizeSentryEvent,
  });
  initialized = true;
  logger.info({
    type: "error_tracking_ready",
    provider: "sentry",
    enabled: true,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
    releaseConfigured: Boolean(env.SENTRY_RELEASE),
    sdkLoaded: true,
  });
  return { enabled: true, provider: "sentry", sdkLoaded: true, mode: "sdk" };
}

export function captureException(error, context = {}) {
  if (!env.ERROR_TRACKING_ENABLED) return { captured: false, disabled: true };

  try {
    if (!initialized) initErrorTracking();
    const safe = sanitizeTelemetry(context);
    const eventId = Sentry.captureException(error, { extra: safe });
    logger.error({
      type: "error_tracking_capture",
      provider: "sentry",
      sdkLoaded: true,
      eventId,
      errorName: error?.name,
      errorCode: error?.code,
      message: sanitizeText(error?.message),
      context: safe,
    });
    return { captured: true, provider: "sentry", sdkLoaded: true, eventId };
  } catch (trackingError) {
    logger.error({
      type: "error_tracking_failure",
      provider: "sentry",
      errorName: trackingError?.name,
      errorCode: trackingError?.code,
      message: sanitizeText(trackingError?.message),
    });
    return { captured: false, provider: "sentry", sdkLoaded: true, failed: true };
  }
}

export function captureRequestError(error, req) {
  return captureException(error, {
    type: "request_error",
    requestId: req?.requestId,
    method: req?.method,
    path: requestPath(req?.route?.path ?? req?.originalUrl ?? req?.url),
  });
}

export function captureWorkerError(error, metadata = {}) {
  return captureException(error, { type: "worker_error", ...sanitizeTelemetry(metadata) });
}

export async function closeErrorTracking(timeoutMs = 2_000) {
  if (!initialized) return true;
  const closed = await Sentry.close(timeoutMs);
  initialized = false;
  return closed;
}

export function getErrorTrackingStatus() {
  return {
    provider: "sentry",
    enabled: env.ERROR_TRACKING_ENABLED,
    configured: Boolean(env.SENTRY_DSN),
    initialized,
    sdkLoaded: true,
    mode: env.ERROR_TRACKING_ENABLED ? "sdk" : "disabled",
  };
}

export const __errorTrackingInternals = {
  sanitizeSentryEvent,
  sanitizeTelemetry,
  sanitizeText,
  requestPath,
};
