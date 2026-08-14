import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const taxes = readFileSync("src/features/core/settings/pages/TaxesSettingsPage.tsx", "utf8");
// The upgrade wording moved into the catalogue when this screen was translated.
// The guarantee is unchanged — the gated state must offer the plan, not blame the
// network — so the label is checked where it now lives, paired with the key the
// screen renders inside the link.
const settingsEn = readFileSync("src/features/core/settings/translations/settings-pages.ts", "utf8");

describe("taxes plan gates", () => {
  it("does not call Business-only GST endpoints for lower plans", () => {
    expect(taxes).toContain('useFeature("gst_reports")');
    expect(taxes).toContain("enabled: gstReportsFeature.allowed");
    expect(taxes).toContain("enabled: gstReportsFeature.allowed && (ewayOpen || eInvoiceOpen)");
  });

  it("shows an honest upgrade state instead of blaming connectivity", () => {
    expect(taxes).toContain("GST reporting is not in the {gstReportsFeature.plan.name} plan");
    expect(taxes).toContain('<Link href="/plans">{t("settings.tax.upgradeBusiness")}</Link>');
    expect(settingsEn).toContain('"settings.tax.upgradeBusiness": "Upgrade to Business"');
    expect(taxes).not.toContain("Connect to the cloud to load this month's GST report");
  });
});
