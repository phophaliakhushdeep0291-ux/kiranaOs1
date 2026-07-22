import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(new URL("../features/purchases/components/PurchaseOrdersPanel.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../features/purchases/purchase-orders-api.ts", import.meta.url), "utf8");

describe("purchase reorder recommendation transparency", () => {
  it("shows the evidence, confidence and editable recommendation instead of presenting opaque AI output", () => {
    expect(panelSource).toContain("30-day net sales, branch stock, open supplier orders and configured safety levels");
    expect(panelSource).toContain("Rule-based calculation");
    expect(panelSource).toContain("Limited sales evidence");
    expect(panelSource).toContain("edit before saving if supplier lead time or local demand has changed");
    expect(panelSource).not.toContain("AI reorder");
  });

  it("keeps supplier recommendations in explicit one-vendor purchase-order groups", () => {
    expect(panelSource).toContain("Create a separate order for each supplier");
    expect(panelSource).toContain("Only one supplier group is loaded at a time");
    expect(panelSource).toContain("loadSuggestionGroup");
  });

  it("types every field needed to independently audit the backend calculation", () => {
    for (const field of [
      "netSalesBaseQty",
      "salesLineCount",
      "salesWindowDays",
      "averageDailySalesBaseQty",
      "demandTargetBaseQty",
      "targetCoverageDays",
      "openOrderBaseQty",
      "forecastConfidence",
      "reasonCode",
      "explanation",
      "calculationVersion",
    ]) expect(apiSource).toContain(field);
  });
});

describe("three-way purchase reconciliation UX", () => {
  it("keeps missing supplier evidence visibly pending and supports later reconciliation", () => {
    expect(panelSource).toContain("Missing invoices remain visibly pending");
    expect(panelSource).toContain("Reconcile invoice");
    expect(panelSource).toContain("Without both invoice number and total");
  });

  it("shows PO, GRN and invoice values and requires an approval reason for differences", () => {
    expect(panelSource).toContain("Goods receipt");
    expect(panelSource).toContain("Supplier invoice");
    expect(panelSource).toContain("Variance approval reason *");
    expect(panelSource).toContain("Approve variance");
  });

  it("types the complete auditable reconciliation evidence returned by the API", () => {
    for (const field of [
      "expectedGoodsAmount",
      "goodsReceivedAmount",
      "supplierInvoiceAmount",
      "priceVarianceAmount",
      "invoiceVarianceAmount",
      "matchStatus",
      "varianceReason",
    ]) expect(apiSource).toContain(field);
    expect(apiSource).toContain("reconcilePurchaseReceipt");
  });
});
