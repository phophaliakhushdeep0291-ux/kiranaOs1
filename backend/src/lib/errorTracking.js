import { env } from "../config/env.js";
import { logger, redactSensitive } from "./logger.js";

let initialized = false;

function sanitizeContext(context = {}) {
  return redactSensitive(context);
}

export function isErrorTrackingEnabled() {
  return Boolean(env.ERROR_TRACKING_ENABLED && env.SENTRY_DSN);
}

export function initErrorTracking() {
  if (!env.ERROR_TRACKING_ENABLED) {
    logger.info({ type: "error_tracking_disabled", provider: "sentry", enabled: false });
    return { enabled: false, provider: "sentry" };
  }
  if (!env.SENTRY_DSN) {
    const error = new Error("SENTRY_DSN is required when ERROR_TRACKING_ENABLED=true");
    error.code = "ERROR_TRACKING_CONFIG_MISSING";
    throw error;
  }
  initialized = true;
  // Adapter stub: intentionally no Sentry SDK dependency yet. Production teams can
  // wire @sentry/node here without changing call sites.
  logger.info({
    type: "error_tracking_ready",
    provider: "sentry",
    enabled: true,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
    releaseConfigured: Boolean(env.SENTRY_RELEASE),
  });
  return { enabled: true, provider: "sentry", sdkLoaded: false, mode: "adapter_stub" };
}

export function captureException(error, context = {}) {
  const safe = sanitizeContext(context);
  if (!env.ERROR_TRACKING_ENABLED) return { captured: false, disabled: true };
  logger.error({
    type: "error_tracking_capture",
    provider: "sentry",
    sdkLoaded: false,
    errorName: error?.name,
    errorCode: error?.code,
    message: error?.message,
    context: safe,
  });
  return { captured: true, provider: "sentry", sdkLoaded: false };
}

export function captureRequestError(error, req) {
  return captureException(error, {
    type: "request_error",
    requestId: req?.requestId,
    method: req?.method,
    path: req?.originalUrl,
    userId: req?.user?.userId ?? req?.user?.id ?? null,
    shopId: req?.user?.shopId ?? null,
    deviceId: req?.headers?.["x-device-id"] ?? null,
  });
}

export function captureWorkerError(error, metadata = {}) {
  return captureException(error, { type: "worker_error", ...metadata });
}

export function getErrorTrackingStatus() {
  return {
    provider: "sentry",
    enabled: env.ERROR_TRACKING_ENABLED,
    configured: Boolean(env.SENTRY_DSN),
    initialized,
    sdkLoaded: false,
    mode: env.ERROR_TRACKING_ENABLED ? "adapter_stub" : "disabled",
  };
}
