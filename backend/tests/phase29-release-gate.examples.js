import assert from "assert";
import fs from "fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}
function exists(file) {
  return fs.existsSync(file);
}

const pkg = JSON.parse(read("package.json"));
const releaseGate = read("scripts/release-gate.js");
const migrationSafety = read("scripts/migration-safety-check.js");
const manifest = read("scripts/release-manifest.js");
const proofSuite = read("scripts/production-proof-suite.js");
const productionCheck = read("scripts/production-check.js");
const dockerfile = read("Dockerfile");
const ci = read(".github/workflows/backend-ci.yml");
const envExample = read(".env.example");
const changelog = read("CHANGELOG.md");
const docs = read("docs/RELEASE_RUNBOOK.md") + "\n" + read("docs/ROLLBACK_PLAN.md") + "\n" + read("docs/PRODUCTION_LAUNCH_GATE.md");

for (const file of [
  "CHANGELOG.md",
  "docs/RELEASE_RUNBOOK.md",
  "docs/ROLLBACK_PLAN.md",
  "docs/PRODUCTION_LAUNCH_GATE.md",
  "scripts/migration-safety-check.js",
  "scripts/release-gate.js",
  "scripts/release-manifest.js",
]) {
  assert.ok(exists(file), `${file} must exist`);
  assert.ok(productionCheck.includes(file), `production-check must require ${file}`);
}

assert.equal(pkg.scripts["migration:safety"], "node scripts/migration-safety-check.js", "migration:safety command must exist");
assert.equal(pkg.scripts["release:gate"], "node scripts/release-gate.js", "release:gate command must exist");
assert.equal(pkg.scripts["release:manifest"], "node scripts/release-manifest.js", "release:manifest command must exist");
assert.ok(pkg.scripts["proof:release"].includes("migration:safety"), "proof:release must run migration safety");
assert.ok(pkg.scripts["proof:release"].includes("release:gate"), "proof:release must run release gate");
assert.ok(pkg.scripts["proof:release"].includes("proof:ops"), "proof:release must run operational proof");
assert.ok(pkg.scripts["test:billing"].includes("phase29-release-gate.examples.js"), "npm test must include phase29 test");

for (const snippet of [
  "DROP TABLE",
  "DROP COLUMN",
  "TRUNCATE",
  "DELETE FROM",
  "ALLOW_DESTRUCTIVE_MIGRATION=true",
  "NOT NULL column without DEFAULT",
  "strictly increasing",
  "contiguous",
]) {
  assert.ok(migrationSafety.includes(snippet), `migration safety must include ${snippet}`);
}

for (const snippet of [
  "RELEASE_VERSION",
  "RELEASE_APPROVED",
  "RELEASE_APPROVER",
  "RELEASE_ROLLBACK_IMAGE",
  "CHANGELOG.md",
  "docs/RELEASE_RUNBOOK.md",
  "docs/ROLLBACK_PLAN.md",
  "docs/PRODUCTION_LAUNCH_GATE.md",
  "npm run proof:release",
  "Razorpay test-mode",
  "Redis worker heartbeat",
  "frontend-backend E2E",
]) {
  assert.ok(releaseGate.includes(snippet), `release gate must include ${snippet}`);
}

for (const snippet of [
  "release-artifacts",
  "release-manifest-",
  "requiredProofCommands",
  "requiredHumanChecks",
  "rollback image recorded",
]) {
  assert.ok(manifest.includes(snippet), `release manifest must include ${snippet}`);
}

for (const snippet of [
  "Migration safety check",
  "Release gate check",
  "Static production readiness check",
]) {
  assert.ok(proofSuite.includes(snippet), `proof suite must include ${snippet}`);
}

for (const snippet of [
  "npm run migration:safety",
  "npm run release:gate",
  "npm run proof:ops",
]) {
  assert.ok(ci.includes(snippet), `CI must run ${snippet}`);
}

assert.ok(dockerfile.includes("COPY contracts ./contracts"), "Dockerfile must copy contracts into release image");
assert.ok(changelog.includes("## [1.0.0]"), "CHANGELOG must include current version section");

for (const key of [
  "RELEASE_VERSION",
  "RELEASE_CHANNEL",
  "RELEASE_APPROVED",
  "RELEASE_APPROVER",
  "RELEASE_ROLLBACK_IMAGE",
  "ALLOW_DESTRUCTIVE_MIGRATION",
]) {
  assert.ok(envExample.includes(`${key}=`), `.env.example must document ${key}`);
  assert.ok(productionCheck.includes(`"${key}"`), `production-check must require env key ${key}`);
}

for (const phrase of [
  "backup before migration",
  "restore drill",
  "rollback image",
  "health/ready",
  "npm run proof:release",
  "Razorpay test-mode",
  "Redis worker heartbeat",
  "frontend-backend E2E",
]) {
  assert.ok(docs.toLowerCase().includes(phrase.toLowerCase()), `release docs must mention ${phrase}`);
}

console.log("Phase 29 release gate examples passed");
