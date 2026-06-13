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
      details: err.flatten().fieldErrors,
    });
  }

  // Prisma unique constraint violation
  if (err.code === "P2002") {
    const field = err.meta?.target?.join(", ") ?? "field";
    return res.status(409).json(baseError(req, `A record with this ${field} already exists`));
  }

  // Prisma record not found
  if (err.code === "P2025") {
    return res.status(404).json(baseError(req, "Record not found"));
  }

  const statusCode = Number(err.statusCode || err.status || 0);
  if (statusCode >= 400 && statusCode < 600) {
    if (statusCode >= 500) logUnhandledError(err, req);
    const message = statusCode >= 500 && env.NODE_ENV !== "development"
      ? "Internal server error"
      : err.message || "Request failed";
    return res.status(statusCode).json({
      ...baseError(req, message),
      ...(err.code && { code: err.code }),
      ...(err.publicData && typeof err.publicData === "object" ? err.publicData : {}),
      ...(err.meta && env.NODE_ENV === "development" ? { meta: err.meta } : {}),
    });
  }

  // Unknown error
  logUnhandledError(err, req);
  return res.status(500).json({
    ...baseError(req, "Internal server error"),
    ...(env.NODE_ENV === "development" && { detail: err.message }),
  });
}

/** Throw this to return a clean HTTP error from anywhere */
export class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
