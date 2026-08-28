import assert from "node:assert/strict";
import {
  DRILL_REQUIREMENTS,
  formatVerdict,
  missingRequirements,
  recoveryPoint,
  reconcile,
  RECONCILE_QUERIES,
} from "../scripts/restore-drill-report.js";

/**
 * The restore drill's judgement, tested without a database.
 *
 * The drill itself needs PostgreSQL and a scratch database, so it can only be
 * run where those exist. What must not wait for that is the reasoning: whether
 * the drill is safe to start, whether the restored copy actually matches, and
 * whether the backup was recent enough to be worth restoring. Those decide
 * whether a cafe gets its takings back, and they are all pure functions.
 */

/* ------------------------------------------------ refusing to start blind */

assert.equal(missingRequirements({
  DATABASE_URL: "postgresql://u:p@host/live",
  RESTORE_TEST_DATABASE_URL: "postgresql://u:p@host/restore_drill",
  ALLOW_RESTORE_TEST_DB: "true",
}).length, 0, "a fully configured drill is runnable");

const bare = missingRequirements({});
assert.equal(bare.length, DRILL_REQUIREMENTS.length, "an empty environment reports every requirement");
assert.ok(bare.every((row) => row.why && row.reason), "each says what it is for and what is wrong");

const halfArmed = missingRequirements({
  DATABASE_URL: "postgresql://u:p@host/live",
  RESTORE_TEST_DATABASE_URL: "postgresql://u:p@host/restore_drill",
  ALLOW_RESTORE_TEST_DB: "yes",
});
assert.deepEqual(halfArmed.map((row) => row.key), ["ALLOW_RESTORE_TEST_DB"],
  "a truthy-looking value that is not exactly true does not arm a schema drop");
assert.match(halfArmed[0].reason, /expected "true"/);

/* ------------------------------------------------------- recovery point */

const hourAgo = Date.parse("2026-08-28T12:00:00Z");
const now = Date.parse("2026-08-28T13:00:00Z");
let rpo = recoveryPoint({ backupTakenAt: hourAgo, now });
assert.equal(rpo.ageHours, 1);
assert.equal(rpo.withinObjective, true, "an hour-old backup is inside a 24h objective");
assert.match(rpo.summary, /1\.0 hours/);

rpo = recoveryPoint({ backupTakenAt: Date.parse("2026-08-26T13:00:00Z"), now });
assert.equal(rpo.withinObjective, false, "a two-day-old backup breaches a 24h objective");
assert.equal(rpo.ageHours, 48);

rpo = recoveryPoint({ backupTakenAt: Date.parse("2026-08-28T12:50:00Z"), now });
assert.match(rpo.summary, /10 minutes/, "a fresh backup is reported in minutes, not fractions of an hour");

rpo = recoveryPoint({ backupTakenAt: "not a date", now });
assert.equal(rpo.known, false);
assert.equal(rpo.withinObjective, false, "an unreadable timestamp is a failure, never a pass by default");

// A clock that has gone backwards must not report a negative age as "very fresh".
rpo = recoveryPoint({ backupTakenAt: now + 60_000, now });
assert.equal(rpo.ageHours, 0);

/* ------------------------------------------------------- reconciliation */

const before = { tables: 77, shops: 1, bills: 216, billTotalPaise: "48250000", auditRows: 1781 };

let result = reconcile(before, { ...before });
assert.equal(result.matched, true, "an identical restore matches");
assert.equal(result.compared, 5);

result = reconcile(before, { ...before, billTotalPaise: "48249900" });
assert.equal(result.matched, false, "one paise short is a failed drill");
assert.deepEqual(result.variances, [
  { metric: "billTotalPaise", source: "48250000", restored: "48249900", note: "differs" },
]);

result = reconcile(before, { tables: 77, shops: 1, bills: 216, billTotalPaise: "48250000" });
assert.equal(result.matched, false);
assert.equal(result.variances[0].note, "lost in restore", "a metric that vanished is named as lost");

result = reconcile({ shops: 1 }, { shops: 1, strays: 4 });
assert.equal(result.variances[0].note, "present only after restore");

// Integer paise are compared as integers: these two are equal as Numbers only
// because the float mirror rounds, which is the bug the drill exists to catch.
result = reconcile({ billTotalPaise: 9007199254740993n }, { billTotalPaise: 9007199254740992n });
assert.equal(result.matched, false, "large paise totals are compared exactly, not through a float");

/* ------------------------------------------------------------- verdict */

const verdict = formatVerdict({
  reconciliation: reconcile(before, { ...before, bills: 215 }),
  rpo: recoveryPoint({ backupTakenAt: hourAgo, now }),
  backupFile: "/backups/kiranaos-2026-08-28.dump",
});
assert.match(verdict, /^FAIL/, "a variance leads the verdict, not a buried line");
assert.match(verdict, /bills: source 216 -> restored 215/);
assert.match(verdict, /inside the 24h objective/);

assert.ok(Object.keys(RECONCILE_QUERIES).length >= 5, "the drill compares more than a table count");
for (const [name, sql] of Object.entries(RECONCILE_QUERIES)) {
  assert.match(sql, /^SELECT /, `${name} is a read`);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i, `${name} never writes`);
}

console.log("restore-drill-report: ok");
