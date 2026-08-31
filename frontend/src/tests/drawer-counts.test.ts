import { describe, expect, it } from "vitest";
import { buildDrawerCount, mergeDrawerCounts, upsertDrawerCount, type DrawerCount } from "@/features/core/reports/drawer-counts";

function entry(date: string, variance = 0): DrawerCount {
  return { date, expectedCash: 100, countedCash: 100 + variance, variance, countedAt: `${date}T21:00:00Z` };
}

describe("drawer counts", () => {
  it("computes over/short variance with paisa rounding", () => {
    expect(buildDrawerCount("2026-07-18", 500, 480).variance).toBe(-20);
    expect(buildDrawerCount("2026-07-18", 500, 505.005).variance).toBe(5.01);
    expect(buildDrawerCount("2026-07-18", 500, 500).variance).toBe(0);
  });

  it("replaces the same-date entry instead of duplicating", () => {
    const list = upsertDrawerCount([entry("2026-07-17", -5)], entry("2026-07-17", 10));
    expect(list).toHaveLength(1);
    expect(list[0].variance).toBe(10);
  });

  it("keeps newest date first and caps the history", () => {
    const list = upsertDrawerCount(
      [entry("2026-07-15"), entry("2026-07-17")],
      entry("2026-07-16"),
      2,
    );
    expect(list.map((row) => row.date)).toEqual(["2026-07-17", "2026-07-16"]);
  });

  it("accepts a newer server-backed count when no local operation is pending", () => {
    const merged = mergeDrawerCounts([entry("2026-07-18", -20)], [{
      date: "2026-07-18",
      openingCashPaise: 10_000,
      manualCashInPaise: 500,
      manualCashOutPaise: 200,
      expectedCashPaise: 10_300,
      countedCashPaise: 10_250,
      variancePaise: -50,
      countedAt: "2026-07-18T21:10:00.000Z",
      countedByUserId: "owner-1",
      countedByDeviceId: "counter-2",
      revision: 4,
    }]);
    expect(merged[0]).toMatchObject({ countedCash: 102.5, expectedCash: 103, variance: -0.5, revision: 4 });
  });

  it("does not overwrite an offline count that is still waiting to sync", () => {
    const local = { ...entry("2026-07-18", 5), revision: 3 };
    const merged = mergeDrawerCounts([local], [{
      date: "2026-07-18",
      openingCashPaise: 0,
      manualCashInPaise: 0,
      manualCashOutPaise: 0,
      expectedCashPaise: 10_000,
      countedCashPaise: 9_900,
      variancePaise: -100,
      countedAt: "2026-07-18T20:00:00.000Z",
      countedByUserId: null,
      countedByDeviceId: null,
      revision: 2,
    }], new Set(["2026-07-18"]));
    expect(merged[0]).toEqual(local);
  });
});
