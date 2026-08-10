import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/core/sales/pages/SalesOverviewPage.tsx", "utf8");

describe("sales overview information hierarchy", () => {
  it("keeps four decision metrics in the primary grid", () => {
    expect(source).toContain('const primaryKpis = kpis.filter');
    expect(source).toContain('["Total Sales", "Total Orders", "Gross Profit", "Refunds"]');
    expect(source).toContain('aria-label="Sales at a glance"');
  });

  it("retains average order and margin as compact supporting metrics", () => {
    expect(source).toContain('aria-label="Supporting sales metrics"');
    expect(source).toContain("Average order");
    expect(source).toContain("Profit margin");
  });

  it("moves diagnostic charts behind an explicit disclosure", () => {
    expect(source).toContain("Detailed analysis");
    expect(source).toContain("Category, store and hourly comparisons");
    expect(source).toContain("detailsOpen ? <>");
  });
});
