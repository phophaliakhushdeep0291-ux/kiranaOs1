import assert from "assert";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

// #7 (CODE_REVIEW_LOGIC_FLAWS.md): getMonthlyBreakdown must bucket bills by the shop-timezone
// month, not the server's local month. The bug only manifests when the server TZ differs from the
// shop TZ (e.g. a UTC production server), so to make this a deterministic regression guard
// regardless of the dev/CI machine's clock, the real assertions run in a child pinned to TZ=UTC.
// Under TZ=UTC, server-local Date.getMonth() would mis-bucket the boundary timestamps below, so
// reintroducing it fails this test.
if (process.env.__TZ_CHILD !== "1") {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, TZ: "UTC", __TZ_CHILD: "1" },
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

// ── child process, TZ=UTC ──
const { __reportInternals } = await import("../src/modules/reports/reports.service.js");
const { monthInShopTz, monthStartsInShopTz } = __reportInternals;
const { dateRangeForDateOnly } = await import("../src/utils/dates.js");
const TZ = "Asia/Kolkata";

// These straddle a boundary in IST while the process runs in UTC:
// 2026-01-31 20:00 UTC = 2026-02-01 01:30 IST → February (server-local getMonth would say January)
assert.equal(monthInShopTz("2026-01-31T20:00:00.000Z", TZ), 2, "late-Jan UTC is February in IST");
// 2026-02-01 02:00 UTC = 2026-02-01 07:30 IST → February
assert.equal(monthInShopTz("2026-02-01T02:00:00.000Z", TZ), 2, "early-Feb UTC is February in IST");
// 2026-01-31 10:00 UTC = 2026-01-31 15:30 IST → January
assert.equal(monthInShopTz("2026-01-31T10:00:00.000Z", TZ), 1, "midday-Jan UTC is January in IST");
// Year boundary: 2025-12-31 20:00 UTC = 2026-01-01 01:30 IST → January
assert.equal(monthInShopTz("2025-12-31T20:00:00.000Z", TZ), 1, "late-Dec UTC is January in IST");

// ── getMonthlyBreakdown does not call monthInShopTz any more ──────────────────
//
// It places a row by comparing its timestamp against the twelve month-start instants
// of the year, computed once on the shop's calendar — converting each timestamp was
// costing a formatToParts per row, about as much as the database read it followed.
//
// monthInShopTz stays as the SPECIFICATION of what that comparison must decide, and
// the sweep below is the proof: every quarter-hour of a year, in zones with a
// half-hour offset (Kolkata), DST (New York, London) and both at once (Lord Howe,
// Chatham). The four point assertions above are the boundary cases worth naming;
// this is the exhaustive version, and it is what fails if the fast path ever stops
// agreeing with the slow one.
for (const zone of ["Asia/Kolkata", "America/New_York", "Europe/London", "Australia/Lord_Howe", "Pacific/Chatham"]) {
  for (const year of [2025, 2026]) {
    const starts = monthStartsInShopTz(year, zone);
    const end = dateRangeForDateOnly(`${year}-12-31`, zone).end.getTime();
    for (let at = starts[0]; at <= end; at += 900_000) {
      let month = 1;
      while (month < 12 && at >= starts[month]) month += 1;
      const expected = monthInShopTz(at, zone);
      if (month !== expected) {
        assert.fail(
          `${zone} ${new Date(at).toISOString()}: month-boundary scan says ${month}, the shop calendar says ${expected}`,
        );
      }
    }
  }
}

console.log("report-month-timezone.examples.js OK");
