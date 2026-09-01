#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const backendDir = process.cwd();
const repoRoot = path.resolve(backendDir, "..");
const frontendDir = path.join(repoRoot, "frontend");
const hardwareBridgeDir = path.join(repoRoot, "hardware-bridge");
const artifactDir = path.join(backendDir, "release-artifacts");
const certificationLockDir = path.join(artifactDir, ".release-certification.lock");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const mode = (modeArg?.split("=")[1] || process.env.RELEASE_CERT_MODE || "strict").toLowerCase();
const validModes = new Set(["local", "ci", "strict"]);

if (!validModes.has(mode)) {
  console.error(`Unknown release certification mode: ${mode}. Expected local, ci, or strict.`);
  process.exit(2);
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const logDir = path.join(artifactDir, "logs", runId);
fs.mkdirSync(logDir, { recursive: true });

// A certification run must own its database. The old fixed
// `release-certification.db` let two perfectly valid runs reset each other's
// shops mid-test, which surfaced as random User/Session/AuditLog foreign-key
// failures across otherwise unrelated suites. PID + start time also keeps a
// stale file from an interrupted run from becoming the next run's input.
const sqliteTestName = `release-certification-${process.pid}-${Date.now()}.db`;
const sqliteTestPath = path.join(backendDir, "prisma", sqliteTestName);
const sqliteTestUrl = `file:${sqliteTestPath.replace(/\\/g, "/")}`;
const results = [];
let certificationLockHeld = false;

function boolEnv(name) {
  return String(process.env[name] || "").toLowerCase() === "true";
}

function commandText(command, args = []) {
  return [command, ...args].map((value) => (/\s/.test(value) ? JSON.stringify(value) : value)).join(" ");
}

function safeGit(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", shell: false });
  return result.status === 0 ? result.stdout.trim() : null;
}

function gitBuffer(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: null,
    shell: false,
    maxBuffer: 128 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

function repositoryFingerprint() {
  const trackedState = gitBuffer(["diff", "--binary", "HEAD"]);
  const untrackedList = gitBuffer(["ls-files", "--others", "--exclude-standard", "-z"]);
  const commit = gitBuffer(["rev-parse", "HEAD"]);
  if (!trackedState || !untrackedList || !commit) return null;

  const hash = createHash("sha256");
  hash.update(commit);
  hash.update(trackedState);

  const untrackedFiles = untrackedList.toString("utf8").split("\0").filter(Boolean).sort();
  for (const relativePath of untrackedFiles) {
    const absolutePath = path.resolve(repoRoot, relativePath);
    const relativeToRoot = path.relative(repoRoot, absolutePath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return null;
    try {
      hash.update(relativePath);
      hash.update("\0");
      hash.update(fs.readFileSync(absolutePath));
      hash.update("\0");
    } catch {
      // A disappearing file means the source is changing while it is sampled.
      return null;
    }
  }
  return hash.digest("hex");
}

function commandAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, { cwd: backendDir, encoding: "utf8", shell: false });
  return result.status === 0;
}

function isRequired(requiredFor = ["local", "ci", "strict"]) {
  return requiredFor.includes(mode);
}

function tail(value, lines = 30) {
  return String(value || "").split(/\r?\n/).slice(-lines).join("\n").trim();
}

function addSyntheticResult({ id, label, status, reason, requiredFor }) {
  const required = isRequired(requiredFor);
  results.push({ id, label, status, required, reason, durationMs: 0 });
  const marker = status === "passed" ? "PASS" : status === "failed" ? "FAIL" : status === "blocked" ? "BLOCKED" : "SKIP";
  console.log(`[${marker}] ${label}${reason ? ` - ${reason}` : ""}`);
}

function runStep({
  id,
  label,
  command = npmCommand,
  args = [],
  cwd = backendDir,
  env = {},
  requiredFor = ["local", "ci", "strict"],
  configured = true,
  blockedReason = "Required configuration is missing",
}) {
  const required = isRequired(requiredFor);
  if (!configured) {
    const status = required ? "blocked" : "skipped";
    results.push({ id, label, status, required, reason: blockedReason, durationMs: 0 });
    console.log(`[${status.toUpperCase()}] ${label} - ${blockedReason}`);
    return;
  }

  const startedAt = Date.now();
  const logPath = path.join(logDir, `${String(results.length + 1).padStart(2, "0")}-${id}.log`);
  console.log(`[RUN] ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command),
    maxBuffer: 64 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;
  const output = [
    `$ ${commandText(command, args)}`,
    `cwd=${cwd}`,
    "",
    result.stdout || "",
    result.stderr || "",
    result.error ? String(result.error.stack || result.error.message || result.error) : "",
  ].join("\n");
  fs.writeFileSync(logPath, output, "utf8");

  if (result.status === 0 && !result.error) {
    results.push({ id, label, status: "passed", required, durationMs, logPath: path.relative(backendDir, logPath) });
    console.log(`[PASS] ${label} (${Math.round(durationMs / 100) / 10}s)`);
    return;
  }

  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  results.push({
    id,
    label,
    status: "failed",
    required,
    durationMs,
    exitCode,
    error: result.error?.message || tail(result.stderr || result.stdout),
    logPath: path.relative(backendDir, logPath),
  });
  console.error(`[FAIL] ${label} (exit ${exitCode})`);
  const failureTail = tail(result.stderr || result.stdout);
  if (failureTail) console.error(failureTail);
}

function writeReports(metadata) {
  const failed = results.filter((result) => result.required && result.status === "failed");
  const blocked = results.filter((result) => result.required && result.status === "blocked");
  const status = failed.length ? "failed" : blocked.length ? "blocked" : mode === "strict" ? "certified" : `${mode}-passed`;
  const report = {
    schemaVersion: 1,
    type: "kiranaos_release_certification",
    status,
    mode,
    startedAt: metadata.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - metadata.startedAtMs,
    repository: metadata.repository,
    runtime: metadata.runtime,
    infrastructure: metadata.infrastructure,
    summary: {
      passed: results.filter((result) => result.status === "passed").length,
      failed: results.filter((result) => result.status === "failed").length,
      blocked: results.filter((result) => result.status === "blocked").length,
      skipped: results.filter((result) => result.status === "skipped").length,
    },
    results,
  };

  const json = `${JSON.stringify(report, null, 2)}\n`;
  const mdRows = results.map((result) => {
    const detail = String(result.reason || result.error || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    return `| ${result.label} | ${result.required ? "yes" : "no"} | ${result.status} | ${Math.round(result.durationMs / 100) / 10}s | ${detail} |`;
  });
  const markdown = [
    "# KiranaOS Release Certification",
    "",
    `- Status: **${status}**`,
    `- Mode: **${mode}**`,
    `- Commit: \`${metadata.repository.commit || "unknown"}\``,
    `- Branch: \`${metadata.repository.branch || "unknown"}\``,
    `- Working tree dirty: **${metadata.repository.dirty ? "yes" : "no"}**`,
    `- Started: ${metadata.startedAt}`,
    `- Completed: ${report.completedAt}`,
    "",
    "| Check | Required | Status | Duration | Detail |",
    "| --- | --- | --- | ---: | --- |",
    ...mdRows,
    "",
    "Strict certification succeeds only when live API, PostgreSQL, Redis worker, cloud object storage, Docker, disaster recovery, approval, and rollback evidence all pass.",
    "",
  ].join("\n");

  const jsonPath = path.join(artifactDir, `release-certification-${runId}.json`);
  const mdPath = path.join(artifactDir, `release-certification-${runId}.md`);
  fs.writeFileSync(jsonPath, json, "utf8");
  fs.writeFileSync(mdPath, markdown, "utf8");
  fs.writeFileSync(path.join(artifactDir, "release-certification-latest.json"), json, "utf8");
  fs.writeFileSync(path.join(artifactDir, "release-certification-latest.md"), markdown, "utf8");

  if (mode === "local" && status === "local-passed") {
    const durableEvidenceDir = path.join(repoRoot, "docs", "evidence");
    fs.mkdirSync(durableEvidenceDir, { recursive: true });
    fs.writeFileSync(path.join(durableEvidenceDir, "local-release-certification-latest.json"), json, "utf8");
  }

  console.log(`Release report: ${jsonPath}`);
  console.log(`Human report:  ${mdPath}`);
  return { report, exitCode: failed.length || blocked.length ? 1 : 0 };
}

const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const gitStatus = safeGit(["status", "--porcelain"]);
const repository = {
  commit: safeGit(["rev-parse", "HEAD"]),
  branch: safeGit(["branch", "--show-current"]),
  dirty: Boolean(gitStatus),
};
const startingRepositoryFingerprint = repositoryFingerprint();

const liveBaseUrl = process.env.PROOF_BASE_URL || process.env.CONTRACT_SMOKE_BASE_URL || process.env.SMOKE_BASE_URL || "";
const postgresUrl = process.env.POSTGRES_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL || "";
const hasPostgres = /^postgres(?:ql)?:\/\//i.test(postgresUrl);
const queuesEnabled = boolEnv("QUEUES_ENABLED");
const hasRedis = queuesEnabled && Boolean(process.env.REDIS_URL);
const storageProvider = String(process.env.STORAGE_PROVIDER || "local").toLowerCase();
const hasCloudStorage = storageProvider !== "local" && Boolean(process.env.STORAGE_BUCKET && process.env.STORAGE_ACCESS_KEY_ID && process.env.STORAGE_SECRET_ACCESS_KEY);
const hasRestore = Boolean(process.env.RESTORE_TEST_DATABASE_URL) && boolEnv("ALLOW_RESTORE_TEST_DB");
// `docker --version` proves only that the CLI is installed. Image proof needs a
// reachable engine; treating a client-only install as configured produced a
// misleading failed build instead of an explicit unavailable/blocked result.
const hasDocker = commandAvailable("docker", ["version", "--format", "{{.Server.Version}}"]) ;
const releaseMetadataReady = boolEnv("RELEASE_APPROVED") && Boolean(process.env.RELEASE_VERSION && process.env.RELEASE_APPROVER && process.env.RELEASE_ROLLBACK_IMAGE);

const metadata = {
  startedAt,
  startedAtMs,
  repository,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  infrastructure: {
    postgresConfigured: hasPostgres,
    redisWorkerConfigured: hasRedis,
    liveApiConfigured: Boolean(liveBaseUrl),
    cloudStorageConfigured: hasCloudStorage,
    restoreDrillConfigured: hasRestore,
    dockerAvailable: hasDocker,
    releaseMetadataConfigured: releaseMetadataReady,
  },
};

// Own the mutable generated Prisma client and the certification database for
// the whole run, not merely while the final report is written.
acquireCertificationLock();
certificationLockHeld = true;
process.once("exit", releaseCertificationLock);

console.log(`KiranaOS release certification (${mode})`);
console.log(`Commit: ${repository.commit || "unknown"}${repository.dirty ? " (dirty)" : ""}`);

addSyntheticResult({
  id: "release-metadata",
  label: "Release approval and rollback metadata",
  status: releaseMetadataReady ? "passed" : mode === "strict" ? "blocked" : "skipped",
  reason: releaseMetadataReady ? "" : "set RELEASE_VERSION, RELEASE_APPROVER, RELEASE_APPROVED=true, and RELEASE_ROLLBACK_IMAGE",
  requiredFor: ["strict"],
});

runStep({
  id: "prisma-sqlite-validate",
  label: "Validate SQLite Prisma schema",
  command: process.execPath,
  args: ["node_modules/prisma/build/index.js", "validate", "--schema", "prisma/schema.prisma"],
  env: { DATABASE_URL: sqliteTestUrl },
});
runStep({
  id: "prisma-postgres-validate",
  label: "Validate PostgreSQL Prisma schema",
  command: process.execPath,
  args: ["node_modules/prisma/build/index.js", "validate", "--schema", "prisma-postgres/schema.prisma"],
  env: {
    DATABASE_URL: "postgresql://release:release@127.0.0.1:5432/kiranaos_release_validation",
    DIRECT_DATABASE_URL: "postgresql://release:release@127.0.0.1:5432/kiranaos_release_validation",
  },
});
runStep({ id: "migration-safety", label: "Migration safety and sequence", args: ["run", "migration:safety"] });
runStep({ id: "release-gate", label: "Release documentation and rollback gate", args: ["run", "release:gate"] });
runStep({
  id: "backend-source-db",
  label: "Prepare isolated database for source-level tests",
  command: process.execPath,
  args: ["scripts/setup-test-db.js"],
  env: {
    NODE_ENV: "test",
    DATABASE_URL: sqliteTestUrl,
    TEST_DATABASE_URL: sqliteTestUrl,
    // The workflow exposes PostgreSQL globally for its dedicated proof below.
    // DB example helpers intentionally prefer POSTGRES_TEST_DATABASE_URL when
    // present, so clear it here or this supposedly isolated SQLite suite runs
    // against PostgreSQL a first time and then proof:postgres repeats it.
    POSTGRES_TEST_DATABASE_URL: "",
    DIRECT_DATABASE_URL: "",
    PRISMA_CLIENT_VARIANT: "certification",
    FORCE_DB_TESTS: "true",
  },
});
runStep({
  id: "backend-tests",
  label: "Backend source and calculation tests",
  args: ["test"],
  env: {
    NODE_ENV: "test",
    DATABASE_URL: sqliteTestUrl,
    TEST_DATABASE_URL: sqliteTestUrl,
    POSTGRES_TEST_DATABASE_URL: "",
    DIRECT_DATABASE_URL: "",
    PRISMA_CLIENT_VARIANT: "certification",
    FORCE_DB_TESTS: "true",
    // backend-source-db generated the isolated client immediately above. The
    // DB-example runner resets data repeatedly, but regenerating the same
    // Windows query-engine DLL while a just-finished test still releases it is
    // racy (EPERM). Reuse the already validated client throughout this stage.
    SKIP_PRISMA_GENERATE: "true",
    LOG_LEVEL: "silent",
  },
});
runStep({
  id: "backend-warehouse",
  label: "Warehouse bins, repack, and replenishment workflows",
  args: ["run", "test:warehouse"],
  env: {
    NODE_ENV: "test",
    DATABASE_URL: sqliteTestUrl,
    TEST_DATABASE_URL: sqliteTestUrl,
    POSTGRES_TEST_DATABASE_URL: "",
    DIRECT_DATABASE_URL: "",
    PRISMA_CLIENT_VARIANT: "certification",
    FORCE_DB_TESTS: "true",
    SKIP_PRISMA_GENERATE: "true",
    LOG_LEVEL: "silent",
  },
});
runStep({
  id: "backend-integration-sqlite",
  label: "Backend regression and integration tests (isolated SQLite)",
  command: process.execPath,
  args: ["scripts/run-integration-tests.js"],
  env: {
    NODE_ENV: "test",
    DATABASE_URL: sqliteTestUrl,
    TEST_DATABASE_URL: sqliteTestUrl,
    POSTGRES_TEST_DATABASE_URL: "",
    DIRECT_DATABASE_URL: "",
    PRISMA_CLIENT_VARIANT: "certification",
    FORCE_DB_TESTS: "true",
    SKIP_PRISMA_GENERATE: mode === "local" ? "true" : "false",
    LOG_LEVEL: "silent",
  },
});
runStep({ id: "backend-production-check", label: "Backend production readiness checks", args: ["run", "prod:check"] });
runStep({
  id: "ai-safety",
  label: "AI command and diagnostic hallucination safety gates",
  args: ["run", "test:ai-safety"],
  env: {
    NODE_ENV: "test",
    DATABASE_URL: sqliteTestUrl,
    TEST_DATABASE_URL: sqliteTestUrl,
    POSTGRES_TEST_DATABASE_URL: "",
    DIRECT_DATABASE_URL: "",
    PRISMA_CLIENT_VARIANT: "certification",
    FORCE_DB_TESTS: "true",
    SKIP_PRISMA_GENERATE: "true",
    LOG_LEVEL: "silent",
  },
});
runStep({ id: "api-contract", label: "Static API contract proof", args: ["run", "contract:check"] });
runStep({ id: "razorpay-fixtures", label: "Razorpay signature fixture proof", args: ["run", "razorpay:fixtures"] });
runStep({
  id: "hardware-bridge-contracts",
  label: "Paired hardware bridge protocol, pairing, recovery, and installer contracts",
  args: ["test"],
  cwd: hardwareBridgeDir,
});
runStep({
  id: "frontend-production-check",
  label: "Frontend typecheck, tests, build, and security checks",
  args: ["run", "prod:check"],
  cwd: frontendDir,
  // The workflow-level NODE_ENV is "test" for backend suites. Vite respects
  // an existing NODE_ENV and otherwise emits an unminified test build.
  env: {
    NODE_ENV: "production",
    // Production URL validation remains active while reliability tests use a
    // deterministic, non-routable CI endpoint instead of failing at startup.
    VITE_API_BASE_URL: process.env.VITE_API_BASE_URL || "http://127.0.0.1:3000",
  },
});
runStep({
  id: "local-storage-proof",
  label: "Local object storage read/write/delete proof",
  args: ["run", "storage:verify"],
  env: { NODE_ENV: "test", DATABASE_URL: sqliteTestUrl, STORAGE_PROVIDER: "local" },
});

runStep({
  id: "postgres-production-proof",
  label: "PostgreSQL migrations, regression, integration, concurrency, and reconciliation",
  args: ["run", "proof:postgres"],
  requiredFor: ["ci", "strict"],
  configured: hasPostgres,
  blockedReason: "set POSTGRES_TEST_DATABASE_URL to an isolated *_test or *_ci database",
  // This proof always targets an isolated test database. Exercise the guarded
  // legacy-money backfill, then verify every paise shadow column is consistent.
  //
  // The schema validate, contract check and production check above are static —
  // they read files, never the database — so the proof is told not to repeat
  // them. What stays is everything that genuinely needs PostgreSQL: migrations,
  // integration and concurrency tests, and the paise reconciliation.
  env: { ALLOW_MONEY_PAISE_BACKFILL: "true", RELEASE_CERT_STATIC_ALREADY_RAN: "true" },
});
runStep({
  id: "redis-worker-runtime",
  label: "Redis queue and worker execution proof",
  args: ["run", "worker:verify"],
  requiredFor: ["ci", "strict"],
  configured: hasRedis,
  blockedReason: "set QUEUES_ENABLED=true and REDIS_URL",
});
runStep({
  id: "worker-heartbeat",
  label: "Deployed worker heartbeat freshness",
  args: ["run", "worker:health"],
  requiredFor: ["strict"],
  configured: hasRedis && boolEnv("PROOF_REQUIRE_WORKER"),
  blockedReason: "start the production worker and set PROOF_REQUIRE_WORKER=true with Redis configured",
});
runStep({
  id: "live-api-contract",
  label: "Live API contract smoke",
  args: ["run", "contract:smoke"],
  requiredFor: ["strict"],
  configured: Boolean(liveBaseUrl),
  blockedReason: "set PROOF_BASE_URL or CONTRACT_SMOKE_BASE_URL",
  env: { CONTRACT_SMOKE_BASE_URL: liveBaseUrl, SMOKE_BASE_URL: liveBaseUrl },
});
runStep({
  id: "live-api-smoke",
  label: "Live backend workflow smoke",
  args: ["run", "smoke:test"],
  requiredFor: ["strict"],
  configured: Boolean(liveBaseUrl),
  blockedReason: "set PROOF_BASE_URL or SMOKE_BASE_URL",
  env: { SMOKE_BASE_URL: liveBaseUrl },
});
runStep({
  id: "cloud-storage-proof",
  label: "Production object storage signed URL and cleanup proof",
  args: ["run", "storage:verify"],
  requiredFor: ["strict"],
  configured: hasCloudStorage,
  blockedReason: "configure a non-local STORAGE_PROVIDER and its bucket credentials",
  env: { ALLOW_PRODUCTION_STORAGE_VERIFY: "true" },
});
runStep({
  id: "disaster-recovery-proof",
  label: "PostgreSQL backup and isolated restore drill",
  args: ["run", "proof:dr"],
  requiredFor: ["strict"],
  configured: hasRestore,
  blockedReason: "set RESTORE_TEST_DATABASE_URL and ALLOW_RESTORE_TEST_DB=true",
});
// The image build is the most expensive step in a certification run. On a
// private repo, paying for it on every merge is what exhausts the Actions
// allowance, so the workflow defers it to the weekly and manual runs. Deferral
// is reported as a skip with its reason — never as a pass — and strict
// certification still requires the image, so a release is never certified
// without one.
const skipImageProof = boolEnv("RELEASE_CERT_SKIP_IMAGE");

runStep({
  id: "docker-build",
  label: "Production Docker image build",
  args: ["run", "docker:build"],
  requiredFor: skipImageProof ? ["strict"] : ["ci", "strict"],
  configured: hasDocker && !skipImageProof,
  blockedReason: skipImageProof
    ? "deferred to the scheduled/manual certification run (RELEASE_CERT_SKIP_IMAGE)"
    : "Docker engine is unavailable",
});

for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  try {
    fs.rmSync(`${sqliteTestPath}${suffix}`, { force: true });
  } catch {}
}

const endingRepositoryFingerprint = repositoryFingerprint();
const sourceSnapshotStable = Boolean(
  startingRepositoryFingerprint
  && endingRepositoryFingerprint
  && startingRepositoryFingerprint === endingRepositoryFingerprint
);
addSyntheticResult({
  id: "source-snapshot-stability",
  label: "Source snapshot remained stable throughout certification",
  status: sourceSnapshotStable ? "passed" : "failed",
  reason: sourceSnapshotStable
    ? ""
    : "repository content changed during certification; rerun against one stable source snapshot",
});

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireCertificationLock() {
  fs.mkdirSync(artifactDir, { recursive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.mkdirSync(certificationLockDir);
      fs.writeFileSync(path.join(certificationLockDir, "owner.json"), `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let owner = null;
      try { owner = JSON.parse(fs.readFileSync(path.join(certificationLockDir, "owner.json"), "utf8")); } catch {}
      if (processIsRunning(Number(owner?.pid))) {
        console.error(`Another release certification is already running (PID ${owner.pid}).`);
        process.exit(2);
      }
      // An interrupted process can leave only this small ownership directory.
      // Remove it after proving its PID is no longer alive, then retry mkdir.
      fs.rmSync(certificationLockDir, { recursive: true, force: true });
    }
  }
  throw new Error("Could not acquire the release certification lock");
}

function releaseCertificationLock() {
  if (!certificationLockHeld) return;
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(certificationLockDir, "owner.json"), "utf8"));
    if (Number(owner?.pid) !== process.pid) return;
  } catch {
    return;
  }
  certificationLockHeld = false;
  fs.rmSync(certificationLockDir, { recursive: true, force: true });
}

const { report, exitCode } = writeReports(metadata);
console.log(`Certification status: ${report.status}`);
process.exit(exitCode);
