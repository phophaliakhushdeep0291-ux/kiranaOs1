import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { recordHttpRequest } from "../lib/metrics.js";

const commonSecurityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
  "Cross-Origin-Resource-Policy": "same-site",
};

export function requestId(req, res, next) {
  const incoming = req.headers["x-request-id"];
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  const safeIncoming = typeof value === "string" && /^[a-zA-Z0-9._:-]{8,120}$/.test(value) ? value : null;
  req.requestId = safeIncoming || crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

export function securityHeaders(_req, res, next) {
  for (const [name, value] of Object.entries(commonSecurityHeaders)) {
    res.setHeader(name, value);
  }

  if (env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
}

function shouldLog(statusCode) {
  if (env.LOG_LEVEL === "silent") return false;
  if (env.LOG_LEVEL === "error") return statusCode >= 500;
  if (env.LOG_LEVEL === "warn") return statusCode >= 400;
  return env.NODE_ENV !== "test" || statusCode >= 500;
}

function writeLog(level, payload) {
  logger[typeof logger[level] === "function" ? level : "info"](payload);
}

export function requestLogger(req, res, next) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const status = res.statusCode;
    if (!shouldLog(status)) return;

    const durationMs = Date.now() - startedAt;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    const log = {
      type: "http_request",
      level,
      time: new Date().toISOString(),
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status,
      durationMs,
      ip: req.ip,
      userId: req.user?.userId ?? req.user?.id ?? null,
      shopId: req.user?.shopId ?? null,
      deviceId: req.headers["x-device-id"] ?? null,
      contentLength: Number(res.getHeader("content-length") || 0),
    };

    recordHttpRequest({ method: req.method, routeGroup: req.path.split("/").slice(1, 3).join("/") || "root", statusCode: status, durationMs });
    writeLog(level, log);
  });

  next();
}

function isReadRequest(req) {
  return req.method === "GET" || req.method === "HEAD";
}

function routeBucket(req) {
  const parts = String(req.path || "").split("/").filter(Boolean);
  if (parts[0] === "reports" && parts[1]) return `reports:${parts[1]}`;
  if (parts[0] === "sync" && parts[1]) return `sync:${parts[1]}`;
  return parts[0] || "root";
}

function localDevelopmentLimit(max) {
  // Local pilot testing often opens the POS in multiple browser profiles/windows.
  // Development should never block normal multi-tab/multi-device testing with 429s.
  return env.NODE_ENV === "production" ? max : Math.max(max, 1000000);
}

function apiRateLimitKey(req) {
  const deviceId = Array.isArray(req.headers["x-device-id"]) ? req.headers["x-device-id"][0] : req.headers["x-device-id"];
  const auth = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  const authHash = typeof auth === "string" && auth.trim()
    ? crypto.createHash("sha256").update(auth).digest("hex").slice(0, 18)
    : "anonymous";
  const deviceKey = typeof deviceId === "string" && deviceId.trim() ? `device:${deviceId.trim()}` : `auth:${authHash}`;

  // Important: separate route buckets. One noisy dashboard/report widget should not
  // rate-limit billing, sync push, products, customers, or another device's work.
  return `${req.ip}:${deviceKey}:${isReadRequest(req) ? "read" : "write"}:${routeBucket(req)}`;
}

function apiRateLimitMax(req) {
  const base = localDevelopmentLimit(env.API_RATE_LIMIT_MAX);
  if (env.NODE_ENV !== "production") return base;

  // Reads are cheap and often happen from multiple counters/devices in the same shop.
  // Keep writes/payment/auth stricter, but make normal POS reads tolerant.
  if (isReadRequest(req)) return Math.max(base, 1800);
  if (routeBucket(req) === "sync") return Math.max(base, 600);
  return base;
}

function shouldSkipApiRateLimit(req) {
  if (req.method === "OPTIONS") return true;
  if (req.path === "/health" || req.path.startsWith("/health/")) return true;
  if (req.path === "/api/health" || req.path.startsWith("/api/health/")) return true;
  return false;
}

function rateLimitHandler(_req, res) {
  res.setHeader("Retry-After", isReadRequest(_req) ? "3" : "10");
  return res.status(429).json({
    success: false,
    error: "Too many requests. Please try again later.",
    code: "RATE_LIMITED",
    requestId: _req.requestId,
  });
}

export const apiLimiter = rateLimit({
  windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  limit: apiRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: apiRateLimitKey,
  skip: shouldSkipApiRateLimit,
  handler: rateLimitHandler,
});

const RATE_LIMITED_AUTH_PATHS = new Set([
  "/register",
  "/login",
  "/google",
  "/verify-email",
  "/resend-verification",
  "/password/forgot",
  "/password/reset",
  "/refresh",
  "/device-replacement/complete",
  "/pin/verify",
  "/change-password",
]);

function authRoutePath(req) {
  const raw = String(req.path || req.originalUrl || req.url || "").split("?")[0];
  return raw.replace(/^\/api\/auth(?=\/|$)/, "") || "/";
}

/**
 * The brute-force limiter belongs on credential/token/PIN verification only.
 * Applying the same small anonymous-IP bucket to authenticated reads such as
 * /auth/me made normal page navigation consume login attempts and eventually
 * returned AUTH_RATE_LIMITED during session recovery.
 */
export function shouldSkipAuthRateLimit(req) {
  if (req.method === "OPTIONS") return true;
  return !RATE_LIMITED_AUTH_PATHS.has(authRoutePath(req));
}

export const authLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipAuthRateLimit,
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      error: "Too many login/register attempts. Please try again later.",
      code: "AUTH_RATE_LIMITED",
      requestId: req.requestId,
    }),
});

export const aiLimiter = rateLimit({
  windowMs: env.AI_RATE_LIMIT_WINDOW_MS,
  max: env.AI_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      error: "AI request limit reached. Please try again later.",
      code: "AI_RATE_LIMITED",
      requestId: req.requestId,
    }),
});
