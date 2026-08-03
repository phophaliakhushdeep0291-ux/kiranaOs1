import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/features/core/reports/components/BankReconciliationPanel.tsx", "utf8");
const api = readFileSync("src/features/core/reports/bank-reconciliation-api.ts", "utf8");
const reports = readFileSync("src/features/core/reports/pages/ReportsPage.tsx", "utf8");

describe("bank reconciliation UI safety and usability", () => {
  it("is present in Reports and explicitly refuses silent or offline reconciliation", () => {
    expect(reports).toContain("<BankReconciliationPanel from={range.from} to={range.to} />");
    expect(panel).toContain("Suggestions never post a match");
    expect(panel).toContain("No silent automation.");
    expect(panel).toContain("the app will not invent a match");
    expect(panel).toContain("No offline or inferred reconciliation status is shown");
  });

  it("gates the workflow by plan and protects every financial mutation with owner approval", () => {
    expect(panel).toContain('useFeature("csv_import_export")');
    expect(panel).toContain("<UpgradePrompt");
    expect(panel).toContain("<OwnerPinModal");
    for (const operation of [
      "importBankStatement",
      "matchBankTransaction",
      "unmatchBankTransaction",
      "ignoreBankTransaction",
      "restoreBankTransaction",
    ]) expect(panel).toContain(operation);
    expect(api.match(/ownerPin,/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("supports strict CSV onboarding, responsive evidence cards, ambiguity, and multi-row allocation", () => {
    expect(panel).toContain('accept=".csv,text/csv"');
    expect(panel).toContain("MAX_CSV_BYTES");
    expect(panel).toContain("Download template");
    expect(panel).toContain("No partial row import was accepted");
    expect(panel).toContain("Ambiguous tie");
    expect(panel).toContain("allocationOptions");
    expect(panel).toContain("sm:grid-cols-2");
    expect(panel).toContain("lg:grid-cols");
  });

  it("uses only the tenant-scoped server API and exposes all protected actions", () => {
    for (const route of [
      "/accounting/bank-statements/import",
      "/accounting/bank-reconciliation",
      "/match",
      "/unmatch",
      "/ignore",
      "/restore",
    ]) expect(api).toContain(route);
    expect(api).not.toContain("localStorage");
    expect(api).not.toContain("indexedDB");
    expect(api).toContain("autoMatched: false");
  });
});
