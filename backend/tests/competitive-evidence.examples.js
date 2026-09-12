import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { evidenceContentSha256, runtimeEvidenceMatches, validEvidenceDate, validateCompetitiveEvidence } from "../scripts/competitive-evidence-validation.js";

const repoRoot = path.resolve(process.cwd(), "..");
const matrix = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs", "competitive-evidence.json"), "utf8"));
assert.deepEqual(validateCompetitiveEvidence(matrix, { repoRoot }), []);
for (const invalid of [null, [], {}, { ...matrix, claims: null }, { ...matrix, domains: [null] }, { ...matrix, claims: [null] }, { ...matrix, caps: [null] }]) {
  assert.ok(validateCompetitiveEvidence(invalid, { repoRoot }).length > 0);
}
for (const mutate of [
  (m) => { m.generatedAt = "2026-02-30"; },
  (m) => { m.claims[0].lastVerifiedAt = "2026-99-01"; },
  (m) => { m.claims[0].lastVerifiedAt = "2099-01-01"; },
  (m) => { m.statusFactors.partial = 1; },
  (m) => { m.scoreScale = 100; },
  (m) => { m.domains[0].weight = -1; },
  (m) => { m.domains.push(m.domains[0]); },
  (m) => { m.claims[0].weight = "20"; },
  (m) => { m.claims[0].kiranaEvidence.sourcePaths = ["../outside-repo"]; },
  (m) => { m.claims[0].kiranaEvidence.sourcePaths = ["C:/Windows"]; },
  (m) => { m.claims[0].kiranaEvidence.testCommands = ["cd backend && npm run nonexistent-proof-script"]; },
  (m) => { m.claims[0].kiranaEvidence.testCommands = "cd backend && npm test"; },
  (m) => { m.claims[0].competitorEvidence = [null]; },
  (m) => { m.caps[0].requiresVerifiedClaims = []; },
  (m) => { m.claims.find((c) => c.id === "postgres_runtime_proof").kiranaEvidence.runtimeProof.contentSha256 = "0".repeat(64); },
  (m) => { m.claims.find((c) => c.id === "postgres_runtime_proof").lastVerifiedAt = "2026-09-03"; },
]) {
  const changed = structuredClone(matrix); mutate(changed);
  assert.ok(validateCompetitiveEvidence(changed, { repoRoot }).length > 0, String(mutate));
}
assert.equal(validEvidenceDate("2024-02-29"), true);
assert.equal(validEvidenceDate("2026-02-29"), false);
assert.equal(validEvidenceDate("2026-09-09", Date.parse("2026-09-08T23:59:59Z")), false);

for (const claim of matrix.claims.filter((c) => c.kiranaEvidence.runtimeProof?.status === "verified")) {
  const filename = path.join(repoRoot, claim.kiranaEvidence.runtimeProof.artifact);
  const original = JSON.parse(fs.readFileSync(filename, "utf8"));
  assert.equal(runtimeEvidenceMatches(claim.id, original), true, claim.id);
  assert.equal(runtimeEvidenceMatches(claim.id, { status: "passed" }), false, "a success label alone is not proof");
  const changed = { ...original, status: "failed" };
  const altered = structuredClone(matrix);
  altered.claims.find((c) => c.id === claim.id).kiranaEvidence.runtimeProof.contentSha256 = evidenceContentSha256(changed);
  assert.ok(validateCompetitiveEvidence(altered, {
    repoRoot, readJson: (p) => p === filename ? changed : JSON.parse(fs.readFileSync(p, "utf8")),
  }).some((error) => error.includes("does not prove")), "a failed artifact still fails if its checksum is updated");
  assert.equal(evidenceContentSha256(original), evidenceContentSha256(JSON.parse(JSON.stringify(original, null, 2).replaceAll("\n", "\r\n"))));
}
const localRelease = { type: "kiranaos_release_certification", status: "local-passed", mode: "local",
  summary: { failed: 0, blocked: 0, passed: 17 },
  results: ["prisma-sqlite-validate", "prisma-postgres-validate", "prisma-postgres-generate", "migration-safety", "release-gate", "backend-source-db",
    "backend-tests", "backend-warehouse", "backend-integration-sqlite", "backend-production-check", "ai-safety", "api-contract",
    "razorpay-fixtures", "hardware-bridge-contracts", "frontend-production-check", "local-storage-proof", "source-snapshot-stability"]
    .map((id) => ({ id, status: "passed", required: true })) };
assert.equal(runtimeEvidenceMatches("local_release_certification", localRelease), true);
localRelease.results.pop(); localRelease.summary.passed--;
assert.equal(runtimeEvidenceMatches("local_release_certification", localRelease), false, "historical passes without source-stability proof cannot validate a current release");
const postgres = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs/evidence/postgres-production-proof-2026-09-02.json"), "utf8"));
postgres.results.find((row) => row.id === "integration-concurrency").status = "skipped";
assert.equal(runtimeEvidenceMatches("postgres_runtime_proof", postgres), false);
const worker = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs/evidence/redis-worker-production-proof-2026-09-02.json"), "utf8"));
worker.worker.separateProcess = false;
assert.equal(runtimeEvidenceMatches("redis_worker_proof", worker), false);
const ui = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs/evidence/core-route-wcag-axe-2026-08-30.json"), "utf8"));
ui.responsiveCaptures.runtimeErrors = 1;
assert.equal(runtimeEvidenceMatches("live_ui_matrix", ui), false);
assert.equal(runtimeEvidenceMatches("new-unmapped-claim", { status: "passed" }), false);

const result = spawnSync(process.execPath, ["scripts/check-competitive-evidence.js"], {
  cwd: process.cwd(),
  encoding: "utf8"
});

assert.equal(result.status, 0, result.stderr || result.stdout);
const report = JSON.parse(result.stdout);
assert.equal(report.status, "passed");
assert.equal(report.domains.length, 7);
assert.ok(report.overallScore >= 0 && report.overallScore <= 10);
const unresolvedClaims = report.claimCounts.partial + report.claimCounts.external_blocked + report.claimCounts.absent;
assert.equal(unresolvedClaims > 0, true, "the matrix must expose incomplete or unproved gaps instead of claiming universal parity");
assert.equal(report.claimCounts.external_blocked > 0, true, "external proof gaps must remain explicit");
assert.equal(report.domains.find((domain) => domain.id === "production_maturity").cap, 6.5);
assert.equal(report.domains.find((domain) => domain.id === "hardware_payments").cap, 6);
assert.equal(report.domains.find((domain) => domain.id === "ux_accessibility").cap, 7.5);

console.log(JSON.stringify({ suite: "competitive-evidence", status: "passed", overallScore: report.overallScore, domains: report.domains }, null, 2));
