import { ZodError } from "zod";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { captureRequestError } from "../lib/errorTracking.js";
import { recordErrorEvent } from "../modules/diagnostics/diagnostics.service.js";

const BACKEND_VERSION = process.env.APP_VERSION || "1.0.0";

function baseError(req, message) {
  return {
    success: false,
    error: message,
    requestId: req?.requestId,
  };
}

// Every error response carries a stable, machine-readable `code` so the frontend can
// branch reliably instead of string-matching messages. Specific codes are set at the
// throw site (AppError) or by the handlers below; this fills a sensible default by status.
function defaultCodeForStatus(statusCode) {
  switch (statusCode) {
    case 400: return "BAD_REQUEST";
    case 401: return "UNAUTHORIZED";
    case 403: return "FORBIDDEN";
    case 404: return "NOT_FOUND";
    case 409: return "CONFLICT";
    case 413: return "PAYLOAD_TOO_LARGE";
    case 422: return "UNPROCESSABLE_ENTITY";
    case 429: return "RATE_LIMITED";
    case 503: return "SERVICE_UNAVAILABLE";
    default: return statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED";
  }
}

function logUnhandledError(err, req) {
  captureRequestError(err, req);
  persistBackendError(err, req);
  logger.error({
    type: "unhandled_error",
    requestId: req?.requestId,
    method: req?.method,
    path: req?.originalUrl,
    userId: req?.user?.userId ?? req?.user?.id ?? null,
    shopId: req?.user?.shopId ?? null,
    deviceId: req?.headers?.["x-device-id"] ?? null,
    errorName: err?.name,
    errorMessage: err?.message,
    stack: env.NODE_ENV === "development" ? err?.stack : undefined,
  });
}

// Persist important (5xx / unknown) errors into our own store in addition to
// Sentry, so support can query and group them without a third-party dependency.
// Fire-and-forget and fully guarded: diagnostics must never turn an error
// response into a crash (recordErrorEvent also swallows its own failures).
function persistBackendError(err, req) {
  try {
    void recordErrorEvent({
      source: "backend",
      shopId: req?.user?.shopId ?? null,
      userId: req?.user?.userId ?? req?.user?.id ?? null,
      deviceId: req?.user?.deviceId ?? normalizeHeader(req?.headers?.["x-device-id"]),
      message: err?.message,
      stack: err?.stack,
      errorCode: err?.code,
      endpoint: buildEndpoint(req),
      backendVersion: BACKEND_VERSION,
      route: requestPathNoQuery(req),
      ...parseErrorLocation(err?.stack),
    });
  } catch {
    // Guard the synchronous throw paths; the async write is already swallowed.
  }
}

function normalizeHeader(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function requestPathNoQuery(req) {
  const url = req?.originalUrl || req?.url;
  if (typeof url !== "string") return undefined;
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

// Prefer the matched route pattern (e.g. "GET /api/bills/:id") over the concrete
// URL so the same endpoint groups together regardless of path params.
function buildEndpoint(req) {
  if (!req) return undefined;
  const routePattern = req.route?.path ? `${req.baseUrl || ""}${req.route.path}` : null;
  const path = routePattern || requestPathNoQuery(req) || req.path;
  return path ? `${req.method || "GET"} ${path}`.slice(0, 300) : undefined;
}

// Pull the first application stack frame (fn + file:line), skipping node internals.
function parseErrorLocation(stack) {
  if (typeof stack !== "string") return {};
  const frames = stack.split("\n").slice(1);
  const appFrame = frames.find((l) => /[\\/]src[\\/]/.test(l) && l.includes(" at "));
  const frame = appFrame || frames.find((l) => l.trim().startsWith("at "));
  if (!frame) return {};
  const match = /at\s+(?:(.*?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/.exec(frame.trim());
  if (!match) return {};
  const [, fn, file, line] = match;
  return {
    functionName: fn ? fn.slice(0, 200) : undefined,
    fileName: file ? file.replace(/^.*[\\/]/, "").slice(0, 400) : undefined,
    lineNumber: line ? Number(line) : undefined,
  };
}

/**
 * Global Express error handler.
 * Catches Zod validation errors, Prisma errors, and generic errors.
 */
export function errorHandler(err, req, res, _next) {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      ...baseError(req, "Invalid JSON body"),
      code: "INVALID_JSON",
    });
  }

  if (err.type === "entity.too.large") {
    return res.status(413).json({
      ...baseError(req, "Request body too large"),
      code: "REQUEST_BODY_TOO_LARGE",
    });
  }

  // Zod validation failure
  if (err instanceof ZodError) {
    return res.status(400).json({
      ...baseError(req, "Validation failed"),
      code: "VALIDATION_FAILED",
      details: err.flatten().fieldErrors,
    });
  }

  // Prisma unique constraint violation
  if (err.code === "P2002") {
    const field = err.meta?.target?.join(", ") ?? "field";
    return res.status(409).json({
      ...baseError(req, `A record with this ${field} already exists`),
      code: "DUPLICATE_RECORD",
    });
  }

  // Prisma record not found
  if (err.code === "P2025") {
    return res.status(404).json({
      ...baseError(req, "Record not found"),
      code: "RECORD_NOT_FOUND",
    });
  }

  const statusCode = Number(err.statusCode || err.status || 0);
  if (statusCode >= 400 && statusCode < 600) {
    if (statusCode >= 500) logUnhandledError(err, req);
    const message = statusCode >= 500 && env.NODE_ENV !== "development"
      ? "Internal server error"
      : err.message || "Request failed";
    return res.status(statusCode).json({
      ...baseError(req, message),
      code: err.code ?? defaultCodeForStatus(statusCode),
      ...(err.publicData && typeof err.publicData === "object" ? err.publicData : {}),
      ...(err.meta && env.NODE_ENV === "development" ? { meta: err.meta } : {}),
    });
  }

  // Unknown error
  logUnhandledError(err, req);
  return res.status(500).json({
    ...baseError(req, "Internal server error"),
    code: "INTERNAL_ERROR",
    ...(env.NODE_ENV === "development" && { detail: err.message }),
  });
}

/** Throw this to return a clean HTTP error from anywhere. */
export class AppError extends Error {
  constructor(message, statusCode = 400, code = undefined) {
    super(message);
    this.statusCode = statusCode;
    // Optional stable code; callers may also set `err.code` after construction.
    if (code) this.code = code;
  }
}
