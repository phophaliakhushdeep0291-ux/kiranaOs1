/**
 * Run the index audit against a disposable database, end to end.
 *
 * Brings the database up, pushes the schema, runs scripts/index-audit.js against it,
 * tears everything down. Mirrors run-loadtest-stack.js deliberately — same compose
 * file, same disposable-PostgreSQL contract, same refusal to touch anything shared.
 *
 * The audit's whole subject is a difference between the two engines, so both are
 * first-class here and the answer is the pair:
 *
 *   npm run index-audit:postgres     # PostgreSQL 16 — what production runs
 *   npm run index-audit:local        # SQLite — what your laptop runs, and what it hides
 *
 * Flags and env pass through:
 *   INDEX_AUDIT_BILLS=30000 npm run index-audit:postgres
 *   POSTGRES_TEST_DATABASE_URL=postgresql://… npm run index-audit:postgres
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildTestEnv } from "./test-db-utils.js";

const argv = process.argv.slice(2);
const usePostgres = argv.includes("--postgres");

const backendRoot = path.resolve(process.cwd());
const composeFile = path.join("loadtest", "docker-compose.loadtest.yml");
// The same disposable instance the load test uses: port 55432, anonymous volume,
// removed by `down -v`. It must never be a PostgreSQL anyone is keeping.
const POSTGRES_URL = "postgresql://kiranaos:loadtest@127.0.0.1:55432/kiranaos_loadtest";
const sqliteFile = path.join(backendRoot, "prisma", `index-audit-${process.pid}.db`);

const teardown = [];
let exitCode = 0;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: backendRoot, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status})`);
}

function dockerAvailable() {
  const version = spawnSync("docker", ["compose", "version"], { stdio: "ignore" });
  if (version.error || version.status !== 0) return false;
  const info = spawnSync("docker", ["info"], { stdio: "ignore" });
  return !info.error && info.status === 0;
}

async function main() {
  let databaseUrl;

  if (usePostgres) {
    if (!dockerAvailable()) {
      console.error([
        "Docker is not available, so the disposable PostgreSQL cannot be started —",
        "and PostgreSQL is the only engine that answers this question. SQLite skip-scans",
        "a composite index for a bare second column, which is precisely the gap being",
        "measured, so a SQLite run cannot stand in for this one.",
        "",
        "  Install Docker Desktop (or colima/podman with a docker-compatible CLI), or",
        "  point at a PostgreSQL 16 you already have and do not mind being written to:",
        "",
        "    POSTGRES_TEST_DATABASE_URL=postgresql://user:pass@host:5432/scratch \\",
        "      npm run index-audit:postgres",
        "",
        "  For the SQLite side of the comparison: npm run index-audit:local",
      ].join("\n"));
      process.exit(2);
    }
    databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL || POSTGRES_URL;
    if (!process.env.POSTGRES_TEST_DATABASE_URL) {
      console.log("Starting disposable PostgreSQL on 127.0.0.1:55432 ...");
      run("docker", ["compose", "-f", composeFile, "up", "-d", "--wait"]);
      teardown.push(() => {
        console.log("Removing disposable PostgreSQL ...");
        spawnSync("docker", ["compose", "-f", composeFile, "down", "-v"], { cwd: backendRoot, stdio: "inherit" });
      });
    }
  } else {
    databaseUrl = `file:${sqliteFile}`;
    teardown.push(() => {
      for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${sqliteFile}${suffix}`, { force: true });
    });
  }

  const env = buildTestEnv({
    TEST_DATABASE_URL: databaseUrl,
    DATABASE_URL: databaseUrl,
    ...(usePostgres ? { ALLOW_POSTGRES_TEST_DB: "true", DIRECT_DATABASE_URL: databaseUrl } : {}),
    FORCE_DB_TESTS: "true",
    PRISMA_CLIENT_VARIANT: "integration",
    LOG_LEVEL: process.env.LOG_LEVEL || "silent",
    // The audit builds and drops indexes and writes its own rows; it needs the
    // ordinary application paths, not the ones that refuse to run outside tests.
    ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION: "true",
  });

  console.log(`Preparing ${usePostgres ? "PostgreSQL" : "SQLite"} audit database ...`);
  run(process.execPath, ["scripts/setup-test-db.js"], { env });
  run(process.execPath, ["scripts/index-audit.js"], { env });
}

try {
  await main();
} catch (err) {
  console.error(err.message || err);
  exitCode = 1;
} finally {
  for (const step of teardown.reverse()) {
    try { await step(); } catch (err) { console.error(`teardown: ${err.message || err}`); }
  }
  process.exit(exitCode || process.exitCode || 0);
}
