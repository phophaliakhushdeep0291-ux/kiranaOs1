import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const pkg = JSON.parse(read("package.json"));
const runner = read("scripts/release-certification.js");
const workflowPath = "../.github/workflows/release-certification.yml";

assert.ok(fs.existsSync(workflowPath), "release CI must live at repository-root .github/workflows");
for (const script of ["release:certify", "release:certify:ci", "release:certify:local"]) {
  assert.ok(pkg.scripts[script], `package.json must expose ${script}`);
}
assert.ok(pkg.scripts.posttest.includes("test:accounting-documents"), "the required backend gate must cover OCR-to-journal audit atomicity");
for (const status of ["passed", "failed", "blocked", "skipped"]) {
  assert.ok(runner.includes(`\"${status}\"`), `certification report must represent ${status} checks`);
}
assert.ok(
  runner.includes('SKIP_PRISMA_GENERATE: "true"'),
  "local certification must reuse its prepared isolated client between DB-backed suites"
);
assert.ok(
  runner.includes('PRISMA_CLIENT_VARIANT: "certification"'),
  "release certification must not contend with a live integration client's Windows query-engine DLL"
);
assert.match(
  runner,
  /release-certification-\$\{process\.pid\}-\$\{Date\.now\(\)\}\.db/,
  "parallel certification runs must own distinct SQLite databases"
);
assert.ok(
  !runner.includes('const sqliteTestUrl = "file:.\/release-certification.db"'),
  "certification must never return to one shared SQLite database"
);
for (const ownershipGuard of [".release-certification.lock", "processIsRunning", "acquireCertificationLock", "releaseCertificationLock"]) {
  assert.ok(runner.includes(ownershipGuard), `certification must retain its ${ownershipGuard} concurrency guard`);
}
assert.ok(
  runner.indexOf("acquireCertificationLock();") < runner.indexOf('id: "prisma-sqlite-validate"'),
  "certification must acquire exclusive ownership before its first mutable test step",
);
for (const snapshotGuard of [
  "repositoryFingerprint",
  'gitBuffer(["diff", "--binary", "HEAD"])',
  'gitBuffer(["ls-files", "--others", "--exclude-standard", "-z"])',
  "source-snapshot-stability",
]) {
  assert.ok(runner.includes(snapshotGuard), `certification must retain its ${snapshotGuard} source-stability guard`);
}
assert.ok(
  !runner.includes('|| commandAvailable("docker", ["--version"])'),
  "a Docker CLI without a running engine must not be reported as build-capable",
);
for (const suffix of ['""', '"-journal"', '"-wal"', '"-shm"']) {
  assert.ok(runner.includes(suffix), `certification cleanup must remove SQLite ${suffix || "main"} artifacts`);
}
for (const id of ["backend-source-db", "backend-tests", "backend-warehouse", "backend-integration-sqlite", "ai-safety"]) {
  const step = runner.match(new RegExp(`id: "${id}"[\\s\\S]*?\\n\\}\\);`))?.[0] ?? "";
  assert.match(step, /POSTGRES_TEST_DATABASE_URL: ""/, `${id} must not accidentally use the workflow PostgreSQL database`);
  assert.match(step, /DIRECT_DATABASE_URL: ""/, `${id} must not retain a direct PostgreSQL escape hatch while certifying SQLite`);
}
for (const evidence of [
  "frontend-production-check",
  "backend-warehouse",
  "backend-integration-sqlite",
  "ai-safety",
  "hardware-bridge-contracts",
  "postgres-production-proof",
  "redis-worker-runtime",
  "cloud-storage-proof",
  "disaster-recovery-proof",
  "docker-build",
  "release-certification-latest.json",
  "release-certification-latest.md",
]) {
  assert.ok(runner.includes(evidence), `certification runner must capture ${evidence}`);
}

const workflow = read(workflowPath);
for (const snippet of [
  "working-directory: backend",
  "working-directory: frontend",
  "npm run release:certify:ci",
  "postgres:16-alpine",
  "redis:7-alpine",
  "QUEUES_ENABLED: \"true\"",
  "actions/upload-artifact@v4",
]) {
  assert.ok(workflow.includes(snippet), `root release workflow must include ${snippet}`);
}

const compose = read("docker-compose.yml");
const apiService = compose.match(/\r?\n  api:\r?\n[\s\S]*?\r?\n  worker:/)?.[0] ?? "";
assert.ok(apiService.includes('QUEUES_ENABLED: "true"'), "Compose API must enqueue work when the worker is enabled");

const storageVerifier = read("scripts/verify-object-storage.js");
assert.ok(storageVerifier.includes("STORAGE_DELETE_VERIFICATION_FAILED"), "storage verification must distinguish missing objects from read failures");

console.log("Release certification examples passed");
