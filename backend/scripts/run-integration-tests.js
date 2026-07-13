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
const files = fs.readdirSync(integrationDir)
  .filter((name) => name.endsWith(".integration.test.js"))
  .sort()
  .map((name) => path.join("tests", "integration", name));

if (!files.length) {
  console.error("No integration test files found under tests/integration");
  process.exit(1);
}

const env = buildTestEnv();

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

const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});

process.exit(result.status || 0);
