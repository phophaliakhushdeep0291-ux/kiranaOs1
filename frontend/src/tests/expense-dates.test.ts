import { afterEach, describe, expect, it, vi } from "vitest";
import { expenseDateInput, expenseDateTimestamp } from "@/features/core/expenses/dates";

afterEach(() => vi.unstubAllEnvs());

describe("expense calendar dates", () => {
  it.each([
    ["Asia/Kolkata", "2026-09-17T21:10:00Z", "2026-09-18", "2026-09-17T18:30:00.000Z"],
    ["America/Los_Angeles", "2026-09-18T02:00:00Z", "2026-09-17", "2026-09-17T07:00:00.000Z"],
  ])("keeps creation, storage and editing on the same day in %s", (zone, now, day, timestamp) => {
    vi.stubEnv("TZ", zone);
    expect(expenseDateInput(undefined, new Date(now))).toBe(day);
    expect(expenseDateTimestamp(day)).toBe(timestamp);
    expect(expenseDateInput(timestamp)).toBe(day);
    expect(expenseDateInput(day)).toBe(day);
  });

  it("keeps recurring due dates stable across daylight saving changes", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    for (const day of ["2026-03-08", "2026-03-09", "2026-11-01", "2026-11-02"]) {
      expect(expenseDateInput(expenseDateTimestamp(day))).toBe(day);
    }
  });
});
