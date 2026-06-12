import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("15m"),
  // Groq — free tier, recommended (https://console.groq.com)
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("llama3-8b-8192"),
  // OpenAI — paid fallback
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5500"),
  TEST_DATABASE_URL: z.string().optional(),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(1000),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  AI_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  AI_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  OWNER_PIN_REQUIRED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  LOG_LEVEL: z.enum(["silent", "error", "warn", "info", "debug"]).default("info"),
  ENABLE_DEVICE_LICENSE_SIGNING: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  ENABLE_DEV_DEVICE_LIMIT_OVERRIDE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  DEV_MAX_ACTIVE_DEVICES: z.coerce.number().int().min(0).max(50).default(0),
  LICENSE_SIGNING_SECRET: z.string().optional(),
  RAZORPAY_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  REDIS_URL: z.string().optional(),
  QUEUES_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(3),
  WORKER_INSTANCE_ID: z.string().optional(),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(5000).max(300000).default(30000),
  WORKER_STALE_AFTER_MS: z.coerce.number().int().min(10000).max(900000).default(90000),
  JOB_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  DAILY_CLOSING_SCHEDULE_HOUR: z.coerce.number().int().min(0).max(23).default(2),
  DAILY_CLOSING_TIMEZONE: z.string().default("Asia/Kolkata"),
  STORAGE_PROVIDER: z.enum(["local", "s3", "r2", "minio"]).default("local"),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_PUBLIC_BASE_URL: z.string().optional(),
  STORAGE_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  EXPORT_DOWNLOADS_PUBLIC: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  EXPORT_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  METRICS_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  METRICS_REQUIRE_TOKEN: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  METRICS_TOKEN: z.string().optional(),
  ERROR_TRACKING_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  WHATSAPP_PROVIDER: z.enum(["disabled", "meta", "twilio", "gupshup", "interakt"]).default("disabled"),
  WHATSAPP_API_KEY: z.string().optional(),
  WHATSAPP_API_SECRET: z.string().optional(),
  WHATSAPP_SENDER_ID: z.string().optional(),
  WHATSAPP_BASE_URL: z.string().optional(),
  REMINDER_COOLDOWN_HOURS: z.coerce.number().int().min(1).max(168).default(6),
});


const WEAK_PRODUCTION_SECRET_VALUES = new Set([
  "secret",
  "changeme",
  "change-me",
  "change_me",
  "your-secret-key",
  "your_jwt_secret",
  "jwt_secret",
  "development-secret",
]);

function isLocalOrigin(origin) {
  const value = String(origin || "").trim().toLowerCase();
  return value.includes("localhost")
    || value.includes("127.0.0.1")
    || value.includes("0.0.0.0")
    || value.includes("::1")
    || value === "*";
}

function isPostgresDatabaseUrl(url) {
  return /^postgres(ql)?:\/\//i.test(String(url || "").trim());
}

function isHttpsOrigin(origin) {
  return /^https:\/\//i.test(String(origin || "").trim());
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}


if (parsed.data.NODE_ENV === "production" && parsed.data.JWT_SECRET.length < 32) {
  console.error("❌ JWT_SECRET must be at least 32 characters in production");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && !isPostgresDatabaseUrl(parsed.data.DATABASE_URL)) {
  console.error("❌ DATABASE_URL must use PostgreSQL in production");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && WEAK_PRODUCTION_SECRET_VALUES.has(parsed.data.JWT_SECRET.trim().toLowerCase())) {
  console.error("❌ JWT_SECRET uses a known unsafe placeholder value");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && parsed.data.OWNER_PIN_REQUIRED !== true) {
  console.error("❌ OWNER_PIN_REQUIRED must stay true in production");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production") {
  const origins = parsed.data.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (!origins.length || origins.some(isLocalOrigin)) {
    console.error("❌ ALLOWED_ORIGINS must contain only real production origins in production");
    process.exit(1);
  }
  if (origins.some((origin) => !isHttpsOrigin(origin))) {
    console.error("❌ ALLOWED_ORIGINS must use HTTPS origins in production");
    process.exit(1);
  }
}

if (parsed.data.NODE_ENV === "production" && parsed.data.METRICS_ENABLED && !parsed.data.METRICS_REQUIRE_TOKEN) {
  console.error("❌ METRICS_REQUIRE_TOKEN must be true in production when metrics are enabled");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && !parsed.data.LICENSE_SIGNING_SECRET) {
  console.error("❌ LICENSE_SIGNING_SECRET is required in production for secure device license signing");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && parsed.data.LICENSE_SIGNING_SECRET && parsed.data.LICENSE_SIGNING_SECRET.length < 32) {
  console.error("❌ LICENSE_SIGNING_SECRET must be at least 32 characters in production");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && parsed.data.LICENSE_SIGNING_SECRET && WEAK_PRODUCTION_SECRET_VALUES.has(parsed.data.LICENSE_SIGNING_SECRET.trim().toLowerCase())) {
  console.error("❌ LICENSE_SIGNING_SECRET uses a known unsafe placeholder value");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && parsed.data.RAZORPAY_ENABLED) {
  const missing = [
    ["RAZORPAY_KEY_ID", parsed.data.RAZORPAY_KEY_ID],
    ["RAZORPAY_KEY_SECRET", parsed.data.RAZORPAY_KEY_SECRET],
    ["RAZORPAY_WEBHOOK_SECRET", parsed.data.RAZORPAY_WEBHOOK_SECRET],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    console.error(`❌ ${missing.join(", ")} required in production when RAZORPAY_ENABLED=true`);
    process.exit(1);
  }
}

if (parsed.data.NODE_ENV === "production" && parsed.data.QUEUES_ENABLED && !parsed.data.REDIS_URL) {
  console.error("❌ REDIS_URL is required in production when QUEUES_ENABLED=true");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && parsed.data.EXPORT_DOWNLOADS_PUBLIC && parsed.data.STORAGE_PROVIDER === "local") {
  console.error("❌ STORAGE_PROVIDER=local is not production-safe when EXPORT_DOWNLOADS_PUBLIC=true");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && parsed.data.METRICS_REQUIRE_TOKEN && !parsed.data.METRICS_TOKEN) {
  console.error("❌ METRICS_TOKEN is required in production when METRICS_REQUIRE_TOKEN=true");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && parsed.data.METRICS_REQUIRE_TOKEN && parsed.data.METRICS_TOKEN && parsed.data.METRICS_TOKEN.length < 24) {
  console.error("❌ METRICS_TOKEN must be at least 24 characters in production");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && parsed.data.ERROR_TRACKING_ENABLED && !parsed.data.SENTRY_DSN) {
  console.error("❌ SENTRY_DSN is required in production when ERROR_TRACKING_ENABLED=true");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && ["s3", "r2", "minio"].includes(parsed.data.STORAGE_PROVIDER)) {
  const missing = [
    ["STORAGE_BUCKET", parsed.data.STORAGE_BUCKET],
    ["STORAGE_ACCESS_KEY_ID", parsed.data.STORAGE_ACCESS_KEY_ID],
    ["STORAGE_SECRET_ACCESS_KEY", parsed.data.STORAGE_SECRET_ACCESS_KEY],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    console.error(`❌ ${missing.join(", ")} required in production when STORAGE_PROVIDER=${parsed.data.STORAGE_PROVIDER}`);
    process.exit(1);
  }
}

if (parsed.data.NODE_ENV === "production" && parsed.data.WHATSAPP_PROVIDER !== "disabled") {
  const missing = [
    ["WHATSAPP_API_KEY", parsed.data.WHATSAPP_API_KEY],
    ["WHATSAPP_SENDER_ID", parsed.data.WHATSAPP_SENDER_ID],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (["twilio", "gupshup", "interakt"].includes(parsed.data.WHATSAPP_PROVIDER) && !parsed.data.WHATSAPP_API_SECRET) {
    missing.push("WHATSAPP_API_SECRET");
  }
  if (missing.length) {
    console.error(`❌ ${missing.join(", ")} required in production when WHATSAPP_PROVIDER=${parsed.data.WHATSAPP_PROVIDER}`);
    process.exit(1);
  }
}

export const env = parsed.data;
