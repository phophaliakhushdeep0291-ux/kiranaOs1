import { spawnSync } from "node:child_process";
import process from "node:process";
import { assertSafePostgresTestDatabaseUrl, maskDatabaseUrl } from "./test-db-utils.js";

const postgresUrl = process.env.POSTGRES_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
if (!postgresUrl) {
  console.error("POSTGRES_TEST_DATABASE_URL or TEST_DATABASE_URL is required for PostgreSQL production proof.");
  process.exit(1);
}

process.env.ALLOW_POSTGRES_TEST_DB = "true";
assertSafePostgresTestDatabaseUrl(postgresUrl);

const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: postgresUrl,
  TEST_DATABASE_URL: postgresUrl,
  POSTGRES_TEST_DATABASE_URL: postgresUrl,
  FORCE_DB_TESTS: process.env.FORCE_DB_TESTS || "true",
  JWT_SECRET: process.env.JWT_SECRET || "postgres-proof-jwt-secret-change-me-1234567890",
  LICENSE_SIGNING_SECRET: process.env.LICENSE_SIGNING_SECRET || "postgres-proof-license-secret-change-me-1234567890",
  ENABLE_DEVICE_LICENSE_SIGNING: process.env.ENABLE_DEVICE_LICENSE_SIGNING || "true",
  RAZORPAY_ENABLED: process.env.RAZORPAY_ENABLED || "false",
  LOG_LEVEL: process.env.LOG_LEVEL || "silent",
};

const commands = [
  ["npm", ["run", "prisma:generate:postgres"], "Generate Prisma client from PostgreSQL schema"],
  ["node", ["node_modules/prisma/build/index.js", "validate", "--schema", "prisma-postgres/schema.prisma"], "Validate PostgreSQL Prisma schema"],
  ["npm", ["run", "setup:test-db"], "Reset isolated PostgreSQL test database"],
  ["npm", ["run", "test:integration"], "Run DB-backed integration and concurrency tests"],
  ["npm", ["run", "money:paise:reconcile"], "Reconcile rupee Float columns with paise shadow columns"],
  ["npm", ["run", "contract:check"], "Check API contract"],
  ["npm", ["run", "prod:check"], "Run production static checks"],
];

console.log(`PostgreSQL proof database: ${maskDatabaseUrl(postgresUrl)}`);
console.log("This command is destructive and should only target an isolated *_test or *_ci database.\n");

for (const [cmd, args, label] of commands) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(cmd, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`\n❌ Failed: ${label}`);
    process.exit(result.status || 1);
  }
}

console.log("\n✅ PostgreSQL production proof passed.");
