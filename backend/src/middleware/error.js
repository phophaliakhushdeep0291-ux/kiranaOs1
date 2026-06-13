import { ZodError } from "zod";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { captureRequestError } from "../lib/errorTracking.js";

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
