import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/core/reports/pages/DailyClosingPage.tsx", "utf8");

describe("premium mobile daily closing UI", () => {
  it("uses a balanced four-action phone toolbar with accessible touch heights", () => {
    expect(source).toContain('className="grid grid-cols-4 gap-2 lg:flex lg:flex-wrap"');
    expect(source).toContain('asChild variant="outline" className="h-11');
    expect(source).toContain('type="date" value={date}');
    expect(source).toContain('className="h-11 rounded-xl"');
  });

  it("makes expected cash the premium visual focal point", () => {
    expect(source).toContain('data-testid="daily-closing-cash-hero"');
    expect(source).toContain("bg-gradient-to-r from-primary via-blue-600 to-indigo-700");
    expect(source).toContain("bg-gradient-to-br from-primary via-blue-600 to-indigo-700");
    expect(source).toContain("break-words font-display text-5xl");
  });

  it("keeps cash-entry and drawer controls phone-safe", () => {
    expect(source).toContain("grid grid-cols-1 gap-2 sm:grid-cols-[0.8fr_1.2fr]");
    expect(source).toContain('className="h-11 flex-1"');
    expect(source).toContain("grid h-11 w-11 place-items-center");
    expect(source).toContain("flex flex-wrap items-center justify-between");
  });
});
