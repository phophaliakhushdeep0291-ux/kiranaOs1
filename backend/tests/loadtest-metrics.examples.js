import assert from "node:assert/strict";
import { wholeNumber, summarize, exceedsBudget } from "../loadtest/metrics.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

for (const value of [-1, 2.5, "NaN", "Infinity"]) assert.throws(() => wholeNumber(value, "count"));
assert.equal(wholeNumber("1000", "count"), 1000);
const stats = { requests: { total: 10000, average: 500 }, latency: { p50: 20, p97_5: 700, p99: 900 }, errors: 0, timeouts: 0, non2xx: 101 };
const row = summarize({ name: "populated products", result: stats });
assert.equal(summarize({ name: "timeouts", result: { ...stats, errors: 100, timeouts: 100, non2xx: 0 } }).errorRate, 100 / 10100);
assert.equal(row.p97_5Ms, 700);
assert.equal(row.errorRate, 0.0101);
assert.equal(exceedsBudget(row, { latencyMs: 800, errorRate: 0.01 }), true, "rounding cannot turn a budget breach into a pass");
assert.equal(exceedsBudget({ ...row, errorRate: 0.01 }, { latencyMs: 800, errorRate: 0.01 }), false);
for (const patch of [{ requests: 0 }, { p97_5Ms: undefined }, { p97_5Ms: 801 }, { errorRate: NaN }]) assert.equal(exceedsBudget({ ...row, errorRate: 0, ...patch }, { latencyMs: 800, errorRate: 0.01 }), true);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kirana-loadtest-report-"));
try {
  const report = path.join(directory, "result.json");
  for (const duration of ["invalid", "1"]) {
    fs.writeFileSync(report, '{"status":"passed"}');
    const run = spawnSync(process.execPath, ["loadtest/loadtest.js"], { env: { ...process.env, LOADTEST_DURATION: duration, LOADTEST_BASE_URL: "http://127.0.0.1:1", LOADTEST_REPORT_PATH: report }, timeout: 10000, encoding: "utf8" });
    assert.ok(run.status > 0, run.stderr);
    assert.equal(JSON.parse(fs.readFileSync(report, "utf8")).status, "incomplete", "configuration or health failures cannot leave an old passing report");
  }
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
console.log("Load-test metrics passed: real percentile, exact error threshold, missing metrics and zero requests fail closed.");
