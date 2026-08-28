import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildTestEnv,
  isKnownPrismaRuntimeUnavailable,
  maskDatabaseUrl,
  shouldGracefullySkipPrismaRuntime,
} from "./test-db-utils.js";

const integrationDir = path.join(process.cwd(), "tests", "integration");
const requestedFiles = process.argv.slice(2)
  .map((value) => path.normalize(value))
  .filter(Boolean);
const discoveredFiles = fs.readdirSync(integrationDir)
  .filter((name) => name.endsWith(".integration.test.js"))
  .sort()
  .map((name) => path.join("tests", "integration", name));
const files = requestedFiles.length > 0
  ? discoveredFiles.filter((file) => requestedFiles.some((requested) => (
      path.normalize(file) === requested
      || path.basename(file) === path.basename(requested)
    )))
  : discoveredFiles;

if (!files.length) {
  console.error(requestedFiles.length > 0
    ? `No requested integration test files matched: ${requestedFiles.join(", ")}`
    : "No integration test files found under tests/integration");
  process.exit(1);
}

// A fixed prisma/test.db lets overlapping verification runs corrupt one
// another. Unless the caller deliberately supplies a test database (for
// example PostgreSQL in CI), allocate one SQLite file for this invocation and
// pass that exact URL to every child process.
const ownsEphemeralSqlite = !process.env.TEST_DATABASE_URL && !process.env.POSTGRES_TEST_DATABASE_URL;
const ephemeralDatabasePath = ownsEphemeralSqlite
  ? path.join(process.cwd(), "prisma", `integration-test-${process.pid}-${Date.now()}.db`)
  : null;
const ephemeralDatabaseUrl = ephemeralDatabasePath
  ? `file:${ephemeralDatabasePath.replace(/\\/g, "/")}`
  : null;
const env = buildTestEnv(ephemeralDatabaseUrl
  ? { TEST_DATABASE_URL: ephemeralDatabaseUrl, DATABASE_URL: ephemeralDatabaseUrl }
  : {});

function cleanupEphemeralDatabase() {
  if (!ephemeralDatabasePath) return;
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(`${ephemeralDatabasePath}${suffix}`);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn(`Could not remove isolated integration database${suffix}: ${error.message}`);
      }
    }
  }
}

process.once("exit", cleanupEphemeralDatabase);

function prepareTestDatabase() {
  const result = spawnSync(process.execPath, ["scripts/setup-test-db.js"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (isKnownPrismaRuntimeUnavailable(combined) && shouldGracefullySkipPrismaRuntime()) {
      console.warn(
        [
          "Skipping DB-backed integration tests because test DB setup could not load the Prisma runtime in this sandbox.",
          "This skip is intended for restricted sandboxes only; set FORCE_DB_TESTS=true to force failure.",
          `Test DB URL: ${maskDatabaseUrl(env.TEST_DATABASE_URL)}`,
          "Original setup error:",
          combined.trim(),
        ].join("\n")
      );
      process.exit(0);
    }

    console.error("Integration test database setup failed.");
    process.exit(result.status || 1);
  }
}

function preflightPrismaRuntime() {
  const code = `
    import db from "./src/db.js";
    try {
      await db.$connect();
      await db.$queryRawUnsafe("SELECT 1");
      await db.$disconnect();
    } catch (error) {
      console.error(error?.stack || error?.message || error);
      try { await db.$disconnect(); } catch {}
      process.exit(1);
    }
  `;

  return spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    stdio: "pipe",
  });
}

prepareTestDatabase();

const preflight = preflightPrismaRuntime();
const preflightOutput = `${preflight.stdout || ""}\n${preflight.stderr || ""}`;

if (preflight.status !== 0) {
  if (isKnownPrismaRuntimeUnavailable(preflightOutput) && shouldGracefullySkipPrismaRuntime()) {
    console.warn(
      [
        "Skipping DB-backed integration tests because the Prisma runtime/binary is unavailable in this sandbox.",
        "This skip is intended for restricted sandboxes only; set FORCE_DB_TESTS=true to force failure.",
        `Test DB URL: ${maskDatabaseUrl(env.TEST_DATABASE_URL)}`,
        "Original Prisma runtime error:",
        preflightOutput.trim(),
      ].join("\n")
    );
    process.exit(0);
  }

  console.error("Prisma integration-test preflight failed. DB tests were not hidden.");
  console.error(preflightOutput.trim());
  process.exit(preflight.status || 1);
}

const regression = spawnSync(process.execPath, ["tests/backend-regression.examples.js"], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});

if (regression.status !== 0) {
  console.error("DB-backed regression examples failed.");
  process.exit(regression.status || 1);
}

// One process per file, not one process for all of them. `--test-concurrency=1`
// only serialises the test functions; every file still shares a single module
// registry, so they share one Prisma client and its SQLite connection. A file
// whose async handles are still settling when the next file calls
// resetDatabase() produced "SQL error or missing database" and then cascaded
// through every remaining file — the release gate failed for reasons that had
// nothing to do with the code under test, and the same files pass individually.
// Isolating them costs a second of startup each and makes the gate deterministic.
const failed = [];
const perFileTimeoutMs = Number(process.env.INTEGRATION_TEST_FILE_TIMEOUT_MS || 4 * 60_000);
for (const file of files) {
  console.log(`\n[integration] ${file}`);
  const run = spawnSync(process.execPath, [
    "--test",
    "--test-concurrency=1",
    "--test-timeout=120000",
    "--test-force-exit",
    file,
  ], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    timeout: perFileTimeoutMs,
  });
  if (run.status !== 0 || run.error) {
    failed.push(file);
    if (run.error?.code === "ETIMEDOUT") {
      console.error(`[integration] ${file} exceeded ${perFileTimeoutMs}ms; stopping because its database state is no longer trustworthy.`);
      break;
    }
  }
}

if (failed.length) {
  console.error(`\nIntegration test files failed (${failed.length}/${files.length}):`);
  for (const file of failed) console.error(`  - ${file}`);
  process.exit(1);
}
