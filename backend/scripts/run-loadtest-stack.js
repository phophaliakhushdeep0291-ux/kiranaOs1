/**
 * Run the load test against a disposable database, end to end.
 *
 * Brings up the database, pushes the schema, starts the API against it, waits for
 * health, runs loadtest/loadtest.js, then tears everything down. Nothing touches
 * the shared development database.
 *
 * Usage:
 *   npm run loadtest:local              # disposable SQLite file
 *   npm run loadtest:local -- --smoke   # 5s/10conn
 *   npm run loadtest:postgres           # disposable PostgreSQL in Docker
 *   LOADTEST_SEED_BILLS=1500 npm run loadtest:postgres
 *
 * Flags after `--` are passed through to loadtest.js.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildTestEnv } from "./test-db-utils.js";

const argv = process.argv.slice(2);
const usePostgres = argv.includes("--postgres");
const loadtestArgs = argv.filter((arg) => arg !== "--postgres");

const backendRoot = path.resolve(process.cwd());
const composeFile = path.join("loadtest", "docker-compose.loadtest.yml");
const POSTGRES_URL = "postgresql://kiranaos:loadtest@127.0.0.1:55432/kiranaos_loadtest";
const PORT = Number(process.env.LOADTEST_PORT || 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const sqliteFile = path.join(backendRoot, "prisma", `loadtest-${process.pid}.db`);

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

async function waitForHealth(url, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function main() {
  let databaseUrl;

  if (usePostgres) {
    if (!dockerAvailable()) {
      console.error([
        "Docker is not available, so the disposable PostgreSQL cannot be started.",
        "",
        "  Install Docker Desktop (or colima/podman with a docker-compatible CLI) and retry,",
        "  or point at a PostgreSQL you already have:",
        "",
        "    POSTGRES_TEST_DATABASE_URL=postgresql://user:pass@host:5432/db \\",
        "      npm run loadtest:postgres",
        "",
        "  For a SQLite run instead: npm run loadtest:local",
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
    PORT: String(PORT),
    // Otherwise the run measures the rate limiter rather than the API.
    API_RATE_LIMIT_MAX: process.env.API_RATE_LIMIT_MAX || "1000000",
    AUTH_RATE_LIMIT_MAX: process.env.AUTH_RATE_LIMIT_MAX || "100000",
    DEV_MAX_ACTIVE_DEVICES: process.env.DEV_MAX_ACTIVE_DEVICES || "50",
    LOG_LEVEL: process.env.LOG_LEVEL || "silent",
  });

  console.log(`Preparing ${usePostgres ? "PostgreSQL" : "SQLite"} load-test database ...`);
  run(process.execPath, ["scripts/setup-test-db.js"], { env });

  console.log(`Starting API on ${BASE_URL} ...`);
  const server = spawn(process.execPath, ["src/server.js"], { cwd: backendRoot, env, stdio: "inherit" });
  const serverExited = new Promise((resolve) => server.once("exit", resolve));
  let stoppingServer = false;
  // Wait for the process to actually be gone. Returning early lets SQLite recreate
  // the database file during shutdown, after teardown has already deleted it.
  teardown.push(async () => {
    stoppingServer = true;
    if (!server.killed) server.kill("SIGTERM");
    await Promise.race([serverExited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  });
  server.on("exit", (code) => {
    if (!stoppingServer && code !== 0 && code !== null) {
      console.error(`API exited early (code ${code}).`);
      process.exitCode = 2;
    }
  });

  if (!await waitForHealth(BASE_URL)) throw new Error(`API never became healthy at ${BASE_URL}`);

  run(process.execPath, ["loadtest/loadtest.js", ...loadtestArgs], {
    env: { ...env, LOADTEST_BASE_URL: BASE_URL },
  });
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
