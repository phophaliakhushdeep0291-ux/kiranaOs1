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
const apiService = compose.match(/\n  api:\n[\s\S]*?\n  worker:/)?.[0] ?? "";
assert.ok(apiService.includes('QUEUES_ENABLED: "true"'), "Compose API must enqueue work when the worker is enabled");

const storageVerifier = read("scripts/verify-object-storage.js");
assert.ok(storageVerifier.includes("STORAGE_DELETE_VERIFICATION_FAILED"), "storage verification must distinguish missing objects from read failures");

console.log("Release certification examples passed");
