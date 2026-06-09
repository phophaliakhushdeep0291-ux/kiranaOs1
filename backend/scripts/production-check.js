import fs from "fs";
import path from "path";

const root = process.cwd();

const requiredFiles = [
  ".env.example",
  ".gitignore",
  ".dockerignore",
  "package.json",
  "package-lock.json",
  "Dockerfile",
  "docker-compose.yml",
  "README.md",
  "DEPLOY.md",
  "docs/MONEY_MIGRATION.md",
  "docs/PAISE_SHADOW_COLUMNS.md",
  "scripts/production-check.js",
  "scripts/backup-postgres.sh",
  "prisma/schema.prisma",
  "prisma-postgres/schema.prisma",
  "tests/integration/setup.js",
  "tests/integration/factories.js",
  "tests/integration/auth.integration.test.js",
  "tests/integration/billing.integration.test.js",
  "tests/integration/products.integration.test.js",
  "tests/integration/rbac-pin.integration.test.js",
  "tests/integration/customers.integration.test.js",
  "tests/integration/sync.integration.test.js",
  "tests/integration/reports.integration.test.js",
  "tests/integration/tenant-isolation.integration.test.js",
  "tests/integration/subscription-device.integration.test.js",
  "tests/integration/device-license.integration.test.js",
  "tests/phase6-saas-foundation.examples.js",
  "tests/phase7-razorpay-integration.examples.js",
  "tests/phase8-device-license-security.examples.js",
  "tests/phase11-shopkeeper-reports.examples.js",
  "tests/phase12-daily-closing-snapshots.examples.js",
  "src/lib/fileStorage.js",
  "src/modules/reports/reportExport.service.js",
  "tests/phase13-report-export-jobs.examples.js",
  ".github/workflows/backend-ci.yml",
  "docs/SCHEDULING.md",
  "docs/PRODUCTION_DEPLOYMENT.md",
  "src/lib/objectStorage.js",
  "src/lib/logger.js",
  "src/lib/metrics.js",
  "scripts/smoke-test.js",
  "scripts/verify-worker-runtime.js",
  "tests/phase14-production-ci-deployment.examples.js",
  "tests/phase15-observability-storage.examples.js",
  "tests/phase16-monitoring-provider-validation.examples.js",
  "tests/phase17-whatsapp-reminders.examples.js",
  "tests/phase18-production-hardening.examples.js",
  "tests/phase19-production-correctness.examples.js",
  "tests/phase20-financial-identity-hardening.examples.js",
  "tests/phase21-auth-production-proof.examples.js",
  "prisma-postgres/migrations/000008_payment_webhook_processing_state/migration.sql",
  "tests/phase22-payment-webhook-ops.examples.js",
  "src/lib/workerHeartbeat.js",
  "scripts/check-worker-health.js",
  "docs/WORKER_OPERATIONS.md",
  "tests/phase23-worker-health-readiness.examples.js",
  "contracts/api-contract.v1.json",
  "docs/API_CONTRACT.md",
  "docs/E2E_PRODUCTION_PROOF.md",
  "scripts/check-api-contract.js",
  "scripts/e2e-contract-smoke.js",
  "tests/phase24-api-contract-proof.examples.js",
  "tests/phase25-production-proof.examples.js",
  "tests/integration/production-concurrency.integration.test.js",
  "scripts/postgres-production-proof.js",
  "docs/PRODUCTION_PROOF.md",
  "tests/phase26-operational-proof.examples.js",
  "tests/phase27-money-paise-migration.examples.js",
  "tests/phase28-disaster-recovery-proof.examples.js",
  "scripts/postgres-backup-create.js",
  "scripts/disaster-recovery-proof.js",
  "scripts/postgres-url-safety.js",
  "docs/DISASTER_RECOVERY.md",
  "CHANGELOG.md",
  "docs/RELEASE_RUNBOOK.md",
  "docs/ROLLBACK_PLAN.md",
  "docs/PRODUCTION_LAUNCH_GATE.md",
  "scripts/migration-safety-check.js",
  "scripts/release-gate.js",
  "scripts/release-manifest.js",
  "tests/phase29-release-gate.examples.js",
  "scripts/money-paise-reconciliation.js",
  "prisma-postgres/migrations/000009_money_paise_shadow_columns/migration.sql",
  "docs/OPERATIONAL_PROOF.md",
  "scripts/razorpay-fixture-proof.js",
  "scripts/production-proof-suite.js",
  "src/modules/reminders/reminders.routes.js",
  "src/modules/reminders/reminders.controller.js",
  "src/modules/reminders/reminders.service.js",
  "src/modules/reminders/reminders.schemas.js",
  "src/modules/reminders/reminderTemplates.service.js",
  "src/modules/reminders/whatsapp.provider.js",
  "src/modules/reminders/reminderFormatter.js",
  "scripts/verify-object-storage.js",
  "scripts/verify-export-flow.js",
  "scripts/production-preflight.js",
  "docs/ALERTING_RUNBOOK.md",
  "docs/PAYMENT_WEBHOOK_OPERATIONS.md",
  "src/lib/errorTracking.js",
  "src/modules/payment-provider/paymentProvider.routes.js",
  "src/modules/payment-provider/paymentProvider.service.js",
  "src/modules/devices/devices.routes.js",
  "src/modules/devices/devices.service.js",
  "src/modules/devices/license.service.js",
  "src/modules/devices/device.middleware.js",
  "src/modules/feature-gates/featureRegistry.js",
  "src/modules/feature-gates/featureGate.middleware.js",
  "src/modules/feature-gates/featureGate.service.js",
  "src/modules/subscription/plans.routes.js",
  "src/modules/subscription/subscription.routes.js",
  "src/modules/subscription/subscription.service.js",
  "src/modules/subscription/planConfig.js",
];

const requiredGitignorePatterns = [
  "node_modules",
  ".env",
  ".env.*",
  "!.env.example",
  "*.db",
  "*.db-journal",
  "prisma/dev.db",
  "prisma/dev.db-journal",
  "uploads",
  "logs",
  "coverage",
  ".DS_Store",
  "*.zip",
];

const requiredDockerignorePatterns = [
  "node_modules",
  ".env",
  ".env.*",
  "!.env.example",
  "prisma/dev.db",
  "prisma/dev.db-journal",
  "dev.db",
  "dev.db-journal",
  "uploads",
  "logs",
  "coverage",
  ".DS_Store",
  "*.zip",
];

const localDevArtifacts = [
  ".env",
  "dev.db",
  "dev.db-journal",
  path.join("prisma", "dev.db"),
  path.join("prisma", "dev.db-journal"),
  "uploads",
  "logs",
];

const requiredEnvKeys = [
  "NODE_ENV",
  "PORT",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "POSTGRES_DATABASE_URL",
  "POSTGRES_TEST_DATABASE_URL",
  "ALLOW_POSTGRES_TEST_DB",
  "JWT_SECRET",
  "JWT_EXPIRES_IN",
  "ALLOWED_ORIGINS",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_TRANSCRIBE_MODEL",
  "API_RATE_LIMIT_WINDOW_MS",
  "API_RATE_LIMIT_MAX",
  "AUTH_RATE_LIMIT_WINDOW_MS",
  "AUTH_RATE_LIMIT_MAX",
  "AI_RATE_LIMIT_WINDOW_MS",
  "AI_RATE_LIMIT_MAX",
  "OWNER_PIN_REQUIRED",
  "LOG_LEVEL",
  "RAZORPAY_WEBHOOK_SECRET",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_ENABLED",
  "LICENSE_SIGNING_SECRET",
  "ENABLE_DEVICE_LICENSE_SIGNING",
  "REDIS_URL",
  "QUEUES_ENABLED",
  "DAILY_CLOSING_SCHEDULE_HOUR",
  "DAILY_CLOSING_TIMEZONE",
  "STORAGE_PROVIDER",
  "STORAGE_BUCKET",
  "STORAGE_REGION",
  "STORAGE_ENDPOINT",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "STORAGE_PUBLIC_BASE_URL",
  "EXPORT_DOWNLOADS_PUBLIC",
  "STORAGE_FORCE_PATH_STYLE",
  "EXPORT_SIGNED_URL_TTL_SECONDS",
  "METRICS_ENABLED",
  "SMOKE_BASE_URL",
  "SMOKE_EXPECT_WORKER",
  "SMOKE_EXPECT_REDIS",
  "SMOKE_EXPECT_STORAGE",
  "SMOKE_METRICS_EXPECTED",
  "ALLOW_PRODUCTION_SMOKE",
  "METRICS_REQUIRE_TOKEN",
  "METRICS_TOKEN",
  "ERROR_TRACKING_ENABLED",
  "SENTRY_DSN",
  "SENTRY_ENVIRONMENT",
  "SENTRY_RELEASE",
  "ALLOW_PRODUCTION_STORAGE_VERIFY",
  "ALLOW_PRODUCTION_EXPORT_VERIFY",
  "EXPORT_VERIFY_SHOP_ID",
  "EXPORT_VERIFY_USER_ID",
  "REMINDER_COOLDOWN_HOURS",
  "PROOF_REQUIRE_WORKER",
  "PROOF_REQUIRE_POSTGRES",
  "PROOF_REQUIRE_LIVE",
  "PROOF_BASE_URL",
  "ALLOW_MONEY_PAISE_BACKFILL",
  "WHATSAPP_BASE_URL",
  "WHATSAPP_SENDER_ID",
  "WHATSAPP_API_SECRET",
  "WHATSAPP_API_KEY",
  "WHATSAPP_PROVIDER",
  "RELEASE_VERSION",
  "RELEASE_CHANNEL",
  "RELEASE_APPROVED",
  "RELEASE_APPROVER",
  "RELEASE_ROLLBACK_IMAGE",
  "ALLOW_DESTRUCTIVE_MIGRATION",
];

const requiredPackageScripts = [
  "start",
  "test",
  "test:billing",
  "test:db",
  "test:integration",
  "setup:test-db",
  "db:push:test",
  "prod:check",
  "prisma:generate",
  "prisma:push",
  "prisma:generate:postgres",
  "prisma:deploy:postgres",
  "prisma:push:postgres",
  "daily-closing:run",
  "worker",
  "worker:verify",
  "contract:check",
  "contract:smoke",
  "setup:test-db:postgres",
  "test:postgres",
  "proof:postgres",
  "proof:ops",
  "razorpay:fixtures",
  "money:paise:reconcile",
  "money:paise:backfill",
  "docker:build",
  "smoke:test",
  "storage:verify",
  "export:verify",
  "prod:preflight",
  "migration:safety",
  "release:gate",
  "release:manifest",
  "proof:release",
];

const requiredPostgresTables = [
  "Shop",
  "User",
  "Session",
  "Product",
  "Bill",
  "BillCounter",
  "AuditLog",
  "OfflineSyncEvent",
  "PaymentProviderEvent",
  "DeviceLicense",
  "Device",
  "DailyClosingSnapshot",
  "PaymentTransaction",
  "Subscription",
  "Plan",
  "ReportExportJob",
  "ReminderTemplate",
  "ReminderLog",
];

const errors = [];
const warnings = [];

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function readJson(file) {
  return JSON.parse(read(file));
}

function readLines(file) {
  if (!exists(file)) return [];
  return read(file)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalize(file) {
  return file.split(path.sep).join("/");
}

function isIgnoredByPatterns(file, patterns) {
  const normalized = normalize(file);
  const base = path.basename(normalized);
  return patterns.includes(normalized) || patterns.includes(base) ||
    (normalized.endsWith(".db") && patterns.includes("*.db")) ||
    (normalized.endsWith(".db-journal") && patterns.includes("*.db-journal"));
}

for (const file of requiredFiles) {
  if (!exists(file)) errors.push(`Missing required production file: ${file}`);
}

const migrationDir = path.join(root, "prisma-postgres", "migrations");
const migrationFiles = fs.existsSync(migrationDir)
  ? fs.readdirSync(migrationDir, { recursive: true }).filter((name) => name.endsWith(".sql"))
  : [];
if (!migrationFiles.length) {
  errors.push("No PostgreSQL Prisma migration SQL file found under prisma-postgres/migrations");
}

const gitignoreLines = readLines(".gitignore");
const dockerignoreLines = readLines(".dockerignore");
for (const pattern of requiredGitignorePatterns) {
  if (!gitignoreLines.includes(pattern)) errors.push(`.gitignore missing required pattern: ${pattern}`);
}
for (const pattern of requiredDockerignorePatterns) {
  if (!dockerignoreLines.includes(pattern)) errors.push(`.dockerignore missing required pattern: ${pattern}`);
}

const localPresent = localDevArtifacts.filter(exists);
const localNotIgnored = localPresent.filter((file) => !isIgnoredByPatterns(file, gitignoreLines) || !isIgnoredByPatterns(file, dockerignoreLines));
for (const file of localNotIgnored) {
  errors.push(`Local dev artifact is present but not ignored/excluded: ${normalize(file)}`);
}

const rootZipFiles = fs.existsSync(root) ? fs.readdirSync(root).filter((name) => name.endsWith(".zip")) : [];
for (const file of rootZipFiles) {
  errors.push(`Local zip file is present in project root; remove before packaging: ${file}`);
}

if (exists("package.json") && exists("package-lock.json")) {
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const rootLockPackage = packageLock.packages?.[""] || {};

  if (packageLock.name && packageLock.name !== packageJson.name) {
    errors.push("package-lock.json name does not match package.json name");
  }
  if (packageLock.version && packageLock.version !== packageJson.version) {
    errors.push("package-lock.json version does not match package.json version");
  }

  for (const scriptName of requiredPackageScripts) {
    if (!packageJson.scripts?.[scriptName]) errors.push(`package.json missing required script: ${scriptName}`);
  }

  for (const [name, version] of Object.entries(packageJson.dependencies || {})) {
    if (rootLockPackage.dependencies?.[name] !== version) {
      errors.push(`package-lock root dependency is not synced for ${name}`);
    }
    if (!packageLock.packages?.[`node_modules/${name}`]) {
      errors.push(`package-lock missing node_modules entry for dependency: ${name}`);
    }
  }

  for (const [name, version] of Object.entries(packageJson.devDependencies || {})) {
    if (rootLockPackage.devDependencies?.[name] !== version) {
      errors.push(`package-lock root devDependency is not synced for ${name}`);
    }
    if (!packageLock.packages?.[`node_modules/${name}`]) {
      errors.push(`package-lock missing node_modules entry for devDependency: ${name}`);
    }
  }

  const lockRaw = read("package-lock.json");
  if (lockRaw.includes("packages.applied-caas-gateway") || lockRaw.includes("internal.api.openai.org")) {
    errors.push("package-lock.json contains internal registry URLs; use public npm registry lockfile URLs");
  }
}

if (exists(".env.example")) {
  const envExample = read(".env.example");
  for (const key of requiredEnvKeys) {
    if (!new RegExp(`^${key}=`, "m").test(envExample)) errors.push(`.env.example missing key: ${key}`);
  }
}

if (exists("prisma-postgres/schema.prisma")) {
  const pgSchema = read("prisma-postgres/schema.prisma");
  if (!pgSchema.includes('provider = "postgresql"')) errors.push("prisma-postgres/schema.prisma must use PostgreSQL provider");
  for (const table of requiredPostgresTables) {
    if (!pgSchema.includes(`model ${table}`)) errors.push(`prisma-postgres/schema.prisma missing model: ${table}`);
  }
}

if (migrationFiles.length) {
  const migrationText = migrationFiles.map((file) => read(path.join("prisma-postgres", "migrations", file))).join("\n");
  for (const table of requiredPostgresTables) {
    if (!migrationText.includes(`CREATE TABLE "${table}"`)) errors.push(`PostgreSQL migration missing table: ${table}`);
  }
}

if (exists("Dockerfile")) {
  const dockerfile = read("Dockerfile");
  if (!dockerfile.includes("npm ci")) errors.push("Dockerfile must install with npm ci");
  if (!dockerfile.includes("npm run prisma:generate:postgres")) errors.push("Dockerfile must generate Prisma client with PostgreSQL schema");
  if (!dockerfile.includes("npm run prisma:deploy:postgres")) errors.push("Dockerfile must deploy PostgreSQL migrations before start");
  if (!dockerfile.includes("HEALTHCHECK")) errors.push("Dockerfile must include HEALTHCHECK");
  if (!dockerfile.includes("COPY contracts ./contracts")) errors.push("Dockerfile must copy contracts so release/contract proof can run inside image");
}

if (exists("docker-compose.yml")) {
  const compose = read("docker-compose.yml");
  if (!compose.includes("postgres:16-alpine")) errors.push("docker-compose.yml must include postgres:16-alpine service");
  if (!compose.includes("DATABASE_URL:")) errors.push("docker-compose.yml must set DATABASE_URL for API");
  if (!compose.includes("postgresql://")) errors.push("docker-compose.yml DATABASE_URL must be PostgreSQL");
  if (!compose.includes("condition: service_healthy")) errors.push("API service should wait for healthy Postgres");
}

if (exists("src/app.js")) {
  const appSource = read("src/app.js");
  if (!appSource.includes('import helmet from "helmet"') || !appSource.includes("app.use(helmet())")) {
    errors.push("src/app.js must import and use helmet");
  }
  for (const requiredSnippet of [
    "requestId",
    "requestLogger",
    'app.get("/api/health"',
    'app.get("/health"',
    'app.get("/health/ready"',
    "apiLimiter",
    "authLimiter",
    "aiLimiter",
    "securityHeaders",
  ]) {
    if (!appSource.includes(requiredSnippet)) errors.push(`src/app.js missing required production middleware/endpoint: ${requiredSnippet}`);
  }
}

if (exists("src/middleware/error.js")) {
  const errorSource = read("src/middleware/error.js");
  if (!errorSource.includes("requestId")) errors.push("error middleware must include requestId in responses/logs");
  if (!errorSource.includes("NODE_ENV") || !errorSource.includes("development")) errors.push("error middleware must hide stack/details outside development");
}

if (exists("src/utils/money.js")) {
  const moneySource = read("src/utils/money.js");
  for (const helper of ["toPaise", "fromPaise", "sumMoney", "addMoney", "subtractMoney", "multiplyMoney", "moneyEquals"]) {
    if (!moneySource.includes(`export function ${helper}`)) errors.push(`src/utils/money.js missing helper: ${helper}`);
  }
}


if (exists("src/modules/products/products.routes.js")) {
  const productRoutes = read("src/modules/products/products.routes.js");
  if (!productRoutes.includes('router.post("/:id/restore", requireOwnerPin, ctrl.restore);')) {
    errors.push("Product restore route must require owner PIN");
  }
}

if (exists("src/modules/sync/sync.service.js")) {
  const syncService = read("src/modules/sync/sync.service.js");
  if (!/case SYNC_EVENT_TYPES\.RESTORE_PRODUCT:[\s\S]*assertOwnerPermission\(shopId, user, getEventOwnerPin\(event\)\)[\s\S]*return applyRestoreProduct/.test(syncService)) {
    errors.push("Offline RESTORE_PRODUCT sync must assert owner permission before restore");
  }
}

const requiredAuditActions = [
  "PRODUCT_RESTORED",
  "PRODUCT_PERMANENTLY_DELETED",
  "PRODUCT_RECYCLE_BIN_EMPTIED",
  "STOCK_CORRECTED",
  "STOCK_DAMAGED",
  "OWNER_PIN_VERIFIED",
];
const auditSourceFiles = [
  "src/modules/products/products.controller.js",
  "src/modules/inventory/inventory.controller.js",
  "src/middleware/permissions.js",
].filter(exists);
const auditSource = auditSourceFiles.map(read).join("\n");
for (const action of requiredAuditActions) {
  if (!auditSource.includes(action)) errors.push(`Missing required audit action in source: ${action}`);
}

if (exists("README.md")) {
  const readme = read("README.md");
  for (const word of ["Docker", "PostgreSQL", "production", "npm test"]) {
    if (!readme.toLowerCase().includes(word.toLowerCase())) warnings.push(`README.md may be missing production note for: ${word}`);
  }
}

if (exists("DEPLOY.md")) {
  const deploy = read("DEPLOY.md");
  for (const word of [
    "docker compose",
    "prisma:deploy:postgres",
    "DATABASE_URL",
    "health/ready",
    "Helmet is installed and enabled",
    "Rate limiting",
    "Product delete, product restore",
    "Inventory correction and damage",
    "Sessions/refresh/logout",
    "Float",
    "paise",
    "monitoring",
    "backup",
    "offline sync",
  ]) {
    if (!deploy.toLowerCase().includes(word.toLowerCase())) errors.push(`DEPLOY.md missing required deployment instruction/status: ${word}`);
  }
}

// ── Prisma schema drift detection ────────────────────────────────────────────
// These checks run on raw file content — no Prisma CLI needed.
// They catch common drift between prisma-postgres/schema.prisma and the
// hand-written migration SQL before a deploy reaches production.

function parsePrismaModelFields(schemaText) {
  // Returns { ModelName: Set([fieldName, ...]) } for all scalar fields.
  const models = {};
  let current = null;
  for (const rawLine of schemaText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const modelMatch = line.match(/^model (\w+)\s*\{/);
    if (modelMatch) { current = modelMatch[1]; models[current] = new Set(); continue; }
    if (current && line === "}") { current = null; continue; }
    if (!current || !line || line.startsWith("//") || line.startsWith("@@")) continue;
    const fieldMatch = line.match(/^(\w+)\s+(\S+)/);
    if (!fieldMatch) continue;
    const [, fname, ftype] = fieldMatch;
    // Only scalar fields — skip relation fields
    const scalar = /^(String|Int|Float|Boolean|DateTime|Json|Bytes|BigInt|Decimal)\??(\[\])?$/.test(ftype);
    if (scalar) models[current].add(fname);
  }
  return models;
}

function extractMigrationTableColumns(migrationText, tableName) {
  // Returns Set of column names found inside CREATE TABLE "TableName" (...)
  const blockMatch = migrationText.match(
    new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? "${tableName}"\s*\(([^;]+)\);`, "s")
  );
  if (!blockMatch) return null;
  const cols = new Set();
  for (const line of blockMatch[1].split(/\n/)) {
    const colMatch = line.trim().match(/^"(\w+)"/);
    if (colMatch && colMatch[1] !== "CONSTRAINT") cols.add(colMatch[1]);
  }

  // Later migrations may safely add nullable columns to existing tables. Include
  // ALTER TABLE ... ADD COLUMN entries in drift detection so additive migrations
  // do not require duplicating CREATE TABLE blocks.
  const alterRe = new RegExp(`ALTER TABLE "${tableName}" ADD COLUMN(?: IF NOT EXISTS)? "(\\w+)"`, "g");
  let match;
  while ((match = alterRe.exec(migrationText)) !== null) cols.add(match[1]);

  return cols;
}


if (exists("prisma/schema.prisma") && exists("prisma-postgres/schema.prisma")) {
  const sqliteSchema = read("prisma/schema.prisma");
  const pgSchema = read("prisma-postgres/schema.prisma");

  // ── Check A: binaryTargets present in both schemas ────────────────────────
  if (!sqliteSchema.includes('binaryTargets')) {
    errors.push('prisma/schema.prisma is missing binaryTargets — Prisma client will fail on Linux/Docker');
  }
  if (!pgSchema.includes('binaryTargets')) {
    errors.push('prisma-postgres/schema.prisma is missing binaryTargets — Docker deployment will fail');
  }
  if (sqliteSchema.includes('binaryTargets') && pgSchema.includes('binaryTargets')) {
    if (!sqliteSchema.includes('debian-openssl-3.0.x')) {
      errors.push('prisma/schema.prisma binaryTargets must include debian-openssl-3.0.x for Docker');
    }
    if (!pgSchema.includes('debian-openssl-3.0.x')) {
      errors.push('prisma-postgres/schema.prisma binaryTargets must include debian-openssl-3.0.x for Docker');
    }
  }

  // ── Check B: SQLite and PostgreSQL schemas must have the same models ───────
  const sqliteModels = parsePrismaModelFields(sqliteSchema);
  const pgModels = parsePrismaModelFields(pgSchema);
  const sqliteModelNames = new Set(Object.keys(sqliteModels));
  const pgModelNames = new Set(Object.keys(pgModels));

  for (const m of sqliteModelNames) {
    if (!pgModelNames.has(m)) {
      errors.push(`Model "${m}" exists in prisma/schema.prisma but is missing from prisma-postgres/schema.prisma`);
    }
  }
  for (const m of pgModelNames) {
    if (!sqliteModelNames.has(m)) {
      errors.push(`Model "${m}" exists in prisma-postgres/schema.prisma but is missing from prisma/schema.prisma`);
    }
  }

  // ── Check C: Fields must match between SQLite and PostgreSQL schemas ───────
  for (const model of sqliteModelNames) {
    if (!pgModelNames.has(model)) continue; // already reported above
    const sqliteFields = sqliteModels[model];
    const pgFields = pgModels[model];
    for (const f of sqliteFields) {
      if (!pgFields.has(f)) {
        errors.push(`Field "${model}.${f}" in SQLite schema is missing from PostgreSQL schema`);
      }
    }
    for (const f of pgFields) {
      if (!sqliteFields.has(f)) {
        errors.push(`Field "${model}.${f}" in PostgreSQL schema is missing from SQLite schema`);
      }
    }
  }
}

// ── Check D: Column drift between PostgreSQL schema and migration SQL ─────────
if (exists("prisma-postgres/schema.prisma") && migrationFiles.length) {
  const pgSchema = read("prisma-postgres/schema.prisma");
  const pgModels = parsePrismaModelFields(pgSchema);
  const allMigrationSql = migrationFiles
    .map((file) => read(path.join("prisma-postgres", "migrations", file)))
    .join("\n");

  // These are the critical models where column drift would be dangerous
  const criticalModels = [
    "Shop", "User", "Session", "Product", "Customer",
    "Bill", "BillItem", "Payment", "StockLedger", "UdharLedger",
    "Supplier", "BillCounter", "AuditLog", "OfflineSyncEvent",
    "Plan", "Subscription", "PaymentTransaction", "Device", "DeviceLicense", "PaymentProviderEvent", "DailyClosingSnapshot", "ReportExportJob", "ReminderTemplate", "ReminderLog",
  ];

  for (const model of criticalModels) {
    if (!pgModels[model]) continue; // model not in schema — already caught above
    const migrationCols = extractMigrationTableColumns(allMigrationSql, model);
    if (!migrationCols) {
      errors.push(`PostgreSQL migration is missing CREATE TABLE for "${model}"`);
      continue;
    }
    for (const field of pgModels[model]) {
      if (!migrationCols.has(field)) {
        errors.push(`Column drift: "${model}.${field}" exists in PostgreSQL schema but is absent from migration SQL — run a new migration`);
      }
    }
  }

  // ── Check E: Critical indexes must be present in migration ─────────────────
  const criticalIndexes = [
    ["Bill_shopId_status_createdAt_idx",     "Bill composite index for billing queries"],
    ["Product_shopId_deletedAt_idx",          "Product soft-delete index"],
    ["Customer_shopId_deletedAt_idx",         "Customer soft-delete index"],
    ["Session_userId_revokedAt_idx",          "Session revocation index"],
    ["OfflineSyncEvent_shopId_eventId_key",   "OfflineSyncEvent idempotency unique index"],
    ["UdharLedger_shopId_customerId_createdAt_idx", "Udhar ledger customer lookup index"],
    ["AuditLog_shopId_createdAt_idx",         "Audit log time-range query index"],
    // ── Sync pull keyset pagination indexes (Phase 4F) ──────────────────────
    // Required for efficient WHERE shopId=X AND updatedAt>=since ORDER BY updatedAt,id
    ["Product_shopId_updatedAt_id_idx",       "Product sync pull keyset index (shopId, updatedAt, id)"],
    ["Customer_shopId_updatedAt_id_idx",      "Customer sync pull keyset index (shopId, updatedAt, id)"],
    ["Bill_shopId_updatedAt_id_idx",          "Bill sync pull keyset index (shopId, updatedAt, id)"],
    ["StockLedger_shopId_updatedAt_id_idx",   "StockLedger sync pull keyset index (shopId, updatedAt, id)"],
    ["UdharLedger_shopId_updatedAt_id_idx",   "UdharLedger sync pull keyset index (shopId, updatedAt, id)"],
  ];
  for (const [indexName, description] of criticalIndexes) {
    if (!allMigrationSql.includes(indexName)) {
      errors.push(`PostgreSQL migration missing critical index: ${indexName} (${description})`);
    }
  }

  // ── Check F: Critical FK constraints must be present ──────────────────────
  const criticalFks = [
    ["BillCounter_shopId_fkey",       "BillCounter → Shop FK"],
    ["Session_userId_fkey",           "Session → User FK"],
    ["Bill_customerId_fkey",          "Bill → Customer FK (nullable)"],
    ["OfflineSyncEvent_shopId_fkey",  "OfflineSyncEvent → Shop FK"],
    ["UdharLedger_customerId_fkey",   "UdharLedger → Customer FK"],
    ["StockLedger_productId_fkey",    "StockLedger → Product FK"],
  ];
  for (const [fkName, description] of criticalFks) {
    if (!allMigrationSql.includes(fkName)) {
      errors.push(`PostgreSQL migration missing FK constraint: ${fkName} (${description})`);
    }
  }
}

// ── Check G: Phase 1 + Phase 2 RBAC protections (inline with existing checks) ─
if (exists("src/modules/customers/customers.routes.js")) {
  const customerRoutes = read("src/modules/customers/customers.routes.js");
  if (!customerRoutes.includes("requireOwnerPin") ||
      !customerRoutes.match(/router\.delete\("\/\:id",\s*requireOwnerPin/)) {
    errors.push("Customer DELETE /:id route must be protected by requireOwnerPin (Phase 2 requirement)");
  }
}

if (exists("src/modules/products/products.routes.js")) {
  const productRoutes = read("src/modules/products/products.routes.js");
  if (!productRoutes.match(/router\.post\("\/",\s*requireOwnerPinForFields/)) {
    errors.push("Product POST / route must use requireOwnerPinForFields for sensitive fields (Phase 2 requirement)");
  }
}

if (exists("src/modules/reports/reports.routes.js")) {
  const reportRoutes = read("src/modules/reports/reports.routes.js");
  if (!reportRoutes.includes("requireRole")) {
    errors.push("reports.routes.js must use requireRole for profit/revenue report routes (Phase 2 requirement)");
  }
  if (!reportRoutes.match(/\/pnl".*requireRole/)) {
    errors.push("P&L report route must be gated by requireRole('owner') (Phase 2 requirement)");
  }
}

if (exists("src/modules/bills/bills.service.js")) {
  const billsService = read("src/modules/bills/bills.service.js");
  if (!billsService.includes("INVALID_WAIVED_AMOUNT")) {
    errors.push("bills.service.js must contain INVALID_WAIVED_AMOUNT guard for waivedAmount > grandTotal (Phase 2 requirement)");
  }
}

// ── Check H: Phase 1 JWT security ────────────────────────────────────────────
if (exists("src/config/env.js")) {
  const envConfig = read("src/config/env.js");
  if (/JWT_EXPIRES_IN.*default\("7d"\)/.test(envConfig)) {
    errors.push("JWT_EXPIRES_IN default must NOT be 7d — access tokens must be short-lived (15m recommended)");
  }
}

// ── Check I: Phase 1 login cross-shop safety ──────────────────────────────────
if (exists("src/modules/auth/auth.service.js")) {
  const authService = read("src/modules/auth/auth.service.js");
  // Global mobile pre-check blocks valid multi-shop owners — must be removed
  if (/findFirst\(\s*\{\s*where:\s*\{\s*mobile\s*\}\s*\}\s*\)/.test(authService)) {
    errors.push("auth.service.js registerShop must not do a global mobile pre-check (Phase 1 fix: use per-shop uniqueness)");
  }
  // Login must handle multi-shop mobile safely
  if (!authService.includes("SHOP_SELECTION_REQUIRED")) {
    errors.push("auth.service.js login must handle multiple shops for same mobile with SHOP_SELECTION_REQUIRED (Phase 1 fix)");
  }
}

// ── Check J: Sync pull keyset indexes in Prisma schemas ──────────────────────
// These must be in both schemas so that prisma:generate picks them up.
// The migration must also contain them (covered by Check E above).
if (exists("prisma/schema.prisma") && exists("prisma-postgres/schema.prisma")) {
  const sqliteSchema = read("prisma/schema.prisma");
  const pgSchema     = read("prisma-postgres/schema.prisma");

  const syncIndexModels = ["Product", "Customer", "Bill", "StockLedger", "UdharLedger"];

  for (const model of syncIndexModels) {
    // Prisma schema must contain @@index([shopId, updatedAt, id]) inside the model block.
    // We check the raw schema text because parsePrismaModelFields only parses scalar fields.
    const modelBlock = new RegExp(`model ${model}\\s*\\{[^}]+\\}`, "s");

    const sqliteBlock = sqliteSchema.match(modelBlock)?.[0] ?? "";
    if (!sqliteBlock.includes("[shopId, updatedAt, id]")) {
      errors.push(
        `prisma/schema.prisma: ${model} is missing @@index([shopId, updatedAt, id]) for sync pull keyset pagination`
      );
    }

    const pgBlock = pgSchema.match(modelBlock)?.[0] ?? "";
    if (!pgBlock.includes("[shopId, updatedAt, id]")) {
      errors.push(
        `prisma-postgres/schema.prisma: ${model} is missing @@index([shopId, updatedAt, id]) for sync pull keyset pagination`
      );
    }
  }

  // OfflineSyncEvent idempotency unique index must remain
  if (!sqliteSchema.includes("@@unique([shopId, eventId])")) {
    errors.push("prisma/schema.prisma: OfflineSyncEvent must have @@unique([shopId, eventId])");
  }
  if (!pgSchema.includes("@@unique([shopId, eventId])")) {
    errors.push("prisma-postgres/schema.prisma: OfflineSyncEvent must have @@unique([shopId, eventId])");
  }

  // OfflineSyncEvent status index must remain
  if (!sqliteSchema.includes("@@index([shopId, status, createdAt])")) {
    errors.push("prisma/schema.prisma: OfflineSyncEvent must have @@index([shopId, status, createdAt])");
  }
  if (!pgSchema.includes("@@index([shopId, status, createdAt])")) {
    errors.push("prisma-postgres/schema.prisma: OfflineSyncEvent must have @@index([shopId, status, createdAt])");
  }
}


// ── Phase 5 DB-backed integration test infrastructure ───────────────────────
if (exists("package.json")) {
  const packageJson = readJson("package.json");
  const scripts = packageJson.scripts || {};
  if (!scripts["test:db"]?.includes("run-integration-tests")) {
    errors.push("package.json test:db must run the DB-backed integration test runner");
  }
  if (!scripts["test:integration"]?.includes("run-integration-tests")) {
    errors.push("package.json test:integration must run the DB-backed integration test runner");
  }
  if (!scripts["setup:test-db"]?.includes("setup-test-db")) {
    errors.push("package.json setup:test-db must prepare an isolated test SQLite database");
  }
  if (!scripts["test:billing"]?.includes("backend-regression.examples.js")) {
    errors.push("Existing static regression tests must remain wired in npm test");
  }
}

if (exists("scripts/test-db-utils.js")) {
  const testDbUtils = read("scripts/test-db-utils.js");
  for (const snippet of ["TEST_DATABASE_URL", "file:", "Refusing to run integration tests", "dev.db", "production"]) {
    if (!testDbUtils.includes(snippet)) errors.push(`scripts/test-db-utils.js missing test DB safety snippet: ${snippet}`);
  }
}

if (exists("tests/integration/setup.js")) {
  const integrationSetup = read("tests/integration/setup.js");
  for (const snippet of ["resetDatabase", "createIntegrationContext", "db.$connect", "Prisma query engine/runtime is unavailable"]) {
    if (!integrationSetup.includes(snippet)) errors.push(`tests/integration/setup.js missing integration setup helper: ${snippet}`);
  }
}

if (exists("tests/integration/factories.js")) {
  const factories = read("tests/integration/factories.js");
  for (const snippet of ["createTenant", "createStaff", "createProduct", "createCustomer", "billPayload", "bcrypt.hash"]) {
    if (!factories.includes(snippet)) errors.push(`tests/integration/factories.js missing factory/helper: ${snippet}`);
  }
}


// ── Phase 6 SaaS subscription/device/payment foundation ─────────────────────
if (exists("prisma/schema.prisma") && exists("prisma-postgres/schema.prisma")) {
  const sqliteSchema = read("prisma/schema.prisma");
  const pgSchema = read("prisma-postgres/schema.prisma");
  for (const model of ["Plan", "Subscription", "PaymentTransaction", "PaymentProviderEvent", "Device", "DeviceLicense"]) {
    if (!sqliteSchema.includes(`model ${model}`)) errors.push(`prisma/schema.prisma missing SaaS model: ${model}`);
    if (!pgSchema.includes(`model ${model}`)) errors.push(`prisma-postgres/schema.prisma missing SaaS model: ${model}`);
  }
}

if (exists("src/modules/subscription/planConfig.js")) {
  const planConfig = read("src/modules/subscription/planConfig.js");
  for (const snippet of ["starter", "standard", "growth", "pro", "29900", "39900", "49900", "69900", "staff_login", "whatsapp_reminders"]) {
    if (!planConfig.includes(snippet)) errors.push(`planConfig.js missing plan/feature snippet: ${snippet}`);
  }
}

if (exists("src/app.js")) {
  const appSource = read("src/app.js");
  for (const route of ['app.use("/api/plans"', 'app.use("/api/subscription"', 'app.use("/api/devices"', 'app.use("/api/payment-provider"']) {
    if (!appSource.includes(route)) errors.push(`src/app.js missing Phase 6 route registration: ${route}`);
  }
}

if (exists("src/modules/feature-gates/featureGate.service.js")) {
  const gates = read("src/modules/feature-gates/featureGate.service.js");
  for (const snippet of ["hasFeature", "getPlanLimits", "canUseDevice", "canAddStaff", "getReportRangeLimit", "view_old_data"]) {
    if (!gates.includes(snippet)) errors.push(`featureGate.service.js missing: ${snippet}`);
  }
}

if (exists("src/modules/devices/devices.service.js")) {
  const devices = read("src/modules/devices/devices.service.js");
  for (const snippet of ["DEVICE_LIMIT_EXCEEDED", "heartbeat", "getDeviceLicense", "signatureHash", "LICENSE_SIGNING_SECRET"]) {
    if (!devices.includes(snippet)) errors.push(`devices.service.js missing: ${snippet}`);
  }
}

if (exists("src/modules/payment-provider/paymentProvider.service.js")) {
  const payments = read("src/modules/payment-provider/paymentProvider.service.js");
  for (const snippet of [
    "storeProviderEvent",
    "provider_eventId",
    "sanitizePayload",
    "createSubscriptionCheckout",
    "verifySubscriptionPayment",
    "handleRazorpayWebhook",
    "activateSubscriptionAfterPayment",
    "PAYMENT_WEBHOOK_DUPLICATE",
    "INVALID_PAYMENT_SIGNATURE",
    "PAYMENT_FAILED",
  ]) {
    if (!payments.includes(snippet)) errors.push(`paymentProvider.service.js missing: ${snippet}`);
  }
}

if (exists("src/modules/payment-provider/razorpay.provider.js")) {
  const razorpay = read("src/modules/payment-provider/razorpay.provider.js");
  for (const snippet of ["verifyPaymentSignature", "verifyWebhookSignature", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "timingSafeEqual", "createRazorpayOrder"]) {
    if (!razorpay.includes(snippet)) errors.push(`razorpay.provider.js missing: ${snippet}`);
  }
}

if (exists("src/app.js")) {
  const appSource = read("src/app.js");
  if (!appSource.includes('express.raw({ type: "application/json"')) {
    errors.push("Razorpay webhook route must use express.raw before normal JSON parsing");
  }
}

if (exists("src/config/env.js")) {
  const envSource = read("src/config/env.js");
  if (!envSource.includes("LICENSE_SIGNING_SECRET is required in production")) {
    errors.push("env.js must require LICENSE_SIGNING_SECRET in production for secure device license signing");
  }
  if (!envSource.includes("RAZORPAY_ENABLED") || !envSource.includes("RAZORPAY_KEY_SECRET") || !envSource.includes("RAZORPAY_WEBHOOK_SECRET")) {
    errors.push("env.js must parse Razorpay config");
  }
  if (!envSource.includes("required in production when RAZORPAY_ENABLED=true")) {
    errors.push("env.js must require Razorpay secrets in production only when RAZORPAY_ENABLED=true");
  }
}

for (const secretPattern of [/rzp_live_[A-Za-z0-9]{8,}/, /RAZORPAY_KEY_SECRET\s*=\s*['"][^'"]+['"]/]) {
  const allSource = ["src", "tests", "scripts"].filter(exists).map((dir) => {
    try {
      return fs.readdirSync(dir, { recursive: true })
        .filter((file) => String(file).endsWith(".js"))
        .map((file) => read(path.join(dir, file)))
        .join("\n");
    } catch { return ""; }
  }).join("\n");
  if (secretPattern.test(allSource)) errors.push("Potential Razorpay secret/key committed in source");
}

for (const forbidden of ["custom upi gateway", "custom card gateway", "storeCard", "cardNumber", "upiPin"]) {
  const allSource = ["src/modules/payment-provider/paymentProvider.service.js", "src/modules/payment-provider/razorpay.provider.js"].filter(exists).map(read).join("\n").toLowerCase();
  if (allSource.includes(forbidden.toLowerCase())) {
    errors.push(`Forbidden custom payment/card/UPI gateway pattern detected: ${forbidden}`);
  }
}



// ── Phase 8 secure device license signing and device enforcement (HMAC SHA-256) ─────────────
if (exists("src/modules/devices/license.service.js")) {
  const licenseService = read("src/modules/devices/license.service.js");
  for (const snippet of [
    "buildLicensePayload",
    "signLicensePayload",
    "verifyLicenseSignature",
    "issueDeviceLicense",
    "revokeDeviceLicense",
    "refreshDeviceLicense",
    "getCurrentDeviceLicense",
    "HMAC-SHA256",
    "createHmac(\"sha256\"",
    "canonicalJson",
    "signatureHash",
    "subscriptionStatus",
    "offlineGraceUntil",
    "licenseVersion",
  ]) {
    if (!licenseService.includes(snippet)) errors.push(`license.service.js missing secure license snippet: ${snippet}`);
  }
  if (licenseService.includes("fake") || licenseService.includes("demo-signature")) {
    errors.push("license.service.js must not use fake/demo signatures");
  }
}

if (exists("src/modules/devices/device.middleware.js")) {
  const deviceMiddleware = read("src/modules/devices/device.middleware.js");
  for (const snippet of ["requireDeviceActivated", "requireDeviceAllowedForSync", "requireDeviceAllowedForPremiumAction", "DEVICE_REQUIRED", "DEVICE_REMOVED", "DEVICE_BLOCKED"]) {
    if (!deviceMiddleware.includes(snippet)) errors.push(`device.middleware.js missing enforcement snippet: ${snippet}`);
  }
}

if (exists("src/modules/sync/sync.routes.js")) {
  const syncRoutes = read("src/modules/sync/sync.routes.js");
  if (!syncRoutes.includes("requireDeviceAllowedForSync()")) {
    errors.push("sync routes must enforce active device + active/grace subscription for cloud sync");
  }
}

if (exists("src/modules/devices/devices.routes.js")) {
  const deviceRoutes = read("src/modules/devices/devices.routes.js");
  if (!deviceRoutes.includes("requireDeviceActivated()")) {
    errors.push("device license route must require an active device");
  }
  if (!deviceRoutes.includes("/:deviceId/block") || !deviceRoutes.includes("/:deviceId/unblock")) {
    warnings.push("Device block/unblock routes are not present");
  }
}

if (exists("src/modules/devices/devices.service.js")) {
  const devices = read("src/modules/devices/devices.service.js");
  for (const snippet of ["DEVICE_LIMIT_EXCEEDED", "idempotent: true", "revokeDeviceLicense", "DEVICE_ACTIVATED", "DEVICE_REMOVED"]) {
    if (!devices.includes(snippet)) errors.push(`devices.service.js missing Phase 8 snippet: ${snippet}`);
  }
}

if (exists("src/config/env.js")) {
  const envSource = read("src/config/env.js");
  if (!envSource.includes("LICENSE_SIGNING_SECRET is required in production")) {
    errors.push("LICENSE_SIGNING_SECRET must be required in production");
  }
}

if (exists("package.json")) {
  const packageJson = readJson("package.json");
  if (!packageJson.scripts?.["test:billing"]?.includes("phase8-device-license-security.examples.js")) {
    errors.push("Phase 8 device license security tests must be wired into npm test");
  }
}



// ── Phase 10 Redis + BullMQ background worker infrastructure ─────────────
for (const requiredFile of [
  "src/lib/redis.js",
  "src/lib/queue.js",
  "src/workers/index.js",
  "src/workers/queueNames.js",
  "src/workers/workerUtils.js",
  "src/workers/reminder.worker.js",
  "src/workers/reports.worker.js",
  "src/workers/exports.worker.js",
  "src/workers/backup.worker.js",
  "src/workers/syncCleanup.worker.js",
  "src/modules/jobs/jobs.routes.js",
]) {
  if (!exists(requiredFile)) errors.push(`Phase 10 required file missing: ${requiredFile}`);
}

if (exists("src/config/env.js")) {
  const envSource = read("src/config/env.js");
  for (const snippet of ["REDIS_URL", "QUEUES_ENABLED", "WORKER_CONCURRENCY", "JOB_RETENTION_DAYS", "REDIS_URL is required in production when QUEUES_ENABLED=true"]) {
    if (!envSource.includes(snippet)) errors.push(`env.js missing queue config: ${snippet}`);
  }
}

if (exists("src/lib/redis.js")) {
  const redisSource = read("src/lib/redis.js");
  for (const snippet of ["getRedisClient", "isRedisEnabled", "maskRedisUrl", "redis_error", "redis_disabled"]) {
    if (!redisSource.includes(snippet)) errors.push(`redis.js missing safe Redis behavior: ${snippet}`);
  }
  if (redisSource.includes("console.log(env.REDIS_URL)")) errors.push("redis.js must not log raw REDIS_URL");
}

if (exists("src/lib/queue.js")) {
  const queueSource = read("src/lib/queue.js");
  for (const snippet of ["addJob", "getQueueStatus", "isQueueEnabled", "closeQueues", "JOB_QUEUE_DISABLED", "attempts: 3", "backoff", "removeOnComplete", "removeOnFail"]) {
    if (!queueSource.includes(snippet)) errors.push(`queue.js missing queue service behavior: ${snippet}`);
  }
}

if (exists("src/workers/queueNames.js")) {
  const queueNames = read("src/workers/queueNames.js");
  for (const snippet of ["reminderQueue", "reportsQueue", "exportsQueue", "backupQueue", "syncCleanupQueue", "GENERATE_DAILY_CLOSING", "SEND_WHATSAPP_REMINDER", "CLEANUP_SYNC_EVENTS"]) {
    if (!queueNames.includes(snippet)) errors.push(`queueNames.js missing queue/job name: ${snippet}`);
  }
}

if (exists("src/workers/index.js")) {
  const workerIndex = read("src/workers/index.js");
  if (workerIndex.includes("from \"../app.js\"") || workerIndex.includes("from './app.js'") || workerIndex.includes("from \"../server.js\"")) {
    errors.push("worker entry must not import/start Express app or server");
  }
  for (const snippet of ["worker_startup", "SIGINT", "SIGTERM", "closeQueues", "closeRedis", "WORKER_CONCURRENCY"]) {
    if (!workerIndex.includes(snippet)) errors.push(`worker index missing graceful worker behavior: ${snippet}`);
  }
}

if (exists("src/workers/workerUtils.js")) {
  const workerUtils = read("src/workers/workerUtils.js");
  for (const snippet of ["job_start", "job_success", "job_failure", "sanitizeJobPayload", "[REDACTED]"]) {
    if (!workerUtils.includes(snippet)) errors.push(`workerUtils.js missing structured/sanitized logging: ${snippet}`);
  }
  for (const forbidden of ["ownerPin", "password", "token"]) {
    if (workerUtils.includes(`payload.${forbidden}`)) errors.push(`worker logs must not print ${forbidden}`);
  }
}

if (exists("src/workers/reports.worker.js") && !read("src/workers/reports.worker.js").includes("GENERATE_DAILY_CLOSING")) {
  errors.push("reports worker must register GENERATE_DAILY_CLOSING");
}
if (exists("src/workers/reminder.worker.js")) {
  const reminder = read("src/workers/reminder.worker.js");
  if (!reminder.includes("WHATSAPP_PROVIDER_NOT_CONFIGURED")) errors.push("reminder worker must not fake WhatsApp success without provider");
}
if (exists("src/workers/syncCleanup.worker.js")) {
  const cleanup = read("src/workers/syncCleanup.worker.js");
  for (const snippet of ["dryRun", "status: { in: [\"synced\", \"failed\"] }", "Never delete recent idempotency records", "unresolved conflicts"]) {
    if (!cleanup.includes(snippet)) errors.push(`sync cleanup worker missing conservative retention snippet: ${snippet}`);
  }
}

if (exists("src/app.js")) {
  const appSource = read("src/app.js");
  if (!appSource.includes("/api/jobs")) errors.push("job status route must be registered under /api/jobs");
}

if (exists("package.json")) {
  const packageJson = readJson("package.json");
  if (!packageJson.scripts?.worker?.includes("src/workers/index.js")) errors.push("package.json must include npm run worker script");
  if (!packageJson.scripts?.["test:billing"]?.includes("phase10-background-workers.examples.js")) errors.push("Phase 10 worker tests must be wired into npm test");
}

const financialFiles = [
  "src/modules/bills/bills.service.js",
  "src/modules/inventory/inventory.service.js",
  "src/modules/udhar/udhar.service.js",
  "src/modules/payment-provider/paymentProvider.service.js",
].filter(exists).map((file) => [file, read(file)]);
for (const [file, source] of financialFiles) {
  for (const forbiddenJob of ["CONFIRM_BILL", "CREATE_BILL", "DEDUCT_STOCK", "CREATE_PAYMENT", "UPDATE_CUSTOMER_BALANCE", "VERIFY_OWNER_PIN", "VERIFY_PAYMENT"]) {
    if (source.includes(`addJob(`) && source.includes(forbiddenJob)) {
      errors.push(`${file} must not enqueue core financial operation ${forbiddenJob}`);
    }
  }
}



// ── Phase 11 shopkeeper reports + daily closing ─────────────────────────────
for (const requiredFile of [
  "src/modules/reports/reports.service.js",
  "src/modules/reports/dailyClosingSnapshot.service.js",
  "src/modules/reports/reports.controller.js",
  "src/modules/reports/reports.routes.js",
  "src/modules/reports/reports.schema.js",
  "tests/phase11-shopkeeper-reports.examples.js",
  "tests/phase12-daily-closing-snapshots.examples.js",
  "src/lib/fileStorage.js",
  "src/modules/reports/reportExport.service.js",
  "tests/phase13-report-export-jobs.examples.js",
  ".github/workflows/backend-ci.yml",
  "docs/SCHEDULING.md",
  "docs/PRODUCTION_DEPLOYMENT.md",
  "src/lib/objectStorage.js",
  "src/lib/logger.js",
  "src/lib/metrics.js",
  "scripts/smoke-test.js",
  "scripts/verify-worker-runtime.js",
  "tests/phase14-production-ci-deployment.examples.js",
  "tests/phase15-observability-storage.examples.js",
  "tests/phase16-monitoring-provider-validation.examples.js",
  "tests/phase17-whatsapp-reminders.examples.js",
  "tests/phase18-production-hardening.examples.js",
  "tests/phase19-production-correctness.examples.js",
  "tests/phase20-financial-identity-hardening.examples.js",
  "tests/phase21-auth-production-proof.examples.js",
  "prisma-postgres/migrations/000008_payment_webhook_processing_state/migration.sql",
  "tests/phase22-payment-webhook-ops.examples.js",
  "src/modules/reminders/reminders.routes.js",
  "src/modules/reminders/reminders.controller.js",
  "src/modules/reminders/reminders.service.js",
  "src/modules/reminders/reminders.schemas.js",
  "src/modules/reminders/reminderTemplates.service.js",
  "src/modules/reminders/whatsapp.provider.js",
  "src/modules/reminders/reminderFormatter.js",
  "scripts/verify-object-storage.js",
  "scripts/verify-export-flow.js",
  "scripts/production-preflight.js",
  "docs/ALERTING_RUNBOOK.md",
  "docs/PAYMENT_WEBHOOK_OPERATIONS.md",
  "src/lib/errorTracking.js",
]) {
  if (!exists(requiredFile)) errors.push(`Phase 11 required report file missing: ${requiredFile}`);
}

if (exists("src/modules/reports/reports.routes.js")) {
  const reportRoutes = read("src/modules/reports/reports.routes.js");
  for (const route of ["daily-closing", "sales-summary", "payment-modes", "udhar-ageing", "top-products", "inventory-health", "staff-sales"]) {
    if (!reportRoutes.includes(route)) errors.push(`reports.routes.js missing Phase 11 route: ${route}`);
  }
  if (!reportRoutes.includes('requireRole("owner", "admin")')) {
    errors.push("staff-sales must be owner/admin protected until Bill stores cashier attribution");
  }
  if (!reportRoutes.includes('router.get("/pnl", requireRole("owner")')) {
    errors.push("P&L report route must remain owner-only");
  }
  if (!reportRoutes.includes("requireOwnerPin")) {
    errors.push("Report export routes must still require owner PIN");
  }
}

if (exists("src/modules/reports/reports.service.js")) {
  const reports = read("src/modules/reports/reports.service.js");
  for (const fn of ["getDailyClosing", "getSalesSummary", "getPaymentModeReport", "getUdharAgeing", "getInventoryHealth", "getStaffSales", "generateDailyClosingSnapshot"]) {
    if (!reports.includes(`export async function ${fn}`)) errors.push(`reports.service.js missing Phase 11 function: ${fn}`);
  }
  for (const field of ["totalSalesPaise", "cashReceivedPaise", "upiReceivedPaise", "udharGivenPaise", "oldUdharRecoveredPaise", "expectedCashPaise", "pendingSyncCount"]) {
    if (!reports.includes(field)) errors.push(`daily-closing report missing field: ${field}`);
  }
  if (!reports.includes('billType: { not: "estimate" }')) {
    errors.push("Reports must exclude estimate/rough bills from real sales totals");
  }
  if (!reports.includes('status: "cancelled"')) {
    errors.push("Reports must count cancelled bills separately");
  }
  if (!reports.includes("offlineSyncEvent.count")) {
    errors.push("Daily closing must include pending sync count from OfflineSyncEvent");
  }
  if (!reports.includes("getReportRangeLimit") || !reports.includes("REPORT_RANGE_LIMIT_EXCEEDED")) {
    errors.push("Report range limit must respect subscription feature gates");
  }
  for (const field of ["averageBillValuePaise", "cashSalesPaise", "upiSalesPaise", "udharSalesPaise", "partialSalesPaise", "cancelledSalesPaise", "dailyBreakdown"]) {
    if (!reports.includes(field)) errors.push(`sales-summary report missing field: ${field}`);
  }
  for (const field of ["cashPaise", "upiPaise", "creditUdharPaise", "mixedPayments", "oldUdharRecoveredPaise"]) {
    if (!reports.includes(field)) errors.push(`payment-modes report missing field: ${field}`);
  }
  for (const bucket of ["0_7_days", "8_30_days", "31_60_days", "60_plus_days"]) {
    if (!reports.includes(bucket)) errors.push(`udhar-ageing missing bucket: ${bucket}`);
  }
  if (!reports.includes("maskPhone")) errors.push("Udhar ageing must mask customer phone numbers");
  if (!reports.includes("MAX_TOP_LIMIT")) errors.push("Top products report must cap result size");
  for (const field of ["lowStockThreshold", "negativeStock", "deadStock", "fastMoving", "slowMoving"]) {
    if (!reports.includes(field)) errors.push(`inventory-health report missing: ${field}`);
  }
  if (!reports.includes("createdByUserId") || !reports.includes("Unknown / Legacy")) {
    errors.push("staff-sales must use Bill.createdByUserId and include an Unknown/Legacy bucket for nullable old bills");
  }
}

if (exists("src/workers/reports.worker.js")) {
  const reportsWorker = read("src/workers/reports.worker.js");
  if (!reportsWorker.includes("generateDailyClosingSnapshot")) {
    errors.push("Phase 10 daily closing worker must call Phase 11 generateDailyClosingSnapshot");
  }
}

if (exists("package.json")) {
  const packageJson = readJson("package.json");
  if (!packageJson.scripts?.["test:billing"]?.includes("phase11-shopkeeper-reports.examples.js")) {
    errors.push("Phase 11 shopkeeper reports tests must be wired into npm test");
  }
}


// ── Phase 12 cashier attribution + DailyClosingSnapshot persistence ─────────
if (exists("prisma/schema.prisma") && exists("prisma-postgres/schema.prisma")) {
  const sqliteSchema = read("prisma/schema.prisma");
  const pgSchema = read("prisma-postgres/schema.prisma");
  for (const schemaText of [sqliteSchema, pgSchema]) {
    if (!schemaText.includes("createdByUserId")) errors.push("Bill must have nullable createdByUserId cashier attribution");
    if (!schemaText.includes("model DailyClosingSnapshot")) errors.push("DailyClosingSnapshot model must exist");
    if (!schemaText.includes("@@unique([shopId, date])")) errors.push("DailyClosingSnapshot must have unique shop/date constraint");
    if (!schemaText.includes("@@index([shopId, createdByUserId, createdAt])")) errors.push("Bill must have shopId + createdByUserId + createdAt index");
  }
}

if (exists("src/modules/bills/bills.controller.js") && exists("src/modules/bills/bills.service.js")) {
  const billController = read("src/modules/bills/bills.controller.js");
  const billService = read("src/modules/bills/bills.service.js");
  if (!billController.includes("req.user?.userId") || !billService.includes("createdByUserId = actor?.userId")) {
    errors.push("confirmBill must set createdByUserId from authenticated server context");
  }
  if (billService.includes("body.createdByUserId")) {
    errors.push("confirmBill must not trust frontend-provided createdByUserId");
  }
}

if (exists("src/modules/sync/sync.service.js")) {
  const syncService = read("src/modules/sync/sync.service.js");
  if (!syncService.includes("applyCreateBill(shopId, event, user)") || !syncService.includes("user?.userId")) {
    errors.push("sync CREATE_BILL must attribute createdByUserId from authenticated sync user");
  }
  if (syncService.includes("payload.createdByUserId")) {
    errors.push("sync CREATE_BILL must not trust frontend-created user id");
  }
}

if (exists("src/modules/reports/dailyClosingSnapshot.service.js")) {
  const snapshotService = read("src/modules/reports/dailyClosingSnapshot.service.js");
  for (const snippet of ["generateDailyClosingSnapshot", "getDailyClosingSnapshot", "refreshDailyClosingSnapshot", "lockDailyClosingSnapshot", "upsert", "shopId_date", "SNAPSHOT_LOCKED", "lockedAt"]) {
    if (!snapshotService.includes(snippet)) errors.push(`dailyClosingSnapshot.service.js missing Phase 12 snippet: ${snippet}`);
  }
}

if (exists("src/modules/reports/reports.routes.js")) {
  const reportRoutes = read("src/modules/reports/reports.routes.js");
  for (const snippet of ["/daily-closing/snapshot", "/daily-closing/:date/lock", 'requireRole("owner", "admin")']) {
    if (!reportRoutes.includes(snippet)) errors.push(`reports.routes.js missing Phase 12 snapshot route/protection: ${snippet}`);
  }
}

if (exists("src/workers/reports.worker.js")) {
  const reportsWorker = read("src/workers/reports.worker.js");
  if (!reportsWorker.includes("dailyClosingSnapshot.service.js") || !reportsWorker.includes('source: "worker"')) {
    errors.push("reports worker must call persisted snapshot service with source=worker");
  }
  if (reportsWorker.includes("confirmBill") || reportsWorker.includes("payment") || reportsWorker.includes("stock mutation")) {
    errors.push("reports worker must not perform billing/payment/stock mutation");
  }
}

if (exists("src/modules/reports/reports.controller.js")) {
  const reportController = read("src/modules/reports/reports.controller.js");
  for (const action of ["DAILY_CLOSING_SNAPSHOT_CREATED", "DAILY_CLOSING_SNAPSHOT_REFRESHED", "DAILY_CLOSING_SNAPSHOT_LOCKED"]) {
    if (!reportController.includes(action)) errors.push(`Missing Phase 12 audit action: ${action}`);
  }
}

if (exists("package.json")) {
  const packageJson = readJson("package.json");
  if (!packageJson.scripts?.["test:billing"]?.includes("phase12-daily-closing-snapshots.examples.js")) {
    errors.push("Phase 12 daily closing snapshot tests must be wired into npm test");
  }
}



// ── Phase 13 report export jobs + scheduled daily closing ────────────────
if (exists("prisma/schema.prisma") && exists("prisma-postgres/schema.prisma")) {
  const sqliteSchema = read("prisma/schema.prisma");
  const pgSchema = read("prisma-postgres/schema.prisma");
  for (const schemaText of [sqliteSchema, pgSchema]) {
    if (!schemaText.includes("model ReportExportJob")) errors.push("ReportExportJob model must exist");
    for (const field of ["reportType", "status", "paramsJson", "fileName", "filePath", "fileUrl", "expiresAt"]) {
      if (!schemaText.includes(field)) errors.push(`ReportExportJob missing field: ${field}`);
    }
    for (const index of ["@@index([shopId, status, createdAt])", "@@index([shopId, reportType, createdAt])", "@@index([requestedByUserId, createdAt])", "@@index([expiresAt])"]) {
      if (!schemaText.includes(index)) errors.push(`ReportExportJob missing index: ${index}`);
    }
  }
}

if (exists("src/modules/reports/reportExport.service.js")) {
  const exportService = read("src/modules/reports/reportExport.service.js");
  for (const snippet of ["createReportExportJob", "getReportExportJob", "listReportExportJobs", "markReportExportProcessing", "markReportExportCompleted", "markReportExportFailed", "cancelReportExportJob", "processReportExportJob", "sanitizeExportParams", "REPORT_EXPORT_JOB_CREATED"]) {
    if (!exportService.includes(snippet)) errors.push(`reportExport.service.js missing Phase 13 snippet: ${snippet}`);
  }
  for (const forbidden of ["ownerPin", "password", "token", "secret"]) {
    if (exportService.includes(`params.${forbidden}`)) errors.push(`reportExport.service.js must not store sensitive param: ${forbidden}`);
  }
}

if (exists("src/modules/reports/reports.routes.js")) {
  const reportRoutes = read("src/modules/reports/reports.routes.js");
  for (const route of ["/exports", "/exports/:jobId", "/exports/:jobId/download", "/exports/:jobId/cancel", "/daily-closing/:date/override-refresh"]) {
    if (!reportRoutes.includes(route)) errors.push(`reports.routes.js missing Phase 13 route: ${route}`);
  }
  if (!reportRoutes.match(/router\.post\("\/exports",\s*requireRole\("owner", "admin"\),\s*requireOwnerPin/)) {
    errors.push("POST /api/reports/exports must require owner/admin and owner PIN");
  }
  if (!reportRoutes.includes("overrideDailyClosingSnapshotSchema") || !reportRoutes.includes("requireOwnerPin")) {
    errors.push("locked snapshot override must require reason validation and owner PIN/current sensitive-action gate");
  }
}

if (exists("src/workers/exports.worker.js")) {
  const exportsWorker = read("src/workers/exports.worker.js");
  for (const snippet of ["GENERATE_REPORT_EXPORT", "processReportExportJob", "exportJobId"]) {
    if (!exportsWorker.includes(snippet)) errors.push(`exports.worker.js missing Phase 13 snippet: ${snippet}`);
  }
  if (exportsWorker.includes("console.log(report") || exportsWorker.includes("console.log(csv")) {
    errors.push("exports.worker.js must not log report contents");
  }
}

if (exists("src/lib/fileStorage.js")) {
  const fileStorage = read("src/lib/fileStorage.js");
  for (const snippet of ["buildExportFilePath", "PATH_TRAVERSAL_BLOCKED", "path.resolve", "storage", "exports", "writeExportFile", "readExportFile", "validateReportType"]) {
    if (!fileStorage.includes(snippet)) errors.push(`fileStorage.js missing safe file storage snippet: ${snippet}`);
  }
}

if (exists("scripts/run-daily-closing.js")) {
  const dailyClosingRun = read("scripts/run-daily-closing.js");
  for (const snippet of ["GENERATE_DAILY_CLOSING", "DAILY_CLOSING_SCHEDULED", "generateDailyClosingSnapshot", "isQueueEnabled", "Asia/Kolkata"]) {
    if (!dailyClosingRun.includes(snippet)) errors.push(`run-daily-closing.js missing scheduled snapshot snippet: ${snippet}`);
  }
}

if (exists("src/modules/reports/dailyClosingSnapshot.service.js")) {
  const snapshotService = read("src/modules/reports/dailyClosingSnapshot.service.js");
  for (const snippet of ["getSnapshotStaleness", "Records changed after snapshot generation", "overrideRefreshDailyClosingSnapshot", "allowLockedOverride", "SNAPSHOT_OVERRIDE_REASON_REQUIRED", "previousLockedAt"]) {
    if (!snapshotService.includes(snippet)) errors.push(`dailyClosingSnapshot.service.js missing Phase 13 snippet: ${snippet}`);
  }
}

if (exists("src/modules/reports/reports.controller.js")) {
  const reportController = read("src/modules/reports/reports.controller.js");
  for (const action of ["REPORT_EXPORT_JOB_CANCELLED", "DAILY_CLOSING_SNAPSHOT_OVERRIDE_REFRESHED"]) {
    if (!reportController.includes(action) && !(action === "REPORT_EXPORT_JOB_CANCELLED" && exists("src/modules/reports/reportExport.service.js") && read("src/modules/reports/reportExport.service.js").includes(action))) {
      errors.push(`Missing Phase 13 audit action: ${action}`);
    }
  }
  for (const fn of ["createReportExportJob", "listReportExportJobs", "getReportExportJob", "cancelReportExportJob", "downloadReportExportJob", "overrideRefreshDailyClosingSnapshot"]) {
    if (!reportController.includes(`export async function ${fn}`)) errors.push(`reports.controller.js missing Phase 13 handler: ${fn}`);
  }
}

if (exists("package.json")) {
  const packageJson = readJson("package.json");
  if (!packageJson.scripts?.["daily-closing:run"]?.includes("scripts/run-daily-closing.js")) errors.push("package.json must include npm run daily-closing:run");
  if (!packageJson.scripts?.["test:billing"]?.includes("phase13-report-export-jobs.examples.js")) {
    errors.push("Phase 13 report export tests must be wired into npm test");
  }
}



// ── Phase 14 production CI + deployment reliability ───────────────────────
for (const requiredFile of [
  ".github/workflows/backend-ci.yml",
  "docs/SCHEDULING.md",
  "docs/PRODUCTION_DEPLOYMENT.md",
  "src/lib/objectStorage.js",
  "src/lib/logger.js",
  "src/lib/metrics.js",
  "scripts/smoke-test.js",
  "scripts/verify-worker-runtime.js",
  "tests/phase14-production-ci-deployment.examples.js",
  "tests/phase15-observability-storage.examples.js",
  "tests/phase16-monitoring-provider-validation.examples.js",
  "tests/phase17-whatsapp-reminders.examples.js",
  "tests/phase18-production-hardening.examples.js",
  "tests/phase19-production-correctness.examples.js",
  "tests/phase20-financial-identity-hardening.examples.js",
  "tests/phase21-auth-production-proof.examples.js",
  "prisma-postgres/migrations/000008_payment_webhook_processing_state/migration.sql",
  "tests/phase22-payment-webhook-ops.examples.js",
  "src/modules/reminders/reminders.routes.js",
  "src/modules/reminders/reminders.controller.js",
  "src/modules/reminders/reminders.service.js",
  "src/modules/reminders/reminders.schemas.js",
  "src/modules/reminders/reminderTemplates.service.js",
  "src/modules/reminders/whatsapp.provider.js",
  "src/modules/reminders/reminderFormatter.js",
  "scripts/verify-object-storage.js",
  "scripts/verify-export-flow.js",
  "scripts/production-preflight.js",
  "docs/ALERTING_RUNBOOK.md",
  "docs/PAYMENT_WEBHOOK_OPERATIONS.md",
  "src/lib/errorTracking.js",
]) {
  if (!exists(requiredFile)) errors.push(`Phase 14 required file missing: ${requiredFile}`);
}

if (exists(".github/workflows/backend-ci.yml")) {
  const ci = read(".github/workflows/backend-ci.yml");
  for (const snippet of ["postgres:", "redis:", "node-version: 20", "npm ci", "npm run prisma:generate", "npm run prisma:generate:postgres", "npx prisma validate", "npm run prisma:deploy:postgres", "npm run test:db", "npm run prod:check", "docker build ."]) {
    if (!ci.includes(snippet)) errors.push(`CI workflow missing required step/service: ${snippet}`);
  }
  if (ci.includes("RAZORPAY_KEY_SECRET: rz") || ci.includes("LICENSE_SIGNING_SECRET: prod")) {
    errors.push("CI workflow must not contain production secrets");
  }
}

if (exists("Dockerfile")) {
  const dockerfile = read("Dockerfile");
  for (const snippet of ["npm ci", "npm run prisma:generate:postgres", "/health/ready", "npm run prisma:deploy:postgres", "npm start"]) {
    if (!dockerfile.includes(snippet)) errors.push(`Dockerfile missing production reliability snippet: ${snippet}`);
  }
  if (dockerfile.includes("JWT_SECRET=") || dockerfile.includes("RAZORPAY_KEY_" + "SECRET=")) {
    errors.push("Dockerfile must not bake secrets into the image");
  }
}

if (exists("docker-compose.yml")) {
  const compose = read("docker-compose.yml");
  for (const snippet of ["api:", "worker:", "postgres:", "redis:", "npm", "worker", "/health/ready"]) {
    if (!compose.includes(snippet)) errors.push(`docker-compose.yml missing service/config: ${snippet}`);
  }
}

if (exists("src/lib/objectStorage.js")) {
  const objectStorage = read("src/lib/objectStorage.js");
  for (const snippet of ["STORAGE_PROVIDER", "local", "s3", "r2", "minio", "PATH_TRAVERSAL_BLOCKED", "LOCAL_STORAGE_NOT_PUBLIC_PRODUCTION_SAFE", "OBJECT_STORAGE_PROVIDER_NOT_IMPLEMENTED", "[REDACTED]"]) {
    if (!objectStorage.includes(snippet)) errors.push(`objectStorage.js missing storage safety snippet: ${snippet}`);
  }
  if (objectStorage.includes("console.log(env.STORAGE_SECRET_ACCESS_KEY)")) errors.push("objectStorage.js must not log storage secrets");
}

if (exists("src/lib/fileStorage.js")) {
  const fileStorage = read("src/lib/fileStorage.js");
  for (const snippet of ["putObject", "getObject", "deleteObject", "buildExportStorageKey", "PATH_TRAVERSAL_BLOCKED"]) {
    if (!fileStorage.includes(snippet)) errors.push(`fileStorage.js missing object storage integration snippet: ${snippet}`);
  }
}

if (exists("src/workers/queueNames.js")) {
  const queueNames = read("src/workers/queueNames.js");
  for (const snippet of ["CLEANUP_EXPIRED_EXPORTS", "WORKER_HEALTHCHECK"]) {
    if (!queueNames.includes(snippet)) errors.push(`queueNames.js missing Phase 14 job: ${snippet}`);
  }
}

if (exists("src/workers/exports.worker.js")) {
  const exportsWorker = read("src/workers/exports.worker.js");
  for (const snippet of ["CLEANUP_EXPIRED_EXPORTS", "cleanupExpiredReportExports", "does not delete ReportExportJob records", "never touches POS financial records"]) {
    if (!exportsWorker.includes(snippet)) errors.push(`exports.worker.js missing export cleanup snippet: ${snippet}`);
  }
}

if (exists("src/modules/reports/reportExport.service.js")) {
  const exportService = read("src/modules/reports/reportExport.service.js");
  for (const snippet of ["cleanupExpiredReportExports", "expiresAt", "deleteExportFile", "REPORT_EXPORT_JOB_EXPIRED_CLEANED"]) {
    if (!exportService.includes(snippet)) errors.push(`reportExport.service.js missing export cleanup behavior: ${snippet}`);
  }
}

if (exists("scripts/verify-worker-runtime.js")) {
  const verifyWorker = read("scripts/verify-worker-runtime.js");
  for (const snippet of ["WORKER_HEALTHCHECK", "QueueEvents", "Worker", "worker_verify_success", "worker_verify_skipped"]) {
    if (!verifyWorker.includes(snippet)) errors.push(`verify-worker-runtime.js missing Redis worker verification snippet: ${snippet}`);
  }
  if (verifyWorker.includes("ownerPin") || verifyWorker.includes("password")) errors.push("worker verification script must not enqueue sensitive payload fields");
}

if (exists("docs/SCHEDULING.md")) {
  const scheduling = read("docs/SCHEDULING.md");
  for (const snippet of ["2 AM Asia/Kolkata", "npm run daily-closing:run", "cron", "PM2", "Render", "Railway", "GitHub Actions", "systemd", "does not overwrite locked snapshots"]) {
    if (!scheduling.includes(snippet)) errors.push(`docs/SCHEDULING.md missing scheduling guidance: ${snippet}`);
  }
}

if (exists("docs/PRODUCTION_DEPLOYMENT.md")) {
  const deployDocs = read("docs/PRODUCTION_DEPLOYMENT.md");
  for (const snippet of ["Environment variables", "PostgreSQL", "Prisma", "Redis", "npm run worker", "daily-closing", "Export storage", "Health checks", "Backup", "Prisma binary missing", "migration drift", "Redis down", "worker not running"]) {
    if (!deployDocs.includes(snippet)) errors.push(`docs/PRODUCTION_DEPLOYMENT.md missing deployment guidance: ${snippet}`);
  }
}

if (exists("src/config/env.js")) {
  const envSource = read("src/config/env.js");
  for (const snippet of ["STORAGE_PROVIDER", "EXPORT_DOWNLOADS_PUBLIC", "STORAGE_PROVIDER=local is not production-safe", "STORAGE_BUCKET", "STORAGE_SECRET_ACCESS_KEY"]) {
    if (!envSource.includes(snippet)) errors.push(`env.js missing Phase 14 storage validation: ${snippet}`);
  }
}

if (exists("package.json")) {
  const packageJson = readJson("package.json");
  if (!packageJson.scripts?.["worker:verify"]) errors.push("package.json missing worker:verify script");
  if (!packageJson.scripts?.["docker:build"]) errors.push("package.json missing docker:build script");
  if (!packageJson.scripts?.["test:billing"]?.includes("phase14-production-ci-deployment.examples.js")) {
    errors.push("Phase 14 production CI/deployment tests must be wired into npm test");
  }
}


// Phase 15: object storage, observability, metrics, smoke tests, and queue monitoring.
if (exists("src/lib/objectStorage.js")) {
  const objectStorage = read("src/lib/objectStorage.js");
  for (const snippet of ["S3Client", "PutObjectCommand", "GetObjectCommand", "DeleteObjectCommand", "getSignedUrl", "EXPORT_SIGNED_URL_TTL_SECONDS", "STORAGE_FORCE_PATH_STYLE", "checkStorageHealth", "do not fake", "OBJECT_STORAGE_CONFIG_MISSING"]) {
    if (!objectStorage.includes(snippet)) errors.push(`objectStorage.js missing Phase 15 cloud storage snippet: ${snippet}`);
  }
  if (objectStorage.includes("FAKE_CLOUD_UPLOAD_SUCCESS")) {
    errors.push("objectStorage.js must not fake cloud upload success");
  }
}

if (exists("src/lib/fileStorage.js")) {
  const fileStorage = read("src/lib/fileStorage.js");
  for (const snippet of ["getSignedDownloadUrl", "streamExportFile", "exports/${safeShopId}/${safeJobId}.csv", "EXPORT_DOWNLOADS_PUBLIC", "fileKey"]) {
    if (!fileStorage.includes(snippet)) errors.push(`fileStorage.js missing Phase 15 signed/protected download snippet: ${snippet}`);
  }
}

if (exists("src/modules/jobs/jobs.routes.js")) {
  const jobsRoutes = read("src/modules/jobs/jobs.routes.js");
  for (const snippet of ["/status", "/failed", "/:queueName/:jobId/retry", "/:queueName/:jobId/discard", `requireRole("owner", "admin")`]) {
    if (!jobsRoutes.includes(snippet)) errors.push(`jobs.routes.js missing Phase 15 queue monitoring route: ${snippet}`);
  }
}

if (exists("src/lib/logger.js")) {
  const logger = read("src/lib/logger.js");
  for (const snippet of ["redactSensitive", "password", "ownerPin", "JWT", "secret", "[REDACTED]"]) {
    if (!logger.includes(snippet)) errors.push(`logger.js missing redaction snippet: ${snippet}`);
  }
}

if (exists("src/lib/metrics.js")) {
  const metrics = read("src/lib/metrics.js");
  for (const snippet of ["http_requests_total", "http_request_duration_ms", "http_errors_total", "sync_push_total", "sync_pull_total", "report_export_jobs_total", "worker_jobs_processed_total", "storage_errors_total"]) {
    if (!metrics.includes(snippet)) errors.push(`metrics.js missing metric foundation: ${snippet}`);
  }
  if (metrics.includes("shopId") && !metrics.includes("exclude shopId")) warnings.push("metrics.js references shopId; verify it is not used as a label");
}

if (exists("src/app.js")) {
  const appSource = read("src/app.js");
  for (const snippet of ["/api/health/metrics", "/metrics", "checkStorageHealth", "getRedisClient", "checks.storage", "checks.redis"]) {
    if (!appSource.includes(snippet)) errors.push(`app.js missing Phase 15 health/metrics snippet: ${snippet}`);
  }
}

if (exists(".github/workflows/backend-ci.yml")) {
  const ci = read(".github/workflows/backend-ci.yml");
  for (const snippet of ["actions/upload-artifact", "npm-test.log", "prod-check.log"]) {
    if (!ci.includes(snippet)) errors.push(`CI workflow missing Phase 15 artifact/log preservation: ${snippet}`);
  }
}

if (exists("docs/PRODUCTION_DEPLOYMENT.md")) {
  const docs = read("docs/PRODUCTION_DEPLOYMENT.md");
  for (const snippet of ["Cloudflare R2", "MinIO", "signed URL", "Smoke test", "Alert checklist", "GET /api/health/metrics", "GET /api/jobs/failed"]) {
    if (!docs.includes(snippet)) errors.push(`production docs missing Phase 15 guidance: ${snippet}`);
  }
}

if (exists("package.json")) {
  const packageJson = readJson("package.json");
  if (!packageJson.scripts?.["smoke:test"]) errors.push("package.json missing smoke:test script");
  if (!packageJson.dependencies?.["@aws-sdk/client-s3"] || !packageJson.dependencies?.["@aws-sdk/s3-request-presigner"]) {
    errors.push("package.json missing AWS S3-compatible object storage dependencies");
  }
  if (!packageJson.scripts?.["test:billing"]?.includes("phase15-observability-storage.examples.js")) {
    errors.push("Phase 15 observability/storage tests must be wired into npm test");
  }
}



// Phase 16: monitoring dashboard + real provider validation.
if (exists("scripts/verify-object-storage.js")) {
  const source = read("scripts/verify-object-storage.js");
  for (const snippet of ["storage-healthcheck", "putObject", "getObject", "getSignedDownloadUrl", "deleteObject", "ALLOW_PRODUCTION_STORAGE_VERIFY", "redactSensitive"]) {
    if (!source.includes(snippet)) errors.push(`verify-object-storage.js missing provider validation snippet: ${snippet}`);
  }
  if (/console\.(log|error)\(.*STORAGE_SECRET_ACCESS_KEY/.test(source)) errors.push("verify-object-storage.js must not log storage secrets");
}

if (exists("scripts/verify-export-flow.js")) {
  const source = read("scripts/verify-export-flow.js");
  for (const snippet of ["ALLOW_PRODUCTION_EXPORT_VERIFY", "EXPORT_VERIFY_SHOP_ID", "createReportExportJob", "processReportExportJob", "readExportFile", "deleteExportFile"]) {
    if (!source.includes(snippet)) errors.push(`verify-export-flow.js missing export validation snippet: ${snippet}`);
  }
}

if (exists("src/modules/jobs/jobs.routes.js")) {
  const routes = read("src/modules/jobs/jobs.routes.js");
  for (const snippet of ["/queues/:queueName", "/queues/:queueName/failed", "/queues/:queueName/pause", "/queues/:queueName/resume", "requireRole(\"owner\", \"admin\")"]) {
    if (!routes.includes(snippet)) errors.push(`jobs.routes.js missing Phase 16 queue admin route: ${snippet}`);
  }
}

if (exists("src/modules/jobs/jobs.controller.js")) {
  const controller = read("src/modules/jobs/jobs.controller.js");
  for (const snippet of ["payloadsExposed: false", "QUEUE_ALIASES", "queueDetail", "queueFailed", "pauseQueue", "resumeQueue"]) {
    if (!controller.includes(snippet)) errors.push(`jobs.controller.js missing Phase 16 safe queue admin behavior: ${snippet}`);
  }
}

if (exists("src/lib/metrics.js")) {
  const metrics = read("src/lib/metrics.js");
  for (const snippet of ["renderPrometheusMetrics", "queue_jobs_waiting", "queue_jobs_failed", "db_ready_status", "redis_ready_status", "storage_ready_status", "FORBIDDEN_LABELS", "shopId", "userId", "deviceId"]) {
    if (!metrics.includes(snippet)) errors.push(`metrics.js missing Phase 16 metrics snippet: ${snippet}`);
  }
}

if (exists("src/app.js")) {
  const appSource = read("src/app.js");
  for (const snippet of ["requireMetricsAccess", "METRICS_REQUIRE_TOKEN", "renderPrometheusMetrics", "recordReadinessStatus", "errorTracking"]) {
    if (!appSource.includes(snippet)) errors.push(`app.js missing Phase 16 metrics/readiness snippet: ${snippet}`);
  }
}

if (exists("src/lib/errorTracking.js")) {
  const source = read("src/lib/errorTracking.js");
  for (const snippet of ["ERROR_TRACKING_ENABLED", "SENTRY_DSN", "captureException", "captureRequestError", "captureWorkerError", "redactSensitive"]) {
    if (!source.includes(snippet)) errors.push(`errorTracking.js missing adapter snippet: ${snippet}`);
  }
}

if (exists("scripts/smoke-test.js")) {
  const source = read("scripts/smoke-test.js");
  for (const snippet of ["ALLOW_PRODUCTION_SMOKE", "SMOKE_METRICS_EXPECTED", "SMOKE_EXPECT_REDIS", "SMOKE_EXPECT_STORAGE", "assertNoSecrets"]) {
    if (!source.includes(snippet)) errors.push(`smoke-test.js missing Phase 16 smoke safety snippet: ${snippet}`);
  }
}

if (exists("docs/ALERTING_RUNBOOK.md")) {
  const runbook = read("docs/ALERTING_RUNBOOK.md");
  for (const snippet of ["API down", "DB not ready", "Redis down", "Worker not processing", "Export jobs failing", "Storage upload", "Daily closing", "High 5xx", "Razorpay webhook", "Device license"]) {
    if (!runbook.includes(snippet)) errors.push(`ALERTING_RUNBOOK.md missing alert runbook section: ${snippet}`);
  }
}

if (exists("docs/PRODUCTION_DEPLOYMENT.md")) {
  const docs = read("docs/PRODUCTION_DEPLOYMENT.md");
  for (const snippet of ["npm run storage:verify", "npm run export:verify", "Sentry", "Better Stack", "UptimeRobot", "Grafana", "ALLOW_PRODUCTION_SMOKE", "ALERTING_RUNBOOK.md"]) {
    if (!docs.includes(snippet)) errors.push(`production docs missing Phase 16 provider/monitoring guidance: ${snippet}`);
  }
}

if (exists(".github/workflows/backend-ci.yml")) {
  const ci = read(".github/workflows/backend-ci.yml");
  if (!ci.includes("npm run storage:verify")) errors.push("CI should verify local object storage adapter");
  if (!ci.includes("actions/upload-artifact")) errors.push("CI should preserve useful logs/artifacts");
}

if (exists("package.json")) {
  const packageJson = readJson("package.json");
  if (!packageJson.scripts?.["storage:verify"]) errors.push("package.json missing storage:verify script");
  if (!packageJson.scripts?.["export:verify"]) errors.push("package.json missing export:verify script");
  if (!packageJson.scripts?.["test:billing"]?.includes("phase16-monitoring-provider-validation.examples.js")) {
    errors.push("Phase 16 monitoring/provider validation tests must be wired into npm test");
  }
}


// Phase 17: WhatsApp udhar reminder backend foundation.
if (exists("prisma/schema.prisma") && exists("prisma-postgres/schema.prisma")) {
  const sqliteSchema = read("prisma/schema.prisma");
  const pgSchema = read("prisma-postgres/schema.prisma");
  for (const model of ["ReminderTemplate", "ReminderLog"]) {
    if (!sqliteSchema.includes(`model ${model}`)) errors.push(`prisma/schema.prisma missing reminder model: ${model}`);
    if (!pgSchema.includes(`model ${model}`)) errors.push(`prisma-postgres/schema.prisma missing reminder model: ${model}`);
  }
  for (const snippet of ["@@index([shopId, active])", "@@index([shopId, customerId, createdAt])", "@@index([shopId, status, createdAt])", "@@index([shopId, channel, createdAt])"]) {
    if (!sqliteSchema.includes(snippet) || !pgSchema.includes(snippet)) errors.push(`Reminder schemas missing index snippet: ${snippet}`);
  }
}

if (migrationFiles.length) {
  const migrationText = migrationFiles.map((file) => read(path.join("prisma-postgres", "migrations", file))).join("\n");
  for (const snippet of ["CREATE TABLE \"ReminderTemplate\"", "CREATE TABLE \"ReminderLog\"", "ReminderLog_shopId_customerId_createdAt_idx", "ReminderTemplate_shopId_active_idx"]) {
    if (!migrationText.includes(snippet)) errors.push(`PostgreSQL migration missing reminder snippet: ${snippet}`);
  }
}

if (exists("src/app.js")) {
  const appSource = read("src/app.js");
  if (!appSource.includes('app.use("/api/reminders"')) errors.push("src/app.js missing /api/reminders route registration");
}

if (exists("src/modules/reminders/reminders.routes.js")) {
  const routes = read("src/modules/reminders/reminders.routes.js");
  for (const snippet of ["/templates", "/logs", "/send", "/send-statement", "requireFeature(\"whatsapp_reminders\")", "requireRole(\"owner\", \"admin\")"]) {
    if (!routes.includes(snippet)) errors.push(`reminders.routes.js missing route/gate snippet: ${snippet}`);
  }
}

if (exists("src/modules/reminders/reminderFormatter.js")) {
  const formatter = read("src/modules/reminders/reminderFormatter.js");
  for (const snippet of ["Friendly udhar reminder", "Payment due reminder", "Statement summary", "ALLOWED_TEMPLATE_VARIABLES", "validateTemplateVariables", "UNKNOWN_TEMPLATE_VARIABLE"]) {
    if (!formatter.includes(snippet)) errors.push(`reminderFormatter.js missing template snippet: ${snippet}`);
  }
}

if (exists("src/modules/reminders/reminders.service.js")) {
  const service = read("src/modules/reminders/reminders.service.js");
  for (const snippet of ["CUSTOMER_PHONE_REQUIRED", "REMINDER_COOLDOWN_ACTIVE", "overrideCooldown", "JOB_QUEUE_DISABLED", "REMINDER_REQUESTED", "REMINDER_SKIPPED_COOLDOWN", "recordReminderMetric", "customer.udharAmount"]) {
    if (!service.includes(snippet)) errors.push(`reminders.service.js missing send/cooldown/audit snippet: ${snippet}`);
  }
  if (service.includes("frontend") && service.includes("udhar")) {
    warnings.push("reminders.service.js mentions frontend/udhar; verify reminders use DB balance only");
  }
}

if (exists("src/modules/reminders/whatsapp.provider.js")) {
  const provider = read("src/modules/reminders/whatsapp.provider.js");
  for (const snippet of ["WHATSAPP_PROVIDER_NOT_CONFIGURED", "WHATSAPP_PROVIDER_NOT_IMPLEMENTED", "Do not fake sent", "getWhatsAppProviderStatus", "sendWhatsAppMessage"]) {
    if (!provider.includes(snippet)) errors.push(`whatsapp.provider.js missing no-fake provider snippet: ${snippet}`);
  }
  if (/success:\s*true/.test(provider)) errors.push("whatsapp.provider.js must not fake successful WhatsApp sending in Phase 17");
}

if (exists("src/workers/reminder.worker.js")) {
  const worker = read("src/workers/reminder.worker.js");
  for (const snippet of ["SEND_WHATSAPP_REMINDER", "reminderLogId", "sendWhatsAppMessage", "markReminderFromProvider", "FEATURE_NOT_AVAILABLE"]) {
    if (!worker.includes(snippet)) errors.push(`reminder.worker.js missing reminder job snippet: ${snippet}`);
  }
}

if (exists("src/lib/metrics.js")) {
  const metrics = read("src/lib/metrics.js");
  for (const snippet of ["reminders_requested_total", "reminders_sent_total", "reminders_failed_total", "reminders_skipped_total", "whatsapp_provider_errors_total", "provider", "channel"]) {
    if (!metrics.includes(snippet)) errors.push(`metrics.js missing reminder metrics snippet: ${snippet}`);
  }
  for (const forbidden of ["shopId", "customerId", "userId", "phone"]) {
    const badMetricLabel = new RegExp(`recordReminderMetric[\\s\\S]{0,400}${forbidden}`).test(metrics);
    if (badMetricLabel) errors.push(`Reminder metrics must not use high-cardinality label: ${forbidden}`);
  }
}

if (exists("src/config/env.js")) {
  const envSource = read("src/config/env.js");
  for (const snippet of ["WHATSAPP_PROVIDER", "WHATSAPP_API_KEY", "WHATSAPP_API_SECRET", "WHATSAPP_SENDER_ID", "REMINDER_COOLDOWN_HOURS", "required in production when WHATSAPP_PROVIDER"]) {
    if (!envSource.includes(snippet)) errors.push(`env.js missing WhatsApp/reminder env snippet: ${snippet}`);
  }
}

if (exists("package.json")) {
  const packageJson = readJson("package.json");
  if (!packageJson.scripts?.["test:billing"]?.includes("phase17-whatsapp-reminders.examples.js")) {
    errors.push("Phase 17 WhatsApp reminder tests must be wired into npm test");
  }
}


// Phase 21: auth/session production proof.
if (exists("src/middleware/auth.js") && exists("src/modules/auth/auth.service.js")) {
  const authMiddleware = read("src/middleware/auth.js");
  const authService = read("src/modules/auth/auth.service.js");
  const sqliteSchema = exists("prisma/schema.prisma") ? read("prisma/schema.prisma") : "";
  const pgSchema = exists("prisma-postgres/schema.prisma") ? read("prisma-postgres/schema.prisma") : "";
  const migrations = migrationFiles.map((file) => read(path.join("prisma-postgres", "migrations", file))).join("\n");

  for (const [sourceName, source] of [["SQLite schema", sqliteSchema], ["PostgreSQL schema", pgSchema]]) {
    if (!source.includes("disabledAt   DateTime?")) errors.push(`${sourceName} missing User.disabledAt for staff deactivation`);
    if (!source.includes("revokedReason")) errors.push(`${sourceName} missing Session.revokedReason for session revocation auditability`);
  }
  if (!migrations.includes('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "disabledAt"')) {
    errors.push("PostgreSQL migrations missing User.disabledAt additive migration");
  }
  if (!migrations.includes('ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "revokedReason"')) {
    errors.push("PostgreSQL migrations missing Session.revokedReason additive migration");
  }
  for (const snippet of ["db.user.findFirst", "disabledAt: null", "USER_SESSION_INACTIVE", "req.user = { ...payload", "role: user.role"]) {
    if (!authMiddleware.includes(snippet)) errors.push(`auth middleware missing active-user/stale-role protection: ${snippet}`);
  }
  for (const snippet of ["REFRESH_TOKEN_REUSE_DETECTED", "STAFF_DISABLED", "PASSWORD_CHANGED", "revokedReason", "mobile: null", "email: null", "createAuditLog"]) {
    if (!authService.includes(snippet)) errors.push(`auth service missing session/staff production protection: ${snippet}`);
  }
}

if (exists("scripts/production-preflight.js")) {
  const preflight = read("scripts/production-preflight.js");
  for (const snippet of ["DATABASE_URL must use PostgreSQL", "ALLOWED_ORIGINS", "ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION", "METRICS_TOKEN", "RAZORPAY_ENABLED", "STORAGE_PROVIDER", "production_preflight"]) {
    if (!preflight.includes(snippet)) errors.push(`production preflight missing guard: ${snippet}`);
  }
}


// Phase 23: worker heartbeat readiness and operations.
if (exists("src/lib/workerHeartbeat.js") && exists("src/lib/queue.js") && exists("src/workers/index.js")) {
  const heartbeat = read("src/lib/workerHeartbeat.js");
  const queue = read("src/lib/queue.js");
  const workerIndex = read("src/workers/index.js");
  const metrics = exists("src/lib/metrics.js") ? read("src/lib/metrics.js") : "";
  const jobsRoutes = exists("src/modules/jobs/jobs.routes.js") ? read("src/modules/jobs/jobs.routes.js") : "";
  const jobsController = exists("src/modules/jobs/jobs.controller.js") ? read("src/modules/jobs/jobs.controller.js") : "";
  const packageJson = exists("package.json") ? readJson("package.json") : { scripts: {} };
  for (const snippet of ["recordWorkerHeartbeat", "startWorkerHeartbeat", "getWorkerHeartbeats", "WORKER_HEARTBEAT_INTERVAL_MS", "WORKER_STALE_AFTER_MS", "HEARTBEAT_PREFIX", "redis"]) {
    if (!heartbeat.includes(snippet)) errors.push(`workerHeartbeat.js missing Phase 23 heartbeat snippet: ${snippet}`);
  }
  if (heartbeat.includes("REDIS_URL") && heartbeat.includes("res.json")) {
    errors.push("workerHeartbeat.js must not expose REDIS_URL in API responses");
  }
  for (const snippet of ["workerHeartbeat", "getWorkerHeartbeats", "recordWorkerReadinessStatus"]) {
    if (!queue.includes(snippet)) errors.push(`queue.js missing Phase 23 worker readiness snippet: ${snippet}`);
  }
  for (const snippet of ["startWorkerHeartbeat", "heartbeatController", "workerInstanceId", "heartbeatStaleAfterMs"]) {
    if (!workerIndex.includes(snippet)) errors.push(`workers/index.js missing Phase 23 heartbeat startup snippet: ${snippet}`);
  }
  for (const snippet of ["worker_ready_status", "worker_heartbeat_age_ms", "recordWorkerReadinessStatus"]) {
    if (!metrics.includes(snippet)) errors.push(`metrics.js missing Phase 23 worker readiness metric: ${snippet}`);
  }
  if (!jobsRoutes.includes('/workers') || !jobsController.includes('workerHealth') || !jobsController.includes('payloadsExposed: false')) {
    errors.push("jobs worker health API must expose sanitized owner/admin worker readiness");
  }
  if (!packageJson.scripts?.["worker:health"]?.includes("scripts/check-worker-health.js")) {
    errors.push("package.json missing worker:health script");
  }
  if (!packageJson.scripts?.["test:billing"]?.includes("phase23-worker-health-readiness.examples.js")) {
    errors.push("Phase 23 worker health tests must be wired into npm test");
  }
}


{
  const contractPath = path.join(root, "contracts/api-contract.v1.json");
  const apiDocs = exists("docs/API_CONTRACT.md") ? read("docs/API_CONTRACT.md") : "";
  const e2eDocs = exists("docs/E2E_PRODUCTION_PROOF.md") ? read("docs/E2E_PRODUCTION_PROOF.md") : "";
  const contractScript = exists("scripts/check-api-contract.js") ? read("scripts/check-api-contract.js") : "";
  const packageJson = exists("package.json") ? readJson("package.json") : { scripts: {} };
  if (!fs.existsSync(contractPath)) {
    errors.push("contracts/api-contract.v1.json missing for Phase 24 frontend/backend contract proof");
  } else {
    try {
      const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
      const endpoints = Array.isArray(contract.endpoints) ? contract.endpoints : [];
      const keys = new Set(endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));
      for (const key of [
        "POST /api/auth/login",
        "POST /api/devices/activate",
        "GET /api/devices/license",
        "POST /api/bills/confirm",
        "GET /api/sync/pull",
        "POST /api/sync/push",
        "GET /api/jobs/workers",
        "POST /api/payment-provider/razorpay/webhook",
      ]) {
        if (!keys.has(key)) errors.push(`API contract missing required endpoint: ${key}`);
      }
      const protectedPrefixes = ["/api/products", "/api/customers", "/api/bills", "/api/inventory", "/api/reports", "/api/sync", "/api/jobs", "/api/reminders", "/api/ai"];
      for (const prefix of protectedPrefixes) {
        const matching = endpoints.filter((endpoint) => endpoint.path?.startsWith(prefix));
        if (!matching.length) errors.push(`API contract missing protected prefix ${prefix}`);
        if (matching.some((endpoint) => !endpoint.deviceRequired || !endpoint.authRequired)) {
          errors.push(`API contract protected prefix ${prefix} must require auth and device`);
        }
      }
      const syncPull = endpoints.find((endpoint) => endpoint.path === "/api/sync/pull");
      if (!syncPull?.responseMustInclude?.includes("sync.entityCursors")) errors.push("API contract must document sync.entityCursors for /api/sync/pull");
    } catch (error) {
      errors.push(`API contract JSON is invalid: ${error.message}`);
    }
  }
  for (const snippet of ["x-device-id", "Authorization", "entityCursors", "owner PIN", "shopId"]) {
    if (!apiDocs.includes(snippet)) errors.push(`docs/API_CONTRACT.md missing ${snippet}`);
  }
  for (const snippet of ["owner onboarding", "billing and stock", "offline-first sync", "subscription/payment", "worker proof", "staff/session security"]) {
    if (!e2eDocs.includes(snippet)) errors.push(`docs/E2E_PRODUCTION_PROOF.md missing ${snippet}`);
  }
  for (const snippet of ["Razorpay webhook", "sync.entityCursors", "paymentVerification", "deviceRequiredPrefixes"]) {
    if (!contractScript.includes(snippet)) errors.push(`scripts/check-api-contract.js missing ${snippet}`);
  }
  if (!packageJson.scripts?.["contract:check"]?.includes("scripts/check-api-contract.js")) {
    errors.push("package.json missing contract:check script");
  }
  if (!packageJson.scripts?.["contract:smoke"]?.includes("scripts/e2e-contract-smoke.js")) {
    errors.push("package.json missing contract:smoke script");
  }
  if (!packageJson.scripts?.["test:billing"]?.includes("phase24-api-contract-proof.examples.js")) {
    errors.push("Phase 24 API contract tests must be wired into npm test");
  }
}

if (errors.length) {
  console.error("Production readiness checks failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

for (const warning of warnings) console.warn(`Warning: ${warning}`);

if (fs.existsSync(path.join(root, "node_modules"))) {
  console.log("node_modules exists locally after install; this is OK because .gitignore/.dockerignore exclude it from production packages.");
}

if (localPresent.length) {
  console.log(
    "Local dev artifacts exist but are ignored/excluded from production packages:",
    localPresent.map(normalize).join(", ")
  );
}

console.log("Production readiness checks passed");
