import { afterEach, describe, expect, it, vi } from "vitest";
import { expenseDateTimestamp } from "@/features/core/expenses/dates";
import { expenseTotalsByDay, reportCalendarDay } from "@/features/core/reports/report-calendar";

afterEach(() => vi.unstubAllEnvs());

describe("shop-day report calendar", () => {
  it.each([
    ["Asia/Kolkata", "2026-09-26T22:50:00Z", "2026-09-27"],
    ["America/Los_Angeles", "2026-09-27T02:00:00Z", "2026-09-26"],
  ])("shows the local purchase day in %s", (zone, timestamp, day) => {
    vi.stubEnv("TZ", zone);
    expect(reportCalendarDay(timestamp)).toBe(day);
    expect(reportCalendarDay(day)).toBe(day);
  });

  it.each(["Asia/Kolkata", "America/Los_Angeles"])("keeps daily expenses on the date entered in %s", (zone) => {
    vi.stubEnv("TZ", zone);
    const day = "2026-09-27";
    const totals = expenseTotalsByDay([
      { spentAt: expenseDateTimestamp(day), amount: 5 },
      { spentAt: expenseDateTimestamp(day), amount: 0.1 },
      { spentAt: day, amount: 0.2 },
      { spentAt: expenseDateTimestamp("2026-09-26"), amount: 2 },
      { spentAt: expenseDateTimestamp(day), amount: 100, deletedAt: "2026-09-27T12:00:00Z" },
    ]);
    expect([...totals]).toEqual([[day, 5.3], ["2026-09-26", 2]]);
  });

  it("keeps date-only records stable across daylight-saving changes", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    for (const day of ["2026-03-08", "2026-03-09", "2026-11-01", "2026-11-02"]) {
      expect(reportCalendarDay(expenseDateTimestamp(day))).toBe(day);
    }
  });

  it("does not create report days from missing or invalid dates", () => {
    expect(reportCalendarDay(null)).toBeNull();
    expect(reportCalendarDay("invalid")).toBeNull();
    expect(expenseTotalsByDay([{ spentAt: "invalid", amount: 50 }]).size).toBe(0);
  });
});
