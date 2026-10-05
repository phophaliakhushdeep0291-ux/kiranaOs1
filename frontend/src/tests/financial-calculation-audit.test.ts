import { describe, expect, it } from "vitest";
import { allocateInvoiceDiscount, computeGstBreakdown, gstGrandTotal, type GstMode } from "@/lib/gst";
import { applyRoundOff, formatMoney, toPaise } from "@/lib/money";
import { calculateInvoiceGst } from "../../../backend/src/utils/gst.js";
import { aggregateFinancialRows } from "@/features/core/finance/services/FinancialAggregationService";
import { dashboardHourlyChart, summariseDashboardPayments } from "@/features/core/dashboard/financial-display";
import { buildReceiptHtml } from "@/features/core/receipts/receipt-print";
import type { Bill } from "@/types/api";

const date = "2026-10-03";
const sale = (extra: object) => ({ id: "sale", createdAt: `${date}T10:00:00`, status: "paid", ...extra }) as Bill & Record<string, unknown>;

describe("independent calculation audit", () => {
  it.each<GstMode>(["none", "inclusive", "exclusive"])("reconciles 1,000 seeded %s invoices with integer tax arithmetic and the backend", (mode) => {
    let seed = 403;
    const next = (maximum: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
    const rates = [0, 5, 12, 18, 28, 0.25, 3.1234];
    for (let invoice = 0; invoice < 1000; invoice += 1) {
      const lines = Array.from({ length: 1 + next(9) }, () => ({ price: next(100000) / 100, quantity: 1, gstRate: rates[next(rates.length)] }));
      const totalPaise = lines.reduce((sum, line) => sum + toPaise(line.price), 0);
      const discount = next(totalPaise + 100) / 100;
      const allocation = allocateInvoiceDiscount(lines.map((line) => line.price), discount);
      const frontend = computeGstBreakdown(lines, mode, {}, discount);
      const backend = calculateInvoiceGst(lines.map((line) => ({ lineTotal: line.price, gstRate: line.gstRate })), discount, mode);
      const expectedTax = allocation.discountedLineTotals.reduce((sum, amount, index) => {
        const paise = toPaise(amount), rate = Math.round(lines[index].gstRate * 10000);
        if (mode === "none") return sum;
        return sum + (mode === "exclusive" ? Math.floor((paise * rate + 500000) / 1000000)
          : paise - Math.floor((paise * 1000000 + (1000000 + rate) / 2) / (1000000 + rate)));
      }, 0);
      expect(toPaise(frontend.gst), `invoice ${invoice}`).toBe(expectedTax);
      expect(frontend.gst).toBe(backend.gst);
      expect(frontend.discount).toBe(backend.discount);
      expect(allocation.discountedLineTotals).toEqual(backend.discountedLineTotals);
      expect(allocation.allocations.reduce((sum, amount) => sum + toPaise(amount), 0)).toBe(toPaise(allocation.discount));
      expect(toPaise(frontend.cgst) + toPaise(frontend.sgst) + toPaise(frontend.igst)).toBe(expectedTax);
    }
  });

  it("carries a hand-calculated mixed-rate discounted bill into all three receipt sizes", () => {
    // 59.75 + 200.50 - 10.25 = 250; tax 2.87 + 34.67 = 37.54; rounded payable 288.
    const gst = computeGstBreakdown([
      { price: 19.95, quantity: 3, lineDiscount: 0.1, gstRate: 5 },
      { price: 100.25, quantity: 2, gstRate: 18 },
    ], "exclusive", {}, 10.25);
    expect(gst).toMatchObject({ lineTotal: 260.25, discountedLineTotal: 250, taxable: 250, gst: 37.54, cgst: 18.78, sgst: 18.76 });
    const rounded = applyRoundOff(gstGrandTotal(260.25, 10.25, gst), true);
    expect(rounded).toEqual({ payable: 288, roundOff: 0.46 });
    for (const paperSize of ["58mm", "80mm", "A4"] as const) {
      const html = buildReceiptHtml({ billNo: "AUDIT-1", shop: { name: "Audit fixture" },
        rows: [{ name: "Five percent item", rate: 19.95, quantity: 3, lineDiscount: 0.1, total: 59.75, gstRate: 5 },
          { name: "Eighteen percent item", rate: 100.25, quantity: 2, total: 200.5, gstRate: 18 }],
        subtotal: gst.lineTotal, discount: gst.discount, total: rounded.payable, roundOff: rounded.roundOff, gst,
        paid: 238, credit: 50, payments: [{ mode: "cash", amount: 100.25 }, { mode: "upi", amount: 87.75 }, { mode: "bank", amount: 50 }],
      }, { paperSize });
      const amounts = ["260.25", "10.25", "0.46", "288", "50"];
      if (paperSize !== "A4") amounts.push("238", "100.25", "87.75");
      for (const amount of amounts) expect(html.includes(`Rs ${amount}`), `${paperSize}: ${amount}`).toBe(true);
      expect(html).not.toMatch(/NaN|undefined|Rs -0(?:<|\s)/);
    }
  });

  it("nets refunds, split tenders and credit without resurrecting cancelled or rejected sales", () => {
    const bills = [
      sale({ grandTotal: 100.5, cashAmount: 40.25, upiAmount: 30.25, bankAmount: 10, creditAmount: 20 }),
      sale({ id: "refund", billType: "sales_return", grandTotal: -25.5, cashAmount: -15.25, creditAmount: -10.25 }),
      sale({ id: "cancelled", status: "cancelled", grandTotal: 999, cashAmount: 999 }),
      sale({ id: "rejected", sync_status: "conflict", grandTotal: 999, cashAmount: 999 }),
    ];
    expect(summariseDashboardPayments(bills, { from: date, to: date })).toEqual({ cash: 25, upi: 30.25, bank: 10, credit: 9.75, total: 75, other: 0 });
  });

  it("buckets observed hourly sales and refunds without moving them to closing time", () => {
    expect(dashboardHourlyChart([{ hour: 9, sales: 100.25, bills: 1 }, { hour: 10, sales: 20.25, bills: 1 },
      { hour: 14, sales: -10.5, bills: 0 }, { hour: 23, sales: 7.25, bills: 1 }]).map((row) => row.sales))
      .toEqual([0, 0, 120.5, -10.5, 0, 7.25]);
  });

  it("reconciles product profit after invoice concessions and preserves saved converted costs", () => {
    const snapshot = aggregateFinancialRows({ date, bills: [sale({ subtotal: 300, grandTotal: 270, discount: 30, waivedAmount: 2.5,
      items: [{ productId: "a", quantity: 500, ratePerRateUnit: 200, costPerRateUnit: 120, lineTotal: 100, lineCost: 60 },
        { productId: "b", quantity: 0.005, lineTotal: 200, lineCost: 100 }],
    })] });
    expect(snapshot.profitToday).toBe(107.5); // 300 - 160 costs - 30 discount - 2.50 waived.
    expect(snapshot.profitByProduct.map((row) => [row.productId, row.revenue, row.cost, row.profit, row.quantity]))
      .toEqual([["b", 180, 100, 78.33, 0.005], ["a", 90, 60, 29.17, 500]]);
    expect(snapshot.profitByProduct.reduce((sum, row) => sum + toPaise(row.profit), 0)).toBe(10750);
  });

  it.each([[121.5, "₹121.50"], [-121.5, "-₹121.50"], [0, "₹0"], [-0.001, "₹0"], [1234567.89, "₹12,34,567.89"]])("preserves the displayed value of %s", (value, expected) => {
    expect(formatMoney(value)).toBe(expected);
  });
});
