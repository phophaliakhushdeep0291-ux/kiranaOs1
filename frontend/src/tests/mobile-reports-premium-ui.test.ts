import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reports = readFileSync("src/features/core/reports/pages/ReportsPage.tsx", "utf8");

describe("premium mobile reports hierarchy", () => {
  it("uses a dedicated phone summary while retaining the desktop KPI grid", () => {
    expect(reports).toContain('data-testid="mobile-reports-overview"');
    expect(reports).toContain('aria-label="Mobile report overview"');
    expect(reports).toContain('className="hidden min-w-0 grid-cols-2 gap-2 md:grid lg:grid-cols-4"');
    expect(reports).toContain("<MobileTenderStat label=\"Cash\"");
    // The credit tile is named by the trade — "Udhar Due" in a kirana store,
    // "Tabs Due" in a café — so the phone summary is pinned on the prop being
    // passed rather than on one trade's wording.
    expect(reports).toContain("<MobilePulseTile label={creditLabel}");
  });

  it("keeps primary mobile report actions at least 44px tall", () => {
    expect(reports).toContain('className="col-span-3 h-11');
    expect(reports).toContain('aria-label="Refresh reports"');
    expect(reports).toContain('className="h-11 w-full rounded-xl');
    expect(reports).toContain('className="inline-flex min-h-11 items-center');
    expect(reports).toContain('className="inline-flex h-11 min-w-[108px]');
  });
});
