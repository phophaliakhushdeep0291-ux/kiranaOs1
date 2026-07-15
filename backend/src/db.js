import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const databaseUrl = String(process.env.DATABASE_URL || "");
// The isolated integration client is generated from the SQLite schema. CI's
// PostgreSQL proof intentionally reuses the integration runner, so select that
// client only for a file: datasource; otherwise use the PostgreSQL client that
// prisma:generate:postgres generated in @prisma/client.
const useIsolatedIntegrationClient =
  process.env.PRISMA_CLIENT_VARIANT === "integration" &&
  databaseUrl.startsWith("file:");
const prismaPackage = useIsolatedIntegrationClient
  ? require("../generated/integration-prisma-client")
  : require("@prisma/client");
const { PrismaClient } = prismaPackage;

// Singleton pattern — reuse the same client across the app
// In production with PostgreSQL, connection pooling is handled at the DB layer
const db = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
});

export default db;
