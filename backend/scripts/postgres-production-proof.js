import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
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

const proofStartedAt = new Date();
const proofStamp = proofStartedAt.toISOString().replace(/[:.]/g, "-");
const reportPath = path.resolve(
  process.env.POSTGRES_PROOF_REPORT_PATH ||
    path.join(process.cwd(), "release-artifacts", `postgres-production-proof-${proofStamp}.json`)
);
const latestReportPath = path.join(path.dirname(reportPath), "postgres-production-proof-latest.json");
const results = [];

function readGitValue(args) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8", shell: false });
  return result.status === 0 ? String(result.stdout || "").trim() || null : null;
}

function migrationInventory() {
  const migrationsDir = path.join(process.cwd(), "prisma-postgres", "migrations");
  const directories = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return {
    directoryCount: directories.length,
    first: directories[0] || null,
    last: directories.at(-1) || null,
  };
}

function safeDatabaseIdentity(url) {
  const parsed = new URL(url);
  return {
    protocol: parsed.protocol.replace(":", ""),
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: parsed.pathname.replace(/^\//, ""),
    schema: parsed.searchParams.get("schema") || "public",
    maskedUrl: maskDatabaseUrl(url),
  };
}

function writeReport(status, failure = null) {
  const completedAt = new Date();
  const report = {
    schemaVersion: 1,
    type: "kiranaos_postgres_production_proof",
    status,
    startedAt: proofStartedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - proofStartedAt.getTime(),
    repository: {
      commit: readGitValue(["rev-parse", "HEAD"]),
      branch: readGitValue(["branch", "--show-current"]),
      dirty: Boolean(readGitValue(["status", "--porcelain"])),
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    database: safeDatabaseIdentity(postgresUrl),
    migrations: migrationInventory(),
    staticChecksAlreadyRan,
    results,
    failure,
    limitations: [
      "This proves an isolated PostgreSQL runtime; it is not evidence of a deployed production environment.",
      "Redis worker, cloud object storage, disaster recovery, Docker image, and live payment-provider traffic require separate proofs.",
    ],
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(reportPath, serialized, "utf8");
  if (latestReportPath !== reportPath) fs.writeFileSync(latestReportPath, serialized, "utf8");
  return report;
}

const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: postgresUrl,
  DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL || postgresUrl,
  TEST_DATABASE_URL: postgresUrl,
  POSTGRES_TEST_DATABASE_URL: postgresUrl,
  FORCE_DB_TESTS: process.env.FORCE_DB_TESTS || "true",
  JWT_SECRET: process.env.JWT_SECRET || "postgres-proof-jwt-secret-change-me-1234567890",
  LICENSE_SIGNING_SECRET: process.env.LICENSE_SIGNING_SECRET || "postgres-proof-license-secret-change-me-1234567890",
  ENABLE_DEVICE_LICENSE_SIGNING: process.env.ENABLE_DEVICE_LICENSE_SIGNING || "true",
  RAZORPAY_ENABLED: process.env.RAZORPAY_ENABLED || "false",
  LOG_LEVEL: process.env.LOG_LEVEL || "silent",
};

// `prisma validate`, contract:check and prod:check read files only — no
// database — so under the release-certification harness, which has already run
// all three earlier in the same job, a second run cannot reach a different
// verdict. On a billed two-core runner that repetition is pure cost, so the
// harness sets this flag to skip it. Run standalone, the flag is unset and the
// proof still performs every check itself.
const staticChecksAlreadyRan = process.env.RELEASE_CERT_STATIC_ALREADY_RAN === "true";

const commands = [
  { id: "prisma-client", command: "npm", args: ["run", "prisma:generate:postgres"], label: "Generate Prisma client from PostgreSQL schema" },
  ...(staticChecksAlreadyRan
    ? []
    : [{ id: "schema-validation", command: "node", args: ["node_modules/prisma/build/index.js", "validate", "--schema", "prisma-postgres/schema.prisma"], label: "Validate PostgreSQL Prisma schema" }]),
  { id: "database-reset", command: "npm", args: ["run", "setup:test-db"], label: "Reset isolated PostgreSQL test database" },
  { id: "integration-concurrency", command: "npm", args: ["run", "test:integration"], label: "Run DB-backed integration and concurrency tests" },
  {
    id: "payment-provider-connections",
    command: "node",
    args: ["scripts/run-db-example-tests.js", "tests/payment-provider-connections.examples.js"],
    label: "Prove tenant-owned payment credentials and audit rollback on PostgreSQL",
  },
  { id: "money-paise-reconciliation", command: "npm", args: ["run", "money:paise:reconcile"], label: "Reconcile rupee Float columns with paise shadow columns" },
  ...(staticChecksAlreadyRan
    ? []
    : [
        { id: "api-contract", command: "npm", args: ["run", "contract:check"], label: "Check API contract" },
        { id: "production-static", command: "npm", args: ["run", "prod:check"], label: "Run production static checks" },
      ]),
];

console.log(`PostgreSQL proof database: ${maskDatabaseUrl(postgresUrl)}`);
console.log("This command is destructive and should only target an isolated *_test or *_ci database.\n");

function runCommand(command, args) {
  if (command === "node") {
    return spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      shell: false,
    });
  }
  if (command === "npm" && process.env.npm_execpath) {
    return spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      shell: false,
    });
  }
  return spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

for (const step of commands) {
  console.log(`\n▶ ${step.label}`);
  const startedAt = Date.now();
  const result = runCommand(step.command, step.args);
  const stepResult = {
    id: step.id,
    label: step.label,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status ?? 1,
    durationMs: Date.now() - startedAt,
  };
  results.push(stepResult);
  writeReport(result.status === 0 ? "running" : "failed", result.status === 0 ? null : {
    stepId: step.id,
    message: result.error?.message || `Command exited with status ${result.status ?? 1}`,
  });
  if (result.status !== 0) {
    console.error(`\n❌ Failed: ${step.label}`);
    console.error(`PostgreSQL proof report: ${reportPath}`);
    process.exit(result.status || 1);
  }
}

writeReport("passed");
console.log("\n✅ PostgreSQL production proof passed.");
console.log(`PostgreSQL proof report: ${reportPath}`);
