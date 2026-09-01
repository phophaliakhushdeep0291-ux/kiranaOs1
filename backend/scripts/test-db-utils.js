import path from "node:path";
import process from "node:process";

/**
 * Compare Prisma schemas by meaningful tokens rather than generated formatting.
 *
 * `prisma generate` writes a normalized copy of schema.prisma into the client.
 * Hand-aligned source fields therefore differ byte-for-byte even when the
 * generated client is current. Whitespace and comments outside quoted strings
 * do not affect Prisma's data model; whitespace inside strings still does.
 */
export function normalizePrismaSchemaForComparison(schema = "") {
  let normalized = "";
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < String(schema).length; index += 1) {
    const character = schema[index];
    const next = schema[index + 1];

    if (lineComment) {
      if (character === "\n" || character === "\r") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      normalized += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      normalized += character;
      continue;
    }
    if (/\s/.test(character)) continue;
    normalized += character;
  }

  return normalized;
}

export function prismaSchemasEquivalent(left, right) {
  return normalizePrismaSchemaForComparison(left) === normalizePrismaSchemaForComparison(right);
}

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
  if (process.env.REQUIRE_POSTGRES_TEST_DB === "true") {
    const configuredUrl = process.env.POSTGRES_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
    if (!configuredUrl) {
      throw new Error(
        "POSTGRES_TEST_DATABASE_URL or TEST_DATABASE_URL is required when REQUIRE_POSTGRES_TEST_DB=true"
      );
    }
    return assertSafePostgresTestDatabaseUrl(configuredUrl);
  }

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
    DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL || (isPostgresTestDatabaseUrl(testDatabaseUrl) ? testDatabaseUrl : undefined),
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
