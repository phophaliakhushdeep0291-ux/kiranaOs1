import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const prismaPackage = process.env.PRISMA_CLIENT_VARIANT === "integration"
  ? require("../generated/integration-prisma-client")
  : require("@prisma/client");
const { PrismaClient } = prismaPackage;

// Singleton pattern — reuse the same client across the app
// In production with PostgreSQL, connection pooling is handled at the DB layer
const db = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
});

export default db;
