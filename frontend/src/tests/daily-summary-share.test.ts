import { describe, expect, it } from "vitest";
import { buildDailyClosingShareText, buildDailyClosingShareUrl } from "@/features/core/reports/daily-summary-share";
import type { DailyClosingReport } from "@/features/core/reports/local-reporting";

function makeReport(overrides: Partial<DailyClosingReport> = {}): DailyClosingReport {
  return {
    date: "2026-06-21",
    totalSales: 5240,
    profitEstimate: 820,
    billCount: 12,
    cashSales: 3100,
    upiSales: 1640,
    cashReceived: 3100,
    upiReceived: 1640,
    udharGiven: 500,
    oldUdharPaymentReceived: 200,
    oldUdharCashReceived: 200,
    oldUdharUpiReceived: 0,
    purchaseCashPaid: 0,
    purchaseUpiPaid: 0,
    purchasePaid: 0,
    purchaseDue: 0,
    expectedCashInDrawer: 3300,
    expectedUpiInBank: 1640,
    topSoldProducts: [
      { name: "Aashirvaad Atta 5kg", quantitySold: 6, revenue: 1590, profitEstimate: 200 },
      { name: "Basmati Rice 1kg", quantitySold: 10, revenue: 1180, profitEstimate: 150 },
    ] as DailyClosingReport["topSoldProducts"],
    lowStockItems: [],
    pendingSyncCount: 0,
    failedSyncCount: 0,
    conflictCount: 0,
    isLocalEstimate: false,
    generatedAt: "2026-06-21T18:00:00.000Z",
    ...overrides,
  };
}

describe("buildDailyClosingShareText", () => {
  it("includes shop, sales+bills, profit, cash/upi and drawer", () => {
    const text = buildDailyClosingShareText({ report: makeReport(), shopName: "Sharma General Store" });
    expect(text).toContain("*Aaj ka Hisaab* — Sharma General Store");
    expect(text).toContain("21 Jun 2026");
    expect(text).toContain("💰 Sales: *₹5,240* (12 bills)");
    expect(text).toContain("📈 Profit: *₹820*");
    expect(text).toContain("🪙 Cash in: ₹3,100");
    expect(text).toContain("📲 UPI in: ₹1,640");
    expect(text).toContain("📒 Udhar given: ₹500");
    expect(text).toContain("✅ Old udhar recovered: ₹200");
    expect(text).toContain("👜 Cash in drawer: *₹3,300*");
    expect(text).toContain("🏆 Top sellers:");
    expect(text).toContain("• Aashirvaad Atta 5kg — ₹1,590");
  });

  it("singularizes one bill and hides zero optional lines", () => {
    const text = buildDailyClosingShareText({
      report: makeReport({ billCount: 1, udharGiven: 0, oldUdharPaymentReceived: 0, purchaseCashPaid: 0, topSoldProducts: [] }),
    });
    expect(text).toContain("(1 bill)");
    expect(text).not.toContain("Udhar given");
    expect(text).not.toContain("Old udhar recovered");
    expect(text).not.toContain("Top sellers");
  });

  it("omits sections disabled in the daily-summary settings", () => {
    const text = buildDailyClosingShareText({
      report: makeReport(),
      include: { profit: false, cashUpi: false, udhar: false },
    });
    expect(text).toContain("💰 Sales:"); // sales left on
    expect(text).not.toContain("📈 Profit:");
    expect(text).not.toContain("🪙 Cash in:");
    expect(text).not.toContain("📲 UPI in:");
    expect(text).not.toContain("📒 Udhar given:");
    expect(text).toContain("👜 Cash in drawer:"); // drawer always shown
  });

  it("includes every section when no include config is given (default on)", () => {
    const text = buildDailyClosingShareText({ report: makeReport() });
    expect(text).toContain("📈 Profit:");
    expect(text).toContain("🪙 Cash in:");
  });

  it("flags an estimate when bills are still syncing", () => {
    const text = buildDailyClosingShareText({ report: makeReport({ isLocalEstimate: true }) });
    expect(text).toContain("still backing up");
  });

  it("builds a wa.me chat-picker url with encoded body", () => {
    const url = buildDailyClosingShareUrl({ report: makeReport(), shopName: "S" });
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(url).not.toContain("\n");
    expect(url).toContain("%F0%9F%93%8A"); // 📊 encoded
  });
});
