import express from "express";
import crypto from "crypto";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import { env } from "./config/env.js";
import { database as db } from "./infrastructure/database/index.js";
import { errorHandler } from "./shared/errors/index.js";
import { aiLimiter, apiLimiter, authLimiter, requestId, requestLogger, securityHeaders } from "./middleware/security.js";
import { getRedisClient, getRedisStatus } from "./lib/redis.js";
import { checkStorageHealth } from "./lib/objectStorage.js";
import { getMetricsSnapshot, renderPrometheusMetrics, recordReadinessStatus } from "./lib/metrics.js";
import { getErrorTrackingStatus } from "./lib/errorTracking.js";
import { isAllowedCorsOrigin, parseAllowedOrigins } from "./lib/corsOrigins.js";

// Module routes
import { authRoutes } from "./core/auth/index.js";
import { shopRoutes } from "./core/shops/index.js";
import { productRoutes, pricingRoutes } from "./domains/catalog/index.js";
import publicRoutes from "./modules/public/public.routes.js";
import { orderRoutes, saleRoutes as billRoutes } from "./domains/sales/index.js";
import { customerRoutes, creditLedgerRoutes as udharRoutes } from "./domains/customers/index.js";
import { inventoryRoutes, inventoryLotRoutes as inventoryLotsRoutes, storeRoutes } from "./domains/inventory/index.js";
import { supplierRoutes } from "./domains/suppliers/index.js";
import reportRoutes from "./modules/reports/reports.routes.js";
import { syncRoutes } from "./core/sync/index.js";
import aiRoutes from "./modules/ai/ai.routes.js";
import planRoutes from "./modules/subscription/plans.routes.js";
import { subscriptionRoutes } from "./core/subscriptions/index.js";
import { deviceRoutes } from "./core/devices/index.js";
import { paymentRoutes as paymentProviderRoutes } from "./core/payments/index.js";
import { jobRoutes } from "./infrastructure/jobs/index.js";
import { reminderRoutes } from "./infrastructure/notifications/index.js";
import { expenseRoutes } from "./core/expenses/index.js";
import offerRoutes from "./modules/offers/offers.routes.js";
import rentalRoutes from "./verticals/clothing/rentals/rentals.routes.js";
import prescriptionRoutes from "./verticals/pharmacy/prescriptions/prescriptions.routes.js";
import productUnitRoutes from "./verticals/electronics/units/units.routes.js";
import fitmentRoutes from "./verticals/auto-parts/fitment/fitment.routes.js";
import sizeRunRoutes from "./verticals/footwear/sizes/sizes.routes.js";
import bookListRoutes from "./verticals/stationery-books/book-lists/book-lists.routes.js";
import furnitureOrderRoutes from "./verticals/furniture-home/orders/orders.routes.js";
import testerRoutes from "./verticals/beauty-cosmetics/testers/testers.routes.js";
import restaurantTableRoutes from "./verticals/restaurant/tables/tables.routes.js";
import restaurantMenuRoutes from "./verticals/restaurant/menu/menu.routes.js";
import manufacturingRoutes from "./verticals/manufacturing/manufacturing.routes.js";
import dishRecipeRoutes from "./verticals/restaurant/recipes/recipes.routes.js";
import kitchenTicketRoutes from "./verticals/restaurant/kot/kot.routes.js";
import integrationRoutes from "./modules/integrations/integrations.routes.js";
import { taxRoutes as complianceRoutes } from "./core/taxes/index.js";
import loyaltyRoutes from "./modules/loyalty/loyalty.routes.js";
import { purchaseOrderRoutes, purchaseReturnRoutes as purchaseReturnsRoutes } from "./domains/purchases/index.js";
import giftCardRoutes from "./modules/gift-cards/giftCards.routes.js";
import accountingRoutes from "./modules/finance/accounting.routes.js";
import diagnosticsRoutes from "./modules/diagnostics/diagnostics.routes.js";
import activityRoutes from "./modules/activity/activity.routes.js";
import assuranceRoutes from "./modules/assurance/assurance.routes.js";
import platformAdminRoutes from "./modules/platform-admin/platformAdmin.routes.js";
import remoteSupportRoutes from "./modules/remote-support/remoteSupport.routes.js";

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
const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);

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
      if (isAllowedCorsOrigin(origin, allowedOrigins, env.NODE_ENV)) {
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

// Which build is actually serving. The platform injects this at deploy time
// (Railway sets RAILWAY_GIT_COMMIT_SHA), so "did my fix reach production yet?"
// is one curl with a definitive answer.
//
// Read straight from process.env rather than config/env.js on purpose: that
// module exits the process on a schema miss, and a field that only exists to
// answer a deploy question must never be able to stop the server booting. Absent
// (local, docker run, a platform that sets none of these) simply reports unknown.
//
// Deliberately not validated against the git history: the point is to report what
// IS running, including a commit nobody expected.
const DEPLOY_COMMIT =
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GIT_COMMIT_SHA ||
  process.env.SOURCE_VERSION ||
  null;

const DEPLOY_BRANCH = process.env.RAILWAY_GIT_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || null;

function healthPayload() {
  return {
    status: "ok",
    service: "KiranaOS Backend",
    version: "1.0.0",
    // Short sha is enough to match against `git log` and keeps the public
    // endpoint from advertising a full build fingerprint.
    commit: DEPLOY_COMMIT ? DEPLOY_COMMIT.slice(0, 12) : "unknown",
    ...(DEPLOY_BRANCH ? { branch: DEPLOY_BRANCH } : {}),
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
app.use("/api/rentals", rentalRoutes);
app.use("/api/prescriptions", prescriptionRoutes);
app.use("/api/product-units", productUnitRoutes);
app.use("/api/fitment", fitmentRoutes);
app.use("/api/size-runs", sizeRunRoutes);
app.use("/api/book-lists", bookListRoutes);
app.use("/api/furniture-orders", furnitureOrderRoutes);
app.use("/api/testers", testerRoutes);
app.use("/api/restaurant/tables", restaurantTableRoutes);
app.use("/api/restaurant/menu", restaurantMenuRoutes);
app.use("/api/restaurant/recipes", dishRecipeRoutes);
app.use("/api/restaurant/kot", kitchenTicketRoutes);
app.use("/api/manufacturing", manufacturingRoutes);
app.use("/api/integrations", integrationRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api/compliance", complianceRoutes);
app.use("/api/loyalty", loyaltyRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
app.use("/api/gift-cards", giftCardRoutes);
app.use("/api/inventory-lots", inventoryLotsRoutes);
app.use("/api/purchase-returns", purchaseReturnsRoutes);
app.use("/api/accounting", accountingRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/diagnostics", diagnosticsRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/audit", assuranceRoutes);
app.use("/api/support", remoteSupportRoutes);
app.use("/api/platform-admin", platformAdminRoutes);

// ── 404 handler ───────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// ── Global error handler ──────────────────────────────────────
app.use(errorHandler);

export default app;
