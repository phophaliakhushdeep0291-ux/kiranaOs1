import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildTestEnv, maskDatabaseUrl, prismaSchemasEquivalent } from "./test-db-utils.js";

const backendRoot = path.resolve(process.cwd());
const databasePath = path.join(backendRoot, "prisma", `full-suite-${process.pid}-${Date.now()}.db`);
const databaseUrl = `file:${databasePath}`;
process.env.TEST_DATABASE_URL = databaseUrl;
process.env.DATABASE_URL = databaseUrl;
const sourceSchemaPath = path.join(backendRoot, "prisma", "schema.prisma");
const generatedSchemaPath = path.join(backendRoot, "generated", "integration-prisma-client", "schema.prisma");
const generatedClientMatchesSource = fs.existsSync(sourceSchemaPath)
  && fs.existsSync(generatedSchemaPath)
  && prismaSchemasEquivalent(
    fs.readFileSync(sourceSchemaPath, "utf8"),
    fs.readFileSync(generatedSchemaPath, "utf8"),
  );

const env = buildTestEnv({
  TEST_DATABASE_URL: databaseUrl,
  DATABASE_URL: databaseUrl,
  PRISMA_CLIENT_VARIANT: "integration",
  FORCE_DB_TESTS: "true",
  // Individual tests may opt into manual activation, but leaking the generic
  // DB-test default into production boot probes masks the guard under test.
  ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION: "false",
  SKIP_PRISMA_GENERATE: generatedClientMatchesSource ? "true" : "false",
});

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: backendRoot, env, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
}

try {
  console.log(`Running the complete suite against isolated database ${maskDatabaseUrl(databaseUrl)}`);
  run(process.execPath, ["scripts/setup-test-db.js"], "Isolated database setup");
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is required to run the isolated suite");
  run(process.execPath, [npmCli, "run", "test:isolated-suite"], "Main test suite");
} finally {
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    try { fs.rmSync(`${databasePath}${suffix}`, { force: true }); }
    catch (error) { console.warn(`Could not remove isolated test artifact: ${error.message}`); }
  }
}
