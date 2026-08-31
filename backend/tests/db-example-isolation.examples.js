import assert from "node:assert/strict";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const runner = fs.readFileSync("scripts/run-db-example-tests.js", "utf8");
const setup = fs.readFileSync("scripts/setup-test-db.js", "utf8");
const certification = fs.readFileSync("scripts/release-certification.js", "utf8");

for (const snippet of [
  "buildTestEnv",
  "PRISMA_CLIENT_VARIANT",
  "scripts/setup-test-db.js",
  "path.relative(testsRoot",
  "maskDatabaseUrl",
  "db-example-${process.pid}-${Date.now()}",
  "generatedClientMatchesSource",
  "SKIP_PRISMA_GENERATE",
  "fs.rmSync",
]) {
  assert.ok(runner.includes(snippet), `DB example runner must retain ${snippet}`);
}

const guardedScripts = [
  "test:regression",
  "test:diagnostics",
  "test:device-health",
  "test:sync-diagnostics",
  "test:audit-timeline",
  "test:incident-report",
  "test:activity",
  "test:ai-safety",
  "test:packaging-db",
  "test:remote-support",
];
for (const name of guardedScripts) {
  assert.match(pkg.scripts[name] ?? "", /run-db-example-tests\.js/, `${name} must use the guarded isolated DB runner`);
}

for (const file of [
  "change-log-shop-cascade.examples.js",
  "packaging-mode-guard.examples.js",
  "per-pack-low-stock.examples.js",
  "per-pack-return.examples.js",
  "per-pack-stock-in.examples.js",
  "per-pack-stock-out.examples.js",
  "per-pack-sync-stock.examples.js",
]) {
  assert.ok(pkg.scripts["test:packaging-db"].includes(file), `test:packaging-db must cover ${file}`);
}
assert.ok(pkg.scripts.posttest.includes("test:packaging-db"), "the default backend suite must run DB packaging safety examples");
assert.match(setup, /certification-prisma-client/, "setup must support a release-only client that cannot contend with live QA");
assert.match(setup, /generatedSchema !== sourceSchema/, "skip-generation checks must reject a stale isolated client");
const certificationSourceDbStep = certification.match(/id: "backend-source-db"[\s\S]*?\n\}\);/)?.[0] ?? "";
assert.match(certificationSourceDbStep, /PRISMA_CLIENT_VARIANT: "certification"/, "certification must prepare its dedicated Prisma client");
assert.match(certification, /id: "backend-tests"[\s\S]*?PRISMA_CLIENT_VARIANT: "certification"[\s\S]*?SKIP_PRISMA_GENERATE: "true"/, "certification must reuse the dedicated client prepared by backend-source-db");

for (const [name, command] of Object.entries(pkg.scripts)) {
  if (/node tests\/(activity-personalization|ai-agent-(?:bill-items|pack-sizes|tools)|audit-timeline|device-health|diagnostics-error-store|incident-report|packaging-mode-guard|per-pack-(?:low-stock|return|stock-in|stock-out|sync-stock)|remote-support(?:-http|-playbooks|-settings)?|sync-diagnostics)\.examples\.js/.test(command)) {
    assert.fail(`${name} bypasses the guarded DB example runner`);
  }
}

console.log("db-example-isolation.examples.js OK");
