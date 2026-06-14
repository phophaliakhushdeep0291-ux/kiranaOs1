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
const { monthInShopTz } = __reportInternals;
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

console.log("report-month-timezone.examples.js OK");
