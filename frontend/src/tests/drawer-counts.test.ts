import { describe, expect, it } from "vitest";
import { buildDrawerCount, upsertDrawerCount, type DrawerCount } from "@/features/core/reports/drawer-counts";

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
});
