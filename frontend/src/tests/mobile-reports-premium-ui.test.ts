import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reports = readFileSync("src/features/core/reports/pages/ReportsPage.tsx", "utf8");

describe("premium mobile reports hierarchy", () => {
  it("uses a dedicated phone summary while retaining the desktop KPI grid", () => {
    expect(reports).toContain('data-testid="mobile-reports-overview"');
    expect(reports).toContain('aria-label="Mobile report overview"');
    expect(reports).toContain('className="hidden min-w-0 grid-cols-2 gap-2 md:grid lg:grid-cols-4"');
    expect(reports).toContain("<MobileTenderStat label=\"Cash\"");
    expect(reports).toContain("<MobilePulseTile label=\"Udhar Due\"");
  });

  it("keeps primary mobile report actions at least 44px tall", () => {
    expect(reports).toContain('className="col-span-3 h-11');
    expect(reports).toContain('aria-label="Refresh reports"');
    expect(reports).toContain('className="h-11 w-full rounded-xl');
    expect(reports).toContain('className="inline-flex min-h-11 items-center');
    expect(reports).toContain('className="inline-flex h-11 min-w-[108px]');
  });
});
