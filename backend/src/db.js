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
// Which generated client this process talks through.
//
// The isolated integration client is generated from the SQLite schema. CI's
// PostgreSQL proof intentionally reuses the integration runner, so select that
// client only for a file: datasource.
//
// A PostgreSQL URL takes the client prisma:generate:postgres builds, which now
// has a directory of its own. It used to land in @prisma/client - the same
// place the SQLite dev client lives - so the two overwrote each other, and
// generating for PostgreSQL on a developer machine left the dev server dead at
// boot. Anything that is neither keeps the default client, so an unset
// DATABASE_URL behaves exactly as it did.
const POSTGRES_CLIENT_PACKAGE = "../generated/postgres-prisma-client";
// The scheme, read without a regex: this file is the one place a wrong answer
// silently routes every query through a client built from another schema.
const datasourceScheme = databaseUrl.slice(0, databaseUrl.indexOf(":")).toLowerCase();
const postgresDatasource = datasourceScheme === "postgres" || datasourceScheme === "postgresql";
const sqliteClientVariant = databaseUrl.startsWith("file:")
  ? String(process.env.PRISMA_CLIENT_VARIANT || "")
  : "";
const isolatedClientPackages = {
  integration: "../generated/integration-prisma-client",
  certification: "../generated/certification-prisma-client",
};
const isolatedClientPackage = isolatedClientPackages[sqliteClientVariant];

function loadPrismaPackage() {
  if (isolatedClientPackage) return require(isolatedClientPackage);
  if (!postgresDatasource) return require("@prisma/client");
  try {
    return require(POSTGRES_CLIENT_PACKAGE);
  } catch (error) {
    // Name the command that is missing. A bare module-not-found points at a
    // path inside generated/ that means nothing to whoever is deploying.
    if (error?.code !== "MODULE_NOT_FOUND") throw error;
    throw new Error(
      "DATABASE_URL is PostgreSQL but the PostgreSQL Prisma client has not been generated. " +
      "Run npm run prisma:generate:postgres.",
    );
  }
}

const prismaPackage = loadPrismaPackage();

/**
 * The constructor belonging to the client this process resolved.
 *
 * Exported for the same reason Prisma is: the fixed @prisma/client path is now
 * one of three possible clients, so an ops script reaching for it directly can
 * end up querying through a different schema from the running server.
 */
export const { PrismaClient } = prismaPackage;

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

/**
 * Which engine this process is actually talking to.
 *
 * Exported from here for the reason stated above the scheme parse: this file is
 * the one place a wrong answer silently routes queries through the wrong client,
 * so anything that has to branch on the engine should read the same answer
 * rather than re-parse DATABASE_URL and drift from it.
 */
export const databaseEngine = postgresDatasource
  ? "postgres"
  : databaseUrl.startsWith("file:")
    ? "sqlite"
    : "unknown";

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
