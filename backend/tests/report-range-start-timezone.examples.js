import assert from "assert";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

// #12 (CODE_REVIEW_LOGIC_FLAWS.md): the 7d/30d range start must be computed on the shop-timezone
// calendar, not via server-local Date.setDate() math (which only worked because IST has no DST).
// The real assertions run in a child pinned to TZ=UTC to prove the computation is independent of
// the server clock.
if (process.env.__TZ_CHILD !== "1") {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, TZ: "UTC", __TZ_CHILD: "1" },
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

// ── child process, TZ=UTC ──
const { __reportInternals } = await import("../src/modules/reports/reports.service.js");
const { zonedDayStartDaysAgo } = __reportInternals;
const dates = await import("../src/utils/dates.js");
const TZ = "Asia/Kolkata";

const now = new Date("2026-06-14T12:00:00.000Z"); // 2026-06-14 17:30 IST
const s7 = zonedDayStartDaysAgo(now, 6, TZ);
const s30 = zonedDayStartDaysAgo(now, 29, TZ);

assert.equal(dates.formatDateInTimeZone(s7, TZ), "2026-06-08", "7d start is 6 days before today in IST");
assert.equal(dates.formatDateInTimeZone(s30, TZ), "2026-05-16", "30d start is 29 days before today in IST");
// Combined with the #1 count fix, these gate to exactly 7 / 30 inclusive days.
assert.equal(dates.daysBetweenInclusive(s7, dates.endOfZonedDay(now, TZ)), 7, "7d range counts as 7");
assert.equal(dates.daysBetweenInclusive(s30, dates.endOfZonedDay(now, TZ)), 30, "30d range counts as 30");

// Source guard: normalizeDateRange must use the shop-tz helper, not server-local setDate().
const src = fs.readFileSync("src/modules/reports/reports.service.js", "utf8");
const fn = src.slice(src.indexOf("function normalizeDateRange"));
const body = fn.slice(0, fn.indexOf("\n}\n") + 2);
assert.ok(body.includes("zonedDayStartDaysAgo(now, 6)"), "7d must use zonedDayStartDaysAgo");
assert.ok(body.includes("zonedDayStartDaysAgo(now, 29)"), "30d must use zonedDayStartDaysAgo");
assert.ok(!body.includes(".setDate("), "range starts must not use server-local .setDate()");

console.log("report-range-start-timezone.examples.js OK");
