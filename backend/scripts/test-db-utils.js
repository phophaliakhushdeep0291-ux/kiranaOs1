import path from "node:path";
import process from "node:process";

export function defaultTestDatabaseUrl() {
  return `file:${path.resolve(process.cwd(), "prisma", "test.db")}`;
}

export function getTestDatabaseUrl() {
  return process.env.POSTGRES_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL || defaultTestDatabaseUrl();
}

export function isSqliteTestDatabaseUrl(url = getTestDatabaseUrl()) {
  return typeof url === "string" && url.startsWith("file:");
}

export function isPostgresTestDatabaseUrl(url = getTestDatabaseUrl()) {
  return typeof url === "string" && /^postgres(?:ql)?:\/\//i.test(url);
}

export function assertSafeTestDatabaseUrl(url = getTestDatabaseUrl()) {
  if (!url) {
    throw new Error("TEST_DATABASE_URL is required for DB-backed integration tests");
  }

  if (isSqliteTestDatabaseUrl(url)) {
    const normalized = url.toLowerCase();
    if (normalized.includes("dev.db") || normalized.includes("prod") || normalized.includes("production")) {
      throw new Error(
        `Refusing to run integration tests against a dev/production-looking database URL: ${maskDatabaseUrl(url)}`
      );
    }
    return url;
  }

  if (isPostgresTestDatabaseUrl(url)) {
    return assertSafePostgresTestDatabaseUrl(url);
  }

  throw new Error(
    `Refusing to run integration tests against an unsupported database URL: ${maskDatabaseUrl(url)}`
  );
}

export function assertSafePostgresTestDatabaseUrl(url = getTestDatabaseUrl()) {
  if (!isPostgresTestDatabaseUrl(url)) {
    throw new Error(`POSTGRES_TEST_DATABASE_URL/TEST_DATABASE_URL must be PostgreSQL: ${maskDatabaseUrl(url)}`);
  }
  if (process.env.ALLOW_POSTGRES_TEST_DB !== "true") {
    throw new Error(
      "Refusing to run PostgreSQL integration tests unless ALLOW_POSTGRES_TEST_DB=true is explicitly set"
    );
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid PostgreSQL test database URL: ${maskDatabaseUrl(url)}`);
  }

  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const safeName = databaseName.includes("test") || databaseName.endsWith("_ci");
  const safeHost = ["localhost", "127.0.0.1", "postgres", "db"].includes(host) || host.includes("test") || host.includes("ci");

  if (!safeName) {
    throw new Error(
      `Refusing PostgreSQL integration tests: database name must clearly contain test/_ci. URL=${maskDatabaseUrl(url)}`
    );
  }
  if (!safeHost) {
    throw new Error(
      `Refusing PostgreSQL integration tests: host must be local/CI/test-looking. URL=${maskDatabaseUrl(url)}`
    );
  }
  if (databaseName.includes("prod") || databaseName.includes("production") || databaseName === "kiranaos") {
    throw new Error(
      `Refusing PostgreSQL integration tests against production-looking database: ${maskDatabaseUrl(url)}`
    );
  }

  return url;
}

export function buildTestEnv(extra = {}) {
  const testDatabaseUrl = assertSafeTestDatabaseUrl(getTestDatabaseUrl());
  return {
    ...process.env,
    NODE_ENV: "test",
    ALLOW_POSTGRES_TEST_DB: process.env.ALLOW_POSTGRES_TEST_DB || (isPostgresTestDatabaseUrl(testDatabaseUrl) ? "true" : undefined),
    TEST_DATABASE_URL: testDatabaseUrl,
    DATABASE_URL: testDatabaseUrl,
    JWT_SECRET: process.env.JWT_SECRET || "test-jwt-secret-change-me-1234567890",
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "15m",
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "http://localhost:5500,http://127.0.0.1:5500",
    LOG_LEVEL: process.env.LOG_LEVEL || "silent",
    ENABLE_DEVICE_LICENSE_SIGNING: process.env.ENABLE_DEVICE_LICENSE_SIGNING || "true",
    LICENSE_SIGNING_SECRET: process.env.LICENSE_SIGNING_SECRET || "test-license-secret-change-me-1234567890",
    ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION: "true",
    DEV_MAX_ACTIVE_DEVICES: "1",
    ...extra,
  };
}

export function isKnownPrismaRuntimeUnavailable(stderrOrError = "") {
  const text = String(stderrOrError?.stack || stderrOrError?.message || stderrOrError || "");
  return (
    text.includes("binaries.prisma.sh") ||
    text.includes("Query Engine") ||
    text.includes("query engine") ||
    text.includes("libquery_engine") ||
    text.includes("Could not locate the Query Engine") ||
    text.includes("Prisma Client could not locate") ||
    text.includes("EAI_AGAIN") ||
    text.includes("ENOTFOUND") ||
    text.includes("Named export 'PrismaClient' not found") ||
    text.includes("@prisma/client did not initialize yet")
  );
}

export function isSandboxRuntime() {
  return Boolean(
    process.env.NETWORK === "caas_packages_only" ||
    process.env.CAAS_ARTIFACTORY_BASE_URL ||
    process.env.CUA_DD_VM_BUILD ||
    process.env.VM_BUILD?.includes("openaiappliedcaas")
  );
}

export function shouldGracefullySkipPrismaRuntime() {
  if (process.env.FORCE_DB_TESTS === "true") return false;
  if (isSandboxRuntime()) return true;
  return process.env.CI !== "true";
}

export function maskDatabaseUrl(url = "") {
  return String(url).replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}
