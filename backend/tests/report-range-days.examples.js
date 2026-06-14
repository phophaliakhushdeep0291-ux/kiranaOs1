import assert from "assert";
import { daysBetweenInclusive } from "../src/utils/dates.js";

// Report range gating (enforceReportRangeLimit) passes start = start-of-day of the first day and
// end = end-of-day (23:59:59.999) of the last day. An N-day inclusive range therefore spans
// (N − ε) days and the count must come back as exactly N.
//
// Regression guard: a previous `Math.ceil(...) + 1` inflated every range by one day, so a
// base-plan user (7-day limit) was rejected on the standard "7d" report (8 > 7), a 30-day-plan
// user on "30d" (31 > 30), and a monthly-plan user on a full 31-day custom range. This blocked a
// core paid feature. See CODE_REVIEW_LOGIC_FLAWS.md #1.
function dayStart(y, m, d) { return new Date(y, m - 1, d, 0, 0, 0, 0); }
function dayEnd(y, m, d) { return new Date(y, m - 1, d, 23, 59, 59, 999); }

assert.equal(daysBetweenInclusive(dayStart(2026, 6, 14), dayEnd(2026, 6, 14)), 1, "single day must count as 1");
assert.equal(daysBetweenInclusive(dayStart(2026, 6, 8), dayEnd(2026, 6, 14)), 7, "7d range must count as 7 (base plan must allow)");
assert.equal(daysBetweenInclusive(dayStart(2026, 5, 16), dayEnd(2026, 6, 14)), 30, "30d range must count as 30");
assert.equal(daysBetweenInclusive(dayStart(2026, 6, 1), dayEnd(2026, 6, 30)), 30, "Jun 1–30 inclusive must count as 30");
assert.equal(daysBetweenInclusive(dayStart(2026, 6, 1), dayEnd(2026, 6, 7)), 7, "Jun 1–7 inclusive must count as 7");
assert.equal(daysBetweenInclusive(dayStart(2026, 1, 1), dayEnd(2026, 1, 31)), 31, "full 31-day month inclusive must count as 31");

console.log("report-range-days.examples.js OK");
