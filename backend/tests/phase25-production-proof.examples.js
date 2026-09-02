import assert from "assert";
import fs from "fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

const pkg = JSON.parse(read("package.json"));
assert.ok(pkg.scripts["proof:postgres"], "proof:postgres script must exist");
assert.ok(pkg.scripts["test:postgres"], "test:postgres script must exist");
assert.ok(pkg.scripts["test:postgres"].includes("-r dotenv/config"), "test:postgres must load the documented local test URL before safety validation");
assert.ok(pkg.scripts["setup:test-db:postgres"], "setup:test-db:postgres script must exist");

const testDbUtils = read("scripts/test-db-utils.js");
for (const snippet of [
  "assertSafePostgresTestDatabaseUrl",
  "ALLOW_POSTGRES_TEST_DB",
  "POSTGRES_TEST_DATABASE_URL",
  "database name must clearly contain test/_ci",
  "Refusing PostgreSQL integration tests",
]) {
  assert.ok(testDbUtils.includes(snippet), `test-db-utils must include ${snippet}`);
}

const setupDb = read("scripts/setup-test-db.js");
assert.ok(setupDb.includes("prisma-postgres/schema.prisma"), "setup-test-db must support PostgreSQL schema");
assert.ok(setupDb.includes("migrate", "reset"), "setup-test-db must use Prisma migrations for Postgres test DB");
assert.ok(setupDb.includes("--skip-seed"), "Postgres test reset must skip seed by default");
const postgresResetIndex = setupDb.indexOf('runPrisma(["migrate", "reset"');
const postgresGenerateIndex = setupDb.indexOf('runPrisma(["generate", ...schemaArgs])');
assert.ok(postgresResetIndex >= 0 && postgresGenerateIndex > postgresResetIndex, "Postgres setup must authenticate/reset before regenerating the shared Prisma client");

const proofRunner = read("scripts/postgres-production-proof.js");
for (const command of [
  "prisma:generate:postgres",
  "validate",
  "setup:test-db",
  "test:integration",
  "contract:check",
  "prod:check",
]) {
  assert.ok(proofRunner.includes(command), `proof runner must execute ${command}`);
}
assert.ok(proofRunner.includes("FORCE_DB_TESTS"), "proof runner must force DB tests instead of sandbox skip");
for (const evidenceSnippet of [
  "kiranaos_postgres_production_proof",
  "POSTGRES_PROOF_REPORT_PATH",
  "postgres-production-proof-latest.json",
  "migrationInventory",
  "safeDatabaseIdentity",
  'writeReport("passed")',
]) {
  assert.ok(proofRunner.includes(evidenceSnippet), `proof runner must retain ${evidenceSnippet}`);
}

const integrationSetup = read("tests/integration/setup.js");
for (const snippet of [
  "ensureDefaultDevice",
  "DEVICE_REQUIRED",
  "x-device-id",
  "urlPath.startsWith(\"/api/sync\")",
  "defaultDevicePromiseByToken",
]) {
  assert.ok(integrationSetup.includes(snippet), `integration setup must include ${snippet}`);
}

const concurrency = read("tests/integration/production-concurrency.integration.test.js");
for (const snippet of [
  "parallel bills apply every sale once while preserving negative-stock reconciliation",
  "parallel udhar payments cannot over-decrement",
  "Promise.all",
  "stockBaseQty, -4",
  "saleLedgers.length, 2",
  "new Set(saleLedgers.map((entry) => entry.billId)).size, 2",
  "udharAmount, 20",
  "[201, 201]",
  "[200, 409]",
]) {
  assert.ok(concurrency.includes(snippet), `concurrency test must include ${snippet}`);
}

const docs = read("docs/PRODUCTION_PROOF.md");
for (const phrase of [
  "PostgreSQL proof",
  "Concurrency proof",
  "Device-enforced integration tests",
  "npm run proof:postgres",
  "Razorpay test-mode",
  "Redis worker heartbeat",
]) {
  assert.ok(docs.includes(phrase), `production proof docs must mention ${phrase}`);
}

const envExample = read(".env.example");
assert.ok(envExample.includes("POSTGRES_TEST_DATABASE_URL"), ".env.example must document POSTGRES_TEST_DATABASE_URL");
assert.ok(envExample.includes("ALLOW_POSTGRES_TEST_DB"), ".env.example must document ALLOW_POSTGRES_TEST_DB");

console.log("Phase 25 production proof examples passed");
