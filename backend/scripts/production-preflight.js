import { env } from "../src/config/env.js";

const errors = [];
const warnings = [];

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function isPlaceholder(value = "") {
  const raw = String(value).trim().toLowerCase();
  if (!raw) return true;
  return raw === "secret" || raw === "password" ||
    /change[-_ ]?me|change-this|example|dummy|placeholder|localhost/.test(raw);
}
function parseOrigins(value = "") {
  return String(value).split(",").map((origin) => origin.trim()).filter(Boolean);
}

if (env.NODE_ENV !== "production") {
  warn(`NODE_ENV is ${env.NODE_ENV}; production preflight is most useful with NODE_ENV=production`);
}

if (!/^postgresql:\/\//.test(env.DATABASE_URL || "")) {
  fail("DATABASE_URL must use PostgreSQL in production; SQLite/file databases are not production-safe");
}

if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || isPlaceholder(env.JWT_SECRET)) {
  fail("JWT_SECRET must be unique, non-placeholder, and at least 32 characters");
}

if (env.ENABLE_DEVICE_LICENSE_SIGNING && (!env.LICENSE_SIGNING_SECRET || env.LICENSE_SIGNING_SECRET.length < 32 || isPlaceholder(env.LICENSE_SIGNING_SECRET))) {
  fail("LICENSE_SIGNING_SECRET must be unique, non-placeholder, and at least 32 characters when license signing is enabled");
}

const origins = parseOrigins(env.ALLOWED_ORIGINS);
if (!origins.length) fail("ALLOWED_ORIGINS must contain explicit HTTPS frontend origins");
for (const origin of origins) {
  if (origin === "*") fail("ALLOWED_ORIGINS must never use wildcard * in production");
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(origin)) {
    fail(`ALLOWED_ORIGINS contains local origin in production: ${origin}`);
  }
  if (!/^https:\/\//i.test(origin)) {
    fail(`ALLOWED_ORIGINS should use HTTPS in production: ${origin}`);
  }
}

if (env.ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION) {
  fail("ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION must be false for public production deployments");
}

if (!env.METRICS_REQUIRE_TOKEN || !env.METRICS_TOKEN) {
  fail("Production metrics must require METRICS_TOKEN");
}
if (env.METRICS_TOKEN && (env.METRICS_TOKEN.length < 24 || isPlaceholder(env.METRICS_TOKEN))) {
  fail("METRICS_TOKEN must be non-placeholder and at least 24 characters");
}

if (env.QUEUES_ENABLED && !env.REDIS_URL) {
  fail("REDIS_URL is required when QUEUES_ENABLED=true");
}
if (env.REDIS_URL && isPlaceholder(env.REDIS_URL)) {
  fail("REDIS_URL must not contain placeholder credentials");
}

if (env.RAZORPAY_ENABLED) {
  for (const key of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]) {
    const value = env[key];
    if (!value || isPlaceholder(value)) fail(`${key} must be configured with a real value when RAZORPAY_ENABLED=true`);
  }
}

if (env.GST_PROVIDER === "gsp_http") {
  for (const key of ["GST_PROVIDER_BASE_URL", "GST_PROVIDER_API_KEY", "GST_PROVIDER_LEGAL_NAME"]) {
    const value = env[key];
    if (!value || isPlaceholder(value)) fail(`${key} must be configured with a real certified GSP value`);
  }
  if (!env.GST_PROVIDER_CERTIFIED) fail("GST_PROVIDER_CERTIFIED must be true before legal production IRN submission");
  if (!/^https:\/\//i.test(env.GST_PROVIDER_BASE_URL || "")) fail("GST_PROVIDER_BASE_URL must use HTTPS");
} else {
  warn("Certified GSTN/GSP submission is disabled; the app can export GST registers but cannot create legal IRNs");
}

if (env.STORAGE_PROVIDER === "local" && env.EXPORT_DOWNLOADS_PUBLIC) {
  fail("Local storage cannot be public for production report exports");
}
if (["s3", "r2", "minio"].includes(env.STORAGE_PROVIDER)) {
  for (const key of ["STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"]) {
    const value = env[key];
    if (!value || isPlaceholder(value)) fail(`${key} must be configured for STORAGE_PROVIDER=${env.STORAGE_PROVIDER}`);
  }
}

if (env.ERROR_TRACKING_ENABLED && (!env.SENTRY_DSN || isPlaceholder(env.SENTRY_DSN))) {
  fail("SENTRY_DSN must be configured when ERROR_TRACKING_ENABLED=true");
}

if (env.WHATSAPP_PROVIDER !== "disabled") {
  for (const key of ["WHATSAPP_API_KEY", "WHATSAPP_SENDER_ID"]) {
    const value = env[key];
    if (!value || isPlaceholder(value)) fail(`${key} must be configured when WhatsApp provider is enabled`);
  }
}

for (const message of warnings) {
  console.warn(JSON.stringify({ type: "production_preflight_warning", message }));
}

if (errors.length) {
  for (const message of errors) {
    console.error(JSON.stringify({ type: "production_preflight_error", message }));
  }
  console.error(JSON.stringify({ type: "production_preflight", status: "failed", errorCount: errors.length }));
  process.exit(1);
}

console.log(JSON.stringify({ type: "production_preflight", status: "passed", warningCount: warnings.length }));
