import assert from "node:assert/strict";

/**
 * The time-zone formatter is built once per zone, not once per call.
 *
 * `datePartsInTimeZone` is the bottom of every report that buckets by day or
 * month — daily closing, P&L, the sales summary, GST, the monthly breakdown.
 * It used to construct a fresh `Intl.DateTimeFormat` on every call, and
 * constructing one loads ICU time-zone data: about 30us, against 2.5us to
 * format with an existing one.
 *
 * On a shop with a 400-bill day that was 83% of the whole monthly-breakdown
 * request — more than the database, the HTTP stack and every other line of the
 * app combined. Caching the formatter took it from 111ms to 16ms.
 *
 * This asserts the construction COUNT rather than a duration, because a timing
 * assertion is the kind that goes flaky on a loaded CI box and then gets
 * deleted. Counting is exact, and it fails for exactly the reason that matters:
 * somebody moved the `new` back inside the per-call path.
 */

const RealDateTimeFormat = Intl.DateTimeFormat;
let constructions = 0;

class CountingDateTimeFormat extends RealDateTimeFormat {
  constructor(...args) {
    super(...args);
    constructions += 1;
  }
}
// Keep the statics the real one carries, so anything else that reaches for
// Intl.DateTimeFormat during the import still works.
Object.setPrototypeOf(CountingDateTimeFormat, RealDateTimeFormat);
Intl.DateTimeFormat = CountingDateTimeFormat;

// Fresh import so the module-level cache starts empty under the counting stub.
const dates = await import(`../src/utils/dates.js?formatter-cache-probe=${Date.now()}`);

const before = constructions;
const zones = ["Asia/Kolkata", "UTC", "America/New_York"];
for (let i = 0; i < 2000; i++) {
  for (const zone of zones) dates.formatDateInTimeZone(new Date(1_700_000_000_000 + i * 60_000), zone);
}
const built = constructions - before;

assert.equal(
  built, zones.length,
  `6000 conversions across ${zones.length} zones must build ${zones.length} formatters, not ${built}`,
);

// A second pass over the same zones must build nothing at all.
const steady = constructions;
for (let i = 0; i < 500; i++) dates.formatDateInTimeZone(new Date(), "Asia/Kolkata");
assert.equal(constructions, steady, "a zone already seen must never build another formatter");

Intl.DateTimeFormat = RealDateTimeFormat;

/* -------- and the cached formatter answers exactly what a fresh one does ---- */

// A reused Intl formatter holds no per-call state, but that is the whole safety
// argument for the cache, so it is worth proving rather than asserting. This
// walks DST transitions and a half-hour zone, which is where a broken date
// helper shows up first and costs a shop a day of sales in the wrong bucket.
function freshFormat(date, timeZone) {
  const parts = new RealDateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

let compared = 0;
for (const zone of ["Asia/Kolkata", "UTC", "America/New_York", "Australia/Sydney", "Europe/London", "Asia/Kathmandu"]) {
  for (let i = 0; i < 3000; i++) {
    // 5.5-hour steps walk every hour-of-day and cross both DST boundaries.
    const date = new Date(Date.UTC(2020, 0, 1) + i * 5.5 * 3600 * 1000);
    assert.equal(
      dates.formatDateInTimeZone(date, zone), freshFormat(date, zone),
      `cached formatter disagreed for ${zone} at ${date.toISOString()}`,
    );
    compared += 1;
  }
}

console.log(`Zoned date formatter cache examples passed (${compared} date keys compared across 6 zones)`);
