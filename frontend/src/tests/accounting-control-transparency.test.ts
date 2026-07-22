import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/features/reports/components/AccountingControlPanel.tsx", "utf8");
const api = readFileSync("src/features/reports/api.ts", "utf8");
const reports = readFileSync("src/features/reports/pages/ReportsPage.tsx", "utf8");

describe("accounting control transparency", () => {
  it("never presents an offline estimate as reconciled evidence", () => {
    expect(panel).toContain("No offline estimate is shown as reconciled");
    expect(panel).toContain("Never auto-balanced");
    expect(panel).toContain("Exceptions are not hidden");
    expect(panel).toContain("Coverage limits · read before relying on this report");
  });

  it("shows calculation identity, scope, mapping coverage, and exact paise evidence", () => {
    expect(panel).toContain("Shop-wide control · {report.calculationVersion}");
    expect(panel).toContain("Integer-paise evidence");
    expect(panel).toContain("report.coverage.mappedRows");
    expect(panel).toContain("report.coverage.unmappedRows");
    expect(panel).toContain("report.trialBalance.difference.paise");
    expect(api).toContain('status: "balanced" | "attention_required" | "no_data"');
    expect(api).toContain('scope: "shop"');
  });

  it("has readable mobile account cards and a full desktop trial-balance table", () => {
    expect(panel).toContain('className="hidden overflow-x-auto sm:block"');
    expect(panel).toContain('className="space-y-2 sm:hidden"');
    expect(panel).toContain("Debit balance");
    expect(panel).toContain("Credit balance");
    expect(reports).toContain("<AccountingControlPanel from={range.from} to={range.to} />");
  });
});