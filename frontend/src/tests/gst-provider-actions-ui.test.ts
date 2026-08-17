import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const taxes = readFileSync("src/features/core/settings/pages/TaxesSettingsPage.tsx", "utf8");
// The approval wording moved into the catalogue when this screen was translated.
// It is checked there and paired with the key the screen renders, because the
// wording is the whole point of these two tests: the app must ask for a *legal*
// submission only when a certified provider attests it, and must never let the
// sandbox path read as though it produced a real IRN.
const settingsEn = readFileSync("src/features/core/settings/translations/settings-pages.ts", "utf8");

describe("GST provider actions", () => {
  it("routes e-way requests to legal submission only when provider readiness attests it", () => {
    expect(taxes).toContain('legalSubmission ? "submit" : "draft"');
    expect(taxes).toContain("settings.tax.approveEwaySubmit");
    expect(settingsEn).toContain("Approve legal e-way bill submission");
    expect(settingsEn).toContain("using an idempotent request");
  });

  it("exposes legal e-invoice submission and clearly separated sandbox validation", () => {
    expect(taxes).toContain('legalSubmission ? "submit" : "sandbox"');
    // The wording moved into the dictionary; assert the key the dialog reads
    // and the English behind it, so the distinction is still pinned.
    expect(taxes).toContain('t("settings.tax.submitEInvoiceTitle")');
    expect(settingsEn).toContain('"settings.tax.submitEInvoiceTitle": "Submit GST e-invoice"');
    expect(taxes).toContain("Sandbox validation does not create a legal IRN");
    expect(taxes).toContain("settings.tax.approveEInvoiceSubmit");
    expect(settingsEn).toContain("Approve legal e-invoice submission");
    // The sandbox path must keep saying what it is not.
    expect(settingsEn).toContain("will not claim a legal IRN");
  });
});
