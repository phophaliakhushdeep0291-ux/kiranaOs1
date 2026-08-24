/**
 * Static assertions for Phase 5 DB-backed integration test infrastructure.
 * These do not replace real DB tests; they keep the npm test chain aware that
 * the integration runner, test DB safety checks, and factories remain wired.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

function read(file) { return fs.readFileSync(file, "utf8"); }
const pkg = JSON.parse(read("package.json"));

assert.ok(pkg.scripts["setup:test-db"], "setup:test-db script must exist");
assert.ok(pkg.scripts["db:push:test"], "db:push:test script must exist");
assert.ok(pkg.scripts["test:db"], "test:db script must exist");
assert.ok(pkg.scripts["test:integration"], "test:integration script must exist");
assert.match(pkg.scripts["test:db"], /run-integration-tests/, "test:db must run the integration runner");
assert.match(pkg.scripts["setup:test-db"], /setup-test-db/, "setup:test-db must run the setup script");

for (const file of [
  "scripts/test-db-utils.js",
  "scripts/setup-test-db.js",
  "scripts/run-integration-tests.js",
  "tests/integration/setup.js",
  "tests/integration/factories.js",
  "tests/integration/auth.integration.test.js",
  "tests/integration/billing.integration.test.js",
  "tests/integration/products.integration.test.js",
  "tests/integration/rbac-pin.integration.test.js",
  "tests/integration/customers.integration.test.js",
  "tests/integration/sync.integration.test.js",
  "tests/integration/reports.integration.test.js",
  "tests/integration/tenant-isolation.integration.test.js",
]) {
  assert.ok(fs.existsSync(file), `${file} must exist`);
}

const envExample = read(".env.example");
assert.match(envExample, /^TEST_DATABASE_URL=/m, ".env.example must document TEST_DATABASE_URL");
assert.match(envExample, /^POSTGRES_TEST_DATABASE_URL=/m, ".env.example must document POSTGRES_TEST_DATABASE_URL");

const testDbUtils = read("scripts/test-db-utils.js");
assert.match(testDbUtils, /Refusing to run integration tests against an unsupported database URL/, "test DB helper must reject unsupported DB URLs");
assert.match(testDbUtils, /assertSafePostgresTestDatabaseUrl/, "test DB helper must explicitly protect PostgreSQL test URLs");
assert.match(testDbUtils, /ALLOW_POSTGRES_TEST_DB/, "PostgreSQL test DB must require explicit opt-in");
assert.match(testDbUtils, /dev\.db/, "test DB helper must reject dev DB names");
assert.match(testDbUtils, /production/, "test DB helper must reject production-looking names");

const dbRuntime = read("src/db.js");
assert.match(dbRuntime, /databaseUrl\.startsWith\("file:"\)/, "isolated Prisma client must only be selected for SQLite file datasources");
assert.match(dbRuntime, /isolatedClientPackage[\s\S]*require\("@prisma\/client"\)/, "database runtime must keep PostgreSQL proof on the generated PostgreSQL client fallback");

const setup = read("tests/integration/setup.js");
const runner = read("scripts/run-integration-tests.js");
assert.match(runner, /prepareTestDatabase/, "integration runner must prepare the test DB before tests");
assert.match(runner, /setup-test-db\.js/, "integration runner must call the safe setup-test-db script");
assert.match(setup, /resetDatabase/, "integration setup must expose resetDatabase");
assert.match(setup, /db\.\$connect/, "integration setup must prove Prisma can connect");
assert.match(setup, /Prisma query engine\/runtime is unavailable/, "integration setup must skip sandbox Prisma runtime failures gracefully");
for (const cleanup of [
  "db.reportExportJob.deleteMany",
  "db.reminderLog.deleteMany",
  "db.reminderTemplate.deleteMany",
  "db.dailyClosingSnapshot.deleteMany",
  "db.syncIdMapping.deleteMany",
]) {
  assert.match(setup, new RegExp(cleanup.replaceAll(".", "\\.")), `resetDatabase must clear ${cleanup}`);
}

const factories = read("tests/integration/factories.js");
for (const helper of ["createTenant", "createStaff", "createProduct", "createCustomer", "billPayload", "login"]) {
  assert.match(factories, new RegExp(helper), `factories must include ${helper}`);
}
assert.match(factories, /bcrypt\.hash/, "factories must use bcrypt hashes matching real auth logic");

assert.ok(
  pkg.scripts["test:billing"].includes("phase5-integration-infra.examples.js"),
  "npm test chain must include Phase 5 static infra assertions"
);

console.log("Phase 5 integration infrastructure examples passed");
