import assert from "assert";
import fs from "fs";

// #8 (CODE_REVIEW_LOGIC_FLAWS.md): getExpenseOverview must compute its day/month boundaries and
// trend buckets in the shop timezone, not the server's local clock — otherwise an expense near a
// day/month boundary lands in the wrong bucket by the UTC offset (5.5h for IST) on a UTC
// production server. This module is DB-coupled, so (like the daily-closing staleness guard #2)
// the regression is locked at the source level: it must use the shop-timezone date helpers and
// must not reach for server-local Date accessors.
const src = fs.readFileSync("src/modules/expenses/expenses.service.js", "utf8");

assert(src.includes("formatDateInTimeZone"), "expense overview must derive shop-timezone dates");
assert(src.includes("dateRangeForDateOnly"), "expense overview must derive shop-timezone day boundaries");
assert(src.includes("env.DAILY_CLOSING_TIMEZONE"), "expense overview must use the shop timezone");

for (const banned of ["getFullYear()", "getMonth()", "getDate()", "setHours("]) {
  assert(!src.includes(banned), `expenses.service.js must not use server-local ${banned} for bucketing`);
}

console.log("expense-overview-timezone.examples.js OK");
