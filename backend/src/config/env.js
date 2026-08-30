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
  GROQ_MODEL: z.string().default("openai/gpt-oss-20b"),
  GROQ_TRANSCRIBE_MODEL: z.string().default("whisper-large-v3-turbo"),
  // OpenAI — paid fallback
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  // Dedicated image-capable model and bounded request time for purchase invoice OCR.
  OPENAI_INVOICE_MODEL: z.string().default("gpt-4o-mini"),
  INVOICE_OCR_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(45000),
  OPENAI_TRANSCRIBE_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5500"),
  // Comma-separated emails allowed into the internal cross-shop admin dashboard.
  // Empty (default) = the feature is off and no one has platform-admin access.
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  TEST_DATABASE_URL: z.string().optional(),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(1000),
  // DineIn proxies guests through one address: budget per restaurant, not per
  // diner. The edge serving DineIn should additionally limit individual clients.
  STOREFRONT_WRITE_LIMIT_MAX: z.coerce.number().int().min(60).max(100000).default(1000),
  STOREFRONT_READ_LIMIT_MAX: z.coerce.number().int().min(1800).max(1000000).default(20000),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  FRONTEND_APP_URL: z.string().url().optional(),
  EMAIL_PROVIDER: z.enum(["console", "gmail_smtp", "disabled"]).default("console"),
  AUTH_EMAIL_FROM: z.string().optional(),
  GMAIL_SMTP_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
  // Google sign-in (OAuth client id). Unset = the /auth/google endpoint responds 503
  // and the frontend hides the button (frontend uses VITE_GOOGLE_CLIENT_ID, same value).
  GOOGLE_CLIENT_ID: z.string().optional(),
  AI_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  AI_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  // ── Financial Assurance Engine ──────────────────────────────
  // The deterministic engine always runs. The AI layer only ever explains,
  // summarizes and classifies, and defaults to "disabled" so no shop's data can
  // reach an external provider without a deliberate configuration change.
  //   disabled → deterministic fallback text only, no provider call at all
  //   mock     → in-process deterministic provider (tests/dev)
  //   groq / openai → external provider, redaction always applied first
  AUDIT_AI_PROVIDER: z.enum(["disabled", "mock", "groq", "openai"]).default("disabled"),
  AUDIT_AI_MODEL: z.string().optional(),
  AUDIT_AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(12000),
  AUDIT_AI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  // Consent gate: even with a provider configured, nothing is sent until the
  // shop's own settings opt in (settingsJson.audit.aiExplanationsConsent).
  AUDIT_AI_REQUIRE_SHOP_CONSENT: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  // Attachments are never sent unless this is explicitly turned on.
  AUDIT_AI_ALLOW_ATTACHMENTS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  AUDIT_TRANSACTION_TRIGGERED_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  // Scheduled sweeps run on the shared jobs infrastructure, so they only exist
  // when QUEUES_ENABLED is on and a worker is running.
  AUDIT_SCHEDULED_RUNS_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  AUDIT_SCHEDULED_RUN_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  // Overlap the window so a late offline sync is never skipped between ticks.
  AUDIT_SCHEDULED_RUN_LOOKBACK_HOURS: z.coerce.number().int().min(1).max(720).default(26),
  OWNER_PIN_REQUIRED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  OWNER_PIN_MAX_FAILURES: z.coerce.number().int().min(3).max(10).default(5),
  OWNER_PIN_SHOP_MAX_FAILURES: z.coerce.number().int().min(5).max(30).default(10),
  OWNER_PIN_LOCKOUT_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
  LOG_LEVEL: z.enum(["silent", "error", "warn", "info", "debug"]).default("info"),
  ENABLE_DEVICE_LICENSE_SIGNING: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  ENABLE_DEV_DEVICE_LIMIT_OVERRIDE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  DEV_MAX_ACTIVE_DEVICES: z.coerce.number().int().min(0).max(50).default(0),
  LICENSE_SIGNING_SECRET: z.string().optional(),
  RAZORPAY_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  // Razorpay QR Codes is an on-demand product. Keep it separately gated so
  // ordinary Checkout credentials never imply that dynamic QR is available.
  RAZORPAY_DYNAMIC_QR_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  RETAIL_PAYMENT_PROVIDER: z.enum(["manual", "razorpay"]).default("manual"),
  RETAIL_PAYMENT_CONFIRMATION_REQUIRED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  RETAIL_PAYMENT_INTENT_TTL_MINUTES: z.coerce.number().int().min(3).max(60).default(15),
  // 32-byte base64 or 64-character hex key used only to encrypt restaurant-owned
  // provider credentials. Rotating it requires a deliberate credential migration.
  PAYMENT_CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),
  // Card/EDC terminal at the counter. "simulated" confirms charges with no bank
  // behind them and exists only for development and automated tests; the
  // production guard below refuses to boot with it enabled.
  CARD_TERMINAL_PROVIDER: z.enum(["none", "simulated", "pine_labs", "ezetap"]).default("none"),
  CARD_TERMINAL_BASE_URL: z.string().url().optional(),
  CARD_TERMINAL_API_KEY: z.string().optional(),
  CARD_TERMINAL_MERCHANT_ID: z.string().optional(),
  CARD_TERMINAL_ID: z.string().optional(),
  CARD_TERMINAL_STORE_ID: z.string().optional(),
  // Exact KiranaOS StoreLocation.code served by this physical terminal. A
  // globally configured EDC device must never be pushed a different branch's bill.
  CARD_TERMINAL_LOCATION_CODE: z.string().optional(),
  CARD_TERMINAL_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  // How long a cashier may leave a charge sitting on the terminal before the
  // intent expires and the card must be presented again.
  CARD_TERMINAL_CHARGE_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(600).default(180),
  // JSON object keyed by coupon code. Example:
  // {"LAUNCH25":{"percentOff":25,"plans":["growth","pro"],"billingCycles":["yearly"],"expiresAt":"2026-12-31T23:59:59.999Z"}}
  SUBSCRIPTION_COUPONS_JSON: z.string().default("{}"),
  ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  REDIS_URL: z.string().optional(),
  QUEUES_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // auto keeps one-service deployments affordable: API + worker when queues
  // are enabled, API only otherwise. api/worker allow a later split into two
  // independently scaled Railway services without changing the image.
  PROCESS_ROLE: z.enum(["auto", "api", "worker", "all"]).default("auto"),
  // §11 event streaming. "none" keeps the platform byte-identical to before;
  // "redis" uses Redis Streams; "kafka" is reserved for a future adapter.
  EVENT_BUS_PROVIDER: z.enum(["none", "redis", "kafka"]).default("none"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(3),
  WORKER_INSTANCE_ID: z.string().optional(),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(5000).max(300000).default(30000),
  WORKER_STALE_AFTER_MS: z.coerce.number().int().min(10000).max(900000).default(90000),
  JOB_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(7).max(365).default(30),
  BACKUP_CLEANUP_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  BACKUP_ENCRYPTION_KEY: z.string().optional(),
  // Off-site database backup. The tenant artifact path already reaches object
  // storage; the database-level dump did not, so a container that died took the
  // only copy of the dump with it. Enabled explicitly because a shop that has no
  // bucket configured is better off with a loud daily failure than a silent one.
  DATABASE_BACKUP_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  DATABASE_BACKUP_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  // Retention never prunes below this many dumps, whatever the age cutoff says.
  // A backup job that stalls for a month must not also delete the last dump it
  // managed to take.
  DATABASE_BACKUP_MIN_RETAINED: z.coerce.number().int().min(1).max(50).default(3),
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
  WHATSAPP_TEMPLATE_NAME: z.string().optional(),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().min(2).max(20).default("en"),
  WHATSAPP_GUPSHUP_APP_NAME: z.string().optional(),
  WHATSAPP_DEFAULT_COUNTRY_CODE: z.string().regex(/^\+[1-9]\d{0,3}$/).default("+91"),
  WHATSAPP_WEBHOOK_PUBLIC_URL: z.string().url().optional(),
  WHATSAPP_WEBHOOK_SECRET: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  INTEGRATION_SIGNING_SECRET: z.string().optional(),
  INTEGRATION_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  TALLY_BASE_URL: z.string().url().default("http://127.0.0.1:9000"),
  TALLY_PUSH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  FLIPKART_SELLER_API_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  FLIPKART_APP_ID: z.string().optional(),
  FLIPKART_APP_SECRET: z.string().optional(),
  // Seller API credentials are process-level secrets, so they must be pinned to
  // exactly one tenant. A second deployment/secret set is required for a second
  // seller account; no request may choose the tenant at runtime.
  FLIPKART_SHOP_ID: z.string().trim().min(1).optional(),
  // JSON object: {"flipkart-location-id":"kiranaos-location-code"}. An
  // unmapped marketplace warehouse is rejected instead of silently routing its
  // stock/order work to the primary branch.
  FLIPKART_LOCATION_MAP_JSON: z.string().default("{}"),
  FLIPKART_API_BASE_URL: z.string().url().default("https://api.flipkart.net"),
  FLIPKART_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  // GST compliance submission is disabled until a certified provider adapter is
  // configured. Sandbox documents are visibly non-legal and cannot be mistaken
  // for a GSTN acknowledgement.
  GST_PROVIDER: z.enum(["disabled", "sandbox", "gsp_http"]).default("disabled"),
  GST_PROVIDER_BASE_URL: z.string().url().optional(),
  GST_PROVIDER_EINVOICE_PATH: z.string().default("/e-invoices"),
  GST_PROVIDER_EWAY_PATH: z.string().default("/e-way-bills"),
  GST_PROVIDER_API_KEY: z.string().optional(),
  GST_PROVIDER_API_SECRET: z.string().optional(),
  GST_PROVIDER_LEGAL_NAME: z.string().optional(),
  // This is an operator attestation: enable it only after the configured GSP
  // confirms that the production account is authorized to create GSTN IRNs.
  GST_PROVIDER_CERTIFIED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  GST_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
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

if (parsed.data.NODE_ENV === "production" && parsed.data.ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION) {
  console.error("❌ ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION must stay false in production");
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

if (parsed.data.EVENT_BUS_PROVIDER === "redis" && !parsed.data.REDIS_URL) {
  console.error("❌ REDIS_URL is required when EVENT_BUS_PROVIDER=redis");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && parsed.data.EVENT_BUS_PROVIDER === "kafka") {
  console.error("❌ EVENT_BUS_PROVIDER=kafka cannot run in production until the Kafka transport is installed and certified");
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

if (parsed.data.NODE_ENV === "production" && parsed.data.EMAIL_PROVIDER === "gmail_smtp") {
  const missing = [
    ["GMAIL_SMTP_USER", parsed.data.GMAIL_SMTP_USER],
    ["GMAIL_APP_PASSWORD", parsed.data.GMAIL_APP_PASSWORD],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    console.error(`❌ ${missing.join(", ")} required in production when EMAIL_PROVIDER=gmail_smtp`);
    process.exit(1);
  }
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
    ...(parsed.data.WHATSAPP_PROVIDER === "interakt" ? [] : [["WHATSAPP_SENDER_ID", parsed.data.WHATSAPP_SENDER_ID]]),
  ].filter(([, value]) => !value).map(([key]) => key);
  if (parsed.data.WHATSAPP_PROVIDER === "twilio" && !parsed.data.WHATSAPP_API_SECRET) {
    missing.push("WHATSAPP_API_SECRET");
  }
  if (parsed.data.WHATSAPP_PROVIDER === "meta" && !parsed.data.WHATSAPP_BASE_URL) missing.push("WHATSAPP_BASE_URL");
  if (parsed.data.WHATSAPP_PROVIDER === "gupshup" && !parsed.data.WHATSAPP_GUPSHUP_APP_NAME) missing.push("WHATSAPP_GUPSHUP_APP_NAME");
  if (parsed.data.WHATSAPP_PROVIDER === "interakt" && !parsed.data.WHATSAPP_TEMPLATE_NAME) missing.push("WHATSAPP_TEMPLATE_NAME");
  if (!parsed.data.WHATSAPP_WEBHOOK_PUBLIC_URL) missing.push("WHATSAPP_WEBHOOK_PUBLIC_URL");
  if (["meta", "gupshup", "interakt"].includes(parsed.data.WHATSAPP_PROVIDER) && !parsed.data.WHATSAPP_WEBHOOK_SECRET) missing.push("WHATSAPP_WEBHOOK_SECRET");
  if (parsed.data.WHATSAPP_PROVIDER === "meta" && !parsed.data.WHATSAPP_WEBHOOK_VERIFY_TOKEN) missing.push("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
  if (parsed.data.WHATSAPP_WEBHOOK_SECRET && parsed.data.WHATSAPP_WEBHOOK_SECRET.length < 32) missing.push("WHATSAPP_WEBHOOK_SECRET_MIN_32_CHARS");
  if (parsed.data.WHATSAPP_PROVIDER === "meta" && parsed.data.WHATSAPP_WEBHOOK_VERIFY_TOKEN && parsed.data.WHATSAPP_WEBHOOK_VERIFY_TOKEN.length < 16) missing.push("WHATSAPP_WEBHOOK_VERIFY_TOKEN_MIN_16_CHARS");
  if (parsed.data.WHATSAPP_WEBHOOK_PUBLIC_URL && !/^https:\/\//i.test(parsed.data.WHATSAPP_WEBHOOK_PUBLIC_URL)) missing.push("WHATSAPP_WEBHOOK_PUBLIC_URL_HTTPS_REQUIRED");
  if (parsed.data.WHATSAPP_BASE_URL) {
    const officialHosts = { meta: "graph.facebook.com", twilio: "api.twilio.com", gupshup: "api.gupshup.io", interakt: "api.interakt.ai" };
    try {
      const baseUrl = new URL(parsed.data.WHATSAPP_BASE_URL);
      if (baseUrl.protocol !== "https:" || baseUrl.hostname !== officialHosts[parsed.data.WHATSAPP_PROVIDER]) {
        missing.push("WHATSAPP_BASE_URL_OFFICIAL_HTTPS_HOST_REQUIRED");
      }
    } catch {
      missing.push("WHATSAPP_BASE_URL_INVALID");
    }
  }
  if (missing.length) {
    console.error(`❌ ${missing.join(", ")} required in production when WHATSAPP_PROVIDER=${parsed.data.WHATSAPP_PROVIDER}`);
    process.exit(1);
  }
}

if (parsed.data.FLIPKART_SELLER_API_ENABLED) {
  const missing = ["FLIPKART_APP_ID", "FLIPKART_APP_SECRET", "FLIPKART_SHOP_ID"].filter((key) => !parsed.data[key]);
  try {
    const mapping = JSON.parse(parsed.data.FLIPKART_LOCATION_MAP_JSON);
    if (!mapping || Array.isArray(mapping) || typeof mapping !== "object" || Object.keys(mapping).length === 0) {
      missing.push("FLIPKART_LOCATION_MAP_JSON_NON_EMPTY_OBJECT");
    } else if (Object.entries(mapping).some(([externalId, locationCode]) => !String(externalId).trim() || !String(locationCode).trim())) {
      missing.push("FLIPKART_LOCATION_MAP_JSON_VALID_ENTRIES");
    }
  } catch {
    missing.push("FLIPKART_LOCATION_MAP_JSON_VALID_JSON");
  }
  if (parsed.data.NODE_ENV === "production") {
    try {
      const baseUrl = new URL(parsed.data.FLIPKART_API_BASE_URL);
      if (baseUrl.protocol !== "https:" || baseUrl.hostname !== "api.flipkart.net") {
        missing.push("FLIPKART_API_BASE_URL_OFFICIAL_HTTPS_HOST_REQUIRED");
      }
    } catch {
      missing.push("FLIPKART_API_BASE_URL_INVALID");
    }
  }
  if (missing.length) {
    console.error(`❌ ${[...new Set(missing)].join(", ")} required when FLIPKART_SELLER_API_ENABLED=true`);
    process.exit(1);
  }
}

if (parsed.data.RETAIL_PAYMENT_CONFIRMATION_REQUIRED && parsed.data.RETAIL_PAYMENT_PROVIDER !== "razorpay") {
  console.error("âŒ RETAIL_PAYMENT_PROVIDER=razorpay is required when retail payment confirmation is mandatory");
  process.exit(1);
}

if (parsed.data.RETAIL_PAYMENT_PROVIDER === "razorpay" && !parsed.data.RAZORPAY_ENABLED) {
  console.error("âŒ RAZORPAY_ENABLED=true is required when RETAIL_PAYMENT_PROVIDER=razorpay");
  process.exit(1);
}

if (parsed.data.RAZORPAY_DYNAMIC_QR_ENABLED && (!parsed.data.RAZORPAY_ENABLED || parsed.data.RETAIL_PAYMENT_PROVIDER !== "razorpay")) {
  console.error("RAZORPAY_ENABLED=true and RETAIL_PAYMENT_PROVIDER=razorpay are required when RAZORPAY_DYNAMIC_QR_ENABLED=true");
  process.exit(1);
}

// A simulated terminal marks bills paid without a bank ever moving money.
// Treat it as a build-time impossibility in production, not a runtime warning.
if (parsed.data.NODE_ENV === "production" && parsed.data.CARD_TERMINAL_PROVIDER === "simulated") {
  console.error("❌ CARD_TERMINAL_PROVIDER=simulated cannot run in production: it confirms card payments that no bank authorised");
  process.exit(1);
}

if (["pine_labs", "ezetap"].includes(parsed.data.CARD_TERMINAL_PROVIDER)) {
  const missing = ["CARD_TERMINAL_BASE_URL", "CARD_TERMINAL_API_KEY", "CARD_TERMINAL_MERCHANT_ID", "CARD_TERMINAL_ID", "CARD_TERMINAL_STORE_ID", "CARD_TERMINAL_LOCATION_CODE"].filter((key) => !parsed.data[key]);
  if (missing.length) {
    console.error(`❌ ${missing.join(", ")} required when CARD_TERMINAL_PROVIDER=${parsed.data.CARD_TERMINAL_PROVIDER}`);
    process.exit(1);
  }
}

if (parsed.data.NODE_ENV === "production" && parsed.data.CARD_TERMINAL_PROVIDER === "pine_labs") {
  try {
    const baseUrl = new URL(parsed.data.CARD_TERMINAL_BASE_URL);
    if (baseUrl.origin !== "https://www.plutuscloudservice.in:8201" || !["", "/"].includes(baseUrl.pathname)) {
      console.error("❌ CARD_TERMINAL_BASE_URL must be the official Pine Labs production cloud origin");
      process.exit(1);
    }
  } catch {
    console.error("❌ CARD_TERMINAL_BASE_URL must be a valid Pine Labs production URL");
    process.exit(1);
  }
}

if (parsed.data.NODE_ENV === "production" && parsed.data.CARD_TERMINAL_PROVIDER === "ezetap") {
  console.error("❌ CARD_TERMINAL_PROVIDER=ezetap cannot run in production until the provider adapter is implemented and certified");
  process.exit(1);
}

if (parsed.data.NODE_ENV === "production" && (!parsed.data.INTEGRATION_SIGNING_SECRET || parsed.data.INTEGRATION_SIGNING_SECRET.length < 32)) {
  console.error("❌ INTEGRATION_SIGNING_SECRET must be at least 32 characters in production");
  process.exit(1);
}

if (parsed.data.GST_PROVIDER === "gsp_http") {
  const missing = [
    ["GST_PROVIDER_BASE_URL", parsed.data.GST_PROVIDER_BASE_URL],
    ["GST_PROVIDER_API_KEY", parsed.data.GST_PROVIDER_API_KEY],
    ["GST_PROVIDER_LEGAL_NAME", parsed.data.GST_PROVIDER_LEGAL_NAME],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    console.error(`âŒ ${missing.join(", ")} required when GST_PROVIDER=gsp_http`);
    process.exit(1);
  }
  if (parsed.data.NODE_ENV === "production" && !/^https:\/\//i.test(parsed.data.GST_PROVIDER_BASE_URL)) {
    console.error("âŒ GST_PROVIDER_BASE_URL must use HTTPS in production");
    process.exit(1);
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.GST_PROVIDER_CERTIFIED) {
    console.error("âŒ GST_PROVIDER_CERTIFIED=true is required for production GSP submission");
    process.exit(1);
  }
}

export const env = parsed.data;
