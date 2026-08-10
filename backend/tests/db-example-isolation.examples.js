import assert from "node:assert/strict";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const runner = fs.readFileSync("scripts/run-db-example-tests.js", "utf8");

for (const snippet of [
  "buildTestEnv",
  "PRISMA_CLIENT_VARIANT",
  "scripts/setup-test-db.js",
  "path.relative(testsRoot",
  "maskDatabaseUrl",
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

for (const [name, command] of Object.entries(pkg.scripts)) {
  if (/node tests\/(activity-personalization|audit-timeline|device-health|diagnostics-error-store|incident-report|packaging-mode-guard|per-pack-(?:low-stock|return|stock-in|stock-out|sync-stock)|remote-support(?:-http|-playbooks|-settings)?|sync-diagnostics)\.examples\.js/.test(command)) {
    assert.fail(`${name} bypasses the guarded DB example runner`);
  }
}

console.log("db-example-isolation.examples.js OK");
