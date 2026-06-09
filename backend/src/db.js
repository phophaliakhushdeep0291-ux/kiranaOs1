import { PrismaClient } from "@prisma/client";

// Singleton pattern — reuse the same client across the app
// In production with PostgreSQL, connection pooling is handled at the DB layer
const db = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
});

export default db;
