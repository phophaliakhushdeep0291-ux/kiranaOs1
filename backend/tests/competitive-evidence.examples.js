import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";

const result = spawnSync(process.execPath, ["scripts/check-competitive-evidence.js"], {
  cwd: process.cwd(),
  encoding: "utf8"
});

assert.equal(result.status, 0, result.stderr || result.stdout);
const report = JSON.parse(result.stdout);
assert.equal(report.status, "passed");
assert.equal(report.domains.length, 7);
assert.ok(report.overallScore >= 0 && report.overallScore <= 10);
assert.equal(report.claimCounts.absent > 0, true, "the matrix must expose real gaps instead of claiming universal parity");
assert.equal(report.claimCounts.external_blocked > 0, true, "external proof gaps must remain explicit");
assert.equal(report.domains.find((domain) => domain.id === "production_maturity").cap, 6.5);
assert.equal(report.domains.find((domain) => domain.id === "hardware_payments").cap, 6);
assert.equal(report.domains.find((domain) => domain.id === "ux_accessibility").cap, 7.5);

console.log(JSON.stringify({ suite: "competitive-evidence", status: "passed", overallScore: report.overallScore, domains: report.domains }, null, 2));
