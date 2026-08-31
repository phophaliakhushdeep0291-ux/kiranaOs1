import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const databaseUrl = String(process.env.DATABASE_URL || "");
const normalizedDatabaseUrl = databaseUrl.replaceAll("\\", "/").toLowerCase();
const launchedTestFile = String(process.argv[1] || "").replaceAll("\\", "/").includes("/tests/");
const testProcess = process.env.NODE_ENV === "test"
  || String(process.env.npm_lifecycle_event || "").startsWith("test")
  || launchedTestFile;
const sharedDevelopmentDatabase = !databaseUrl
  || /(?:^|\/)dev\.db(?:[?&]|$)/.test(normalizedDatabaseUrl)
  || normalizedDatabaseUrl.includes("production");

if (testProcess && sharedDevelopmentDatabase && process.env.ALLOW_SHARED_TEST_DATABASE !== "true") {
  throw new Error(
    "Refusing to run tests against the shared development database. " +
    "Use scripts/run-db-example-tests.js or npm test so KiranaOS QA data stays isolated."
  );
}
// The isolated integration client is generated from the SQLite schema. CI's
// PostgreSQL proof intentionally reuses the integration runner, so select that
// client only for a file: datasource; otherwise use the PostgreSQL client that
// prisma:generate:postgres generated in @prisma/client.
const sqliteClientVariant = databaseUrl.startsWith("file:")
  ? String(process.env.PRISMA_CLIENT_VARIANT || "")
  : "";
const isolatedClientPackages = {
  integration: "../generated/integration-prisma-client",
  certification: "../generated/certification-prisma-client",
};
const isolatedClientPackage = isolatedClientPackages[sqliteClientVariant];
const prismaPackage = isolatedClientPackage
  ? require(isolatedClientPackage)
  : require("@prisma/client");
const { PrismaClient } = prismaPackage;

/**
 * The schema metadata belonging to the client this process actually uses.
 *
 * Re-exported rather than imported from "@prisma/client" by callers, because
 * that path is fixed while the client above is chosen at runtime: under the
 * integration or certification variant a caller reading dmmf from the fixed path
 * is describing a DIFFERENT schema from the one its queries run against.
 *
 * That is not hypothetical. A new model was added, registered for restore, and
 * the backup service still refused it as "metadata missing" - it was reading the
 * default client's dmmf, which had not been regenerated, while querying through
 * the integration client that knew the model perfectly well. Disaster recovery
 * was broken and the error pointed at the wrong thing.
 */
export const Prisma = prismaPackage.Prisma;

// SQLite has exactly one writer, but Prisma still opens a pool of connections
// against the file. When a second connection touches the database while an
// interactive transaction is open, the 5.14 query engine panics
// (`unreachable` in libs/user-facing-errors/src/quaint.rs) instead of
// reporting a busy database — and a panic kills the whole client, not just
// that query. Two concurrent logins are enough to trigger it. Pinning the pool
// to a single connection makes the driver queue, which is SQLite's real
// concurrency model anyway. PostgreSQL (production) is untouched.
function sqlitePoolUrl(url) {
  if (!url.startsWith("file:")) return null;
  if (/[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=1`;
}

const sqliteUrl = sqlitePoolUrl(databaseUrl);

// Singleton pattern — reuse the same client across the app
// In production with PostgreSQL, connection pooling is handled at the DB layer
const db = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
  ...(sqliteUrl ? { datasources: { db: { url: sqliteUrl } } } : {}),
});

export default db;
