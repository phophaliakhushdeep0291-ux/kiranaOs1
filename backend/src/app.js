import express from "express";
import crypto from "crypto";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import { env } from "./config/env.js";
import db from "./db.js";
import { errorHandler } from "./middleware/error.js";
import { aiLimiter, apiLimiter, authLimiter, requestId, requestLogger, securityHeaders } from "./middleware/security.js";
import { getRedisClient, getRedisStatus } from "./lib/redis.js";
import { checkStorageHealth } from "./lib/objectStorage.js";
import { getMetricsSnapshot, renderPrometheusMetrics, recordReadinessStatus } from "./lib/metrics.js";
import { getErrorTrackingStatus } from "./lib/errorTracking.js";

// Module routes
import authRoutes from "./modules/auth/auth.routes.js";
import shopRoutes from "./modules/shops/shops.routes.js";
import productRoutes from "./modules/products/products.routes.js";
import publicRoutes from "./modules/public/public.routes.js";
import orderRoutes from "./modules/orders/orders.routes.js";
import pricingRoutes from "./modules/pricing/pricing.routes.js";
import customerRoutes from "./modules/customers/customers.routes.js";
import billRoutes from "./modules/bills/bills.routes.js";
import inventoryRoutes from "./modules/inventory/inventory.routes.js";
import udharRoutes from "./modules/udhar/udhar.routes.js";
import supplierRoutes from "./modules/suppliers/suppliers.routes.js";
import reportRoutes from "./modules/reports/reports.routes.js";
import syncRoutes from "./modules/sync/sync.routes.js";
import aiRoutes from "./modules/ai/ai.routes.js";
import planRoutes from "./modules/subscription/plans.routes.js";
import subscriptionRoutes from "./modules/subscription/subscription.routes.js";
import deviceRoutes from "./modules/devices/devices.routes.js";
import paymentProviderRoutes from "./modules/payment-provider/paymentProvider.routes.js";
import jobRoutes from "./modules/jobs/jobs.routes.js";
import reminderRoutes from "./modules/reminders/reminders.routes.js";
import expenseRoutes from "./modules/expenses/expenses.routes.js";
import offerRoutes from "./modules/offers/offers.routes.js";
import integrationRoutes from "./modules/integrations/integrations.routes.js";
import storeRoutes from "./modules/stores/stores.routes.js";
import complianceRoutes from "./modules/compliance/compliance.routes.js";
import loyaltyRoutes from "./modules/loyalty/loyalty.routes.js";
import purchaseOrderRoutes from "./modules/purchase-orders/purchaseOrders.routes.js";
import giftCardRoutes from "./modules/gift-cards/giftCards.routes.js";
import inventoryLotsRoutes from "./modules/inventory-lots/inventoryLots.routes.js";
import purchaseReturnsRoutes from "./modules/purchase-returns/purchaseReturns.routes.js";

const app = express();

// ── Production security / logging ───────────────────────────
app.disable("x-powered-by");
app.set("trust proxy", 1);
// Prisma BigInt shadow paise columns must not break res.json().
// Keep API compatible by serializing safe BigInt values as numbers.
app.set("json replacer", (_key, value) => {
  if (typeof value !== "bigint") return value;
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
});
app.use(requestId);
app.use(helmet());
// Gzip JSON responses — sync pulls and report payloads shrink 5-10x on shop
// connections; CPU cost is negligible at this payload size.
app.use(compression());
app.use(securityHeaders);
app.use(requestLogger);

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);

function createCorsDeniedError(origin) {
  const error = new Error("CORS origin not allowed");
  error.statusCode = 403;
  error.code = "CORS_ORIGIN_DENIED";
  error.meta = { origin };
  return error;
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, curl)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(createCorsDeniedError(origin));
      }
    },
    credentials: true,
  })
);

// ── Body parsing ──────────────────────────────────────────────
// Razorpay webhook signature verification must use the exact raw request body.
app.use("/api/payment-provider/razorpay/webhook", express.raw({ type: "application/json", limit: "2mb" }));
// Meta and Interakt sign the exact JSON bytes. Twilio callbacks remain
// application/x-www-form-urlencoded and are parsed below for its SDK validator.
app.use("/api/reminders/webhooks", express.raw({ type: "application/json", limit: "256kb" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────────
function healthPayload() {
  return {
    status: "ok",
    service: "KiranaOS Backend",
    version: "1.0.0",
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  };
}

app.get("/api/health", (_req, res) => {
  res.json(healthPayload());
});

app.get("/health", (_req, res) => {
  res.json(healthPayload());
});

app.get("/health/ready", async (req, res) => {
  const startedAt = Date.now();
  const checks = { database: "unknown", redis: "disabled", storage: "unknown" };
  let status = "ok";

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "error";
    status = "error";
  }

  if (env.QUEUES_ENABLED) {
    try {
      await getRedisClient();
      checks.redis = getRedisStatus().connected ? "ok" : "degraded";
      if (checks.redis !== "ok" && status === "ok") status = "degraded";
    } catch {
      checks.redis = "error";
      if (status === "ok") status = "degraded";
    }
  }

  const storage = await checkStorageHealth();
  checks.storage = storage.status;
  if (storage.status === "error" && status === "ok") status = "degraded";
  recordReadinessStatus({ database: checks.database, redis: checks.redis, storage: checks.storage, storageProvider: storage.provider });

  const code = checks.database === "error" ? 503 : 200;
  res.status(code).json({
    ...healthPayload(),
    status,
    requestId: req.requestId,
    checks,
    workerRequired: env.QUEUES_ENABLED,
    storageProvider: storage.provider,
    errorTracking: getErrorTrackingStatus(),
    latencyMs: Date.now() - startedAt,
  });
});

function requireMetricsAccess(req, res, next) {
  if (!env.METRICS_ENABLED) return res.status(404).json({ success: false, error: "Metrics disabled", code: "METRICS_DISABLED" });
  if (env.METRICS_REQUIRE_TOKEN) {
    const header = req.headers.authorization || req.headers["x-metrics-token"];
    const token = Array.isArray(header) ? header[0] : header;
    const supplied = String(token || "").replace(/^Bearer\s+/i, "");
    if (!safeTokenEquals(supplied, env.METRICS_TOKEN)) {
      return res.status(401).json({ success: false, error: "Metrics token required", code: "METRICS_UNAUTHORIZED" });
    }
  }
  next();
}

function safeTokenEquals(supplied, expected) {
  if (!supplied || !expected) return false;
  const suppliedBuffer = Buffer.from(String(supplied));
  const expectedBuffer = Buffer.from(String(expected));
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

app.get("/api/health/metrics", requireMetricsAccess, (_req, res) => {
  res.json(getMetricsSnapshot());
});

app.get("/metrics", requireMetricsAccess, (_req, res) => {
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(renderPrometheusMetrics());
});

// ── Rate limiting ────────────────────────────────────────────
app.use("/api/", apiLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/ai", aiLimiter);

// ── API Routes ────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/payment-provider", paymentProviderRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/reminders", reminderRoutes);
app.use("/api/shops", shopRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/pricing", pricingRoutes);
app.use("/api/products", productRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/bills", billRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/udhar", udharRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/integrations", integrationRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api/compliance", complianceRoutes);
app.use("/api/loyalty", loyaltyRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
app.use("/api/gift-cards", giftCardRoutes);
app.use("/api/inventory-lots", inventoryLotsRoutes);
app.use("/api/purchase-returns", purchaseReturnsRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/ai", aiRoutes);

// ── 404 handler ───────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// ── Global error handler ──────────────────────────────────────
app.use(errorHandler);

export default app;
