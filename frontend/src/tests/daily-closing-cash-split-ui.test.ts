import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/reports/pages/DailyClosingPage.tsx", "utf8");

describe("daily closing cash split UI", () => {
  it("does not double count old udhar in the cash vs UPI split", () => {
    expect(source).toContain("totalIncomingTender");
    expect(source).toContain("(report?.cashReceived ?? 0) + (report?.upiReceived ?? 0) + (report?.bankReceived ?? 0)");
    expect(source).not.toContain("(report?.cashReceived ?? 0) + (report?.oldUdharPaymentReceived ?? 0)");
  });

  it("labels sales, old udhar, and supplier cash separately", () => {
    expect(source).toContain('FlowRow label="Cash sales" value={fmt(report?.cashSales)}');
    expect(source).toContain('FlowRow label="UPI sales" value={fmt(report?.upiSales)}');
    expect(source).toContain('FlowRow label="Bank sales" value={fmt(report?.bankSales)}');
    expect(source).toContain('FlowRow label="Supplier cash paid" value={fmt(report?.purchaseCashPaid)}');
    expect(source).toContain('FlowRow label="Supplier UPI paid" value={fmt(report?.purchaseUpiPaid)}');
    expect(source).toContain('FlowRow label="Supplier bank paid" value={fmt(report?.purchaseBankPaid)}');
  });
});
