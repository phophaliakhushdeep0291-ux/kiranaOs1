import { URL } from "node:url";

export function parsePostgresUrl(rawUrl, label = "DATABASE_URL") {
  if (!rawUrl) throw new Error(`${label} is required`);
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error(`${label} must use postgresql:// or postgres://`);
  }
  const database = decodeURIComponent(parsed.pathname || "").replace(/^\//, "");
  if (!database) throw new Error(`${label} must include a database name`);
  return {
    rawUrl,
    protocol: parsed.protocol,
    host: parsed.hostname,
    port: parsed.port,
    database,
    username: parsed.username ? decodeURIComponent(parsed.username) : "",
  };
}

export function maskPostgresUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) parsed.password = "***";
    if (parsed.username) parsed.username = "***";
    return parsed.toString();
  } catch {
    return "<invalid-url>";
  }
}

const PRISMA_ONLY_POSTGRES_QUERY_PARAMS = Object.freeze([
  "schema",
  "connection_limit",
  "pool_timeout",
  "pgbouncer",
  "socket_timeout",
]);

// Prisma accepts connection-string parameters that libpq tools such as
// pg_dump, pg_restore and psql reject. Remove only those Prisma-specific
// options; preserve sslmode, connect_timeout, options and other libpq settings.
export function postgresCliUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  for (const parameter of PRISMA_ONLY_POSTGRES_QUERY_PARAMS) parsed.searchParams.delete(parameter);
  return parsed.toString();
}

export function isSafeRestoreDatabaseName(name = "") {
  const db = String(name).toLowerCase();
  if (!db) return false;
  if (/prod|production|live|primary|main/.test(db)) return false;
  return /test|_ci|ci_|restore|drill|staging/.test(db);
}

export function assertSafeRestoreTarget({ sourceUrl, restoreUrl, allowFlag = false }) {
  const source = parsePostgresUrl(sourceUrl, "DATABASE_URL");
  const restore = parsePostgresUrl(restoreUrl, "RESTORE_TEST_DATABASE_URL");

  if (!allowFlag) {
    throw new Error("ALLOW_RESTORE_TEST_DB=true is required before resetting a restore-test database");
  }
  if (source.rawUrl === restore.rawUrl || (source.host === restore.host && source.port === restore.port && source.database === restore.database)) {
    throw new Error("RESTORE_TEST_DATABASE_URL must not point to the same database as DATABASE_URL");
  }
  if (!isSafeRestoreDatabaseName(restore.database)) {
    throw new Error("Restore target database name must contain test, _ci, restore, drill, or staging and must not look production-like");
  }
  return { source, restore };
}
