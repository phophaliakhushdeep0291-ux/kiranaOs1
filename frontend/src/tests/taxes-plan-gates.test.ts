import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const taxes = readFileSync("src/features/settings/pages/TaxesSettingsPage.tsx", "utf8");

describe("taxes plan gates", () => {
  it("does not call Business-only GST endpoints for lower plans", () => {
    expect(taxes).toContain('useFeature("gst_reports")');
    expect(taxes).toContain("enabled: gstReportsFeature.allowed");
    expect(taxes).toContain("enabled: gstReportsFeature.allowed && ewayOpen");
  });

  it("shows an honest upgrade state instead of blaming connectivity", () => {
    expect(taxes).toContain("GST reporting is not in the {gstReportsFeature.plan.name} plan");
    expect(taxes).toContain('<Link href="/plans">Upgrade to Business</Link>');
    expect(taxes).not.toContain("Connect to the cloud to load this month's GST report");
  });
});
