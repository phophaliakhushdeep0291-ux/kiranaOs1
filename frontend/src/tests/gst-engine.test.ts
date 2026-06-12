import { describe, expect, it } from "vitest";
import { computeGstBreakdown, gstGrandTotal } from "@/lib/gst";
import { buildReceiptHtml, type ReceiptSnapshot } from "@/features/receipts/receipt-print";

describe("GST engine", () => {
  it("inclusive mode extracts tax without changing the payable", () => {
    // ₹118 MRP at 18% → taxable ₹100, GST ₹18, customer still pays ₹118.
    const b = computeGstBreakdown([{ price: 118, quantity: 1, gstRate: 18 }], "inclusive");
    expect(b.taxable).toBe(100);
    expect(b.gst).toBe(18);
    expect(b.cgst).toBe(9);
    expect(b.sgst).toBe(9);
    expect(b.gstToAdd).toBe(0);
    expect(gstGrandTotal(118, 0, b)).toBe(118);
  });

  it("exclusive mode adds tax on top of entered prices", () => {
    const b = computeGstBreakdown([{ price: 100, quantity: 2, gstRate: 18 }], "exclusive");
    expect(b.taxable).toBe(200);
    expect(b.gst).toBe(36);
    expect(b.gstToAdd).toBe(36);
    expect(gstGrandTotal(200, 0, b)).toBe(236);
  });

  it("cgst + sgst always reconciles exactly to gst", () => {
    // 33.33 inclusive at 5% → odd paisa: split must not lose a paisa.
    const b = computeGstBreakdown([{ price: 33.33, quantity: 1, gstRate: 5 }], "inclusive");
    expect(b.cgst + b.sgst).toBeCloseTo(b.gst, 10);
  });

  it("groups by rate and ignores zero-rated lines for tax", () => {
    const b = computeGstBreakdown([
      { price: 112, quantity: 1, gstRate: 12 },
      { price: 105, quantity: 1, gstRate: 5 },
      { price: 50, quantity: 2, gstRate: 0 },
    ], "inclusive");
    expect(b.byRate.map((r) => r.rate)).toEqual([5, 12]);
    expect(b.gst).toBe(17); // 12 + 5
    expect(b.lineTotal).toBe(317);
    // Zero-rated ₹100 still counts toward taxable value.
    expect(b.taxable).toBe(300);
  });

  it("mode none produces no tax", () => {
    const b = computeGstBreakdown([{ price: 118, quantity: 1, gstRate: 18 }], "none");
    expect(b.gst).toBe(0);
    expect(b.byRate).toEqual([]);
  });

  it("discount caps at the payable base including exclusive gst", () => {
    const b = computeGstBreakdown([{ price: 100, quantity: 1, gstRate: 18 }], "exclusive");
    expect(gstGrandTotal(100, 150, b)).toBe(0); // clamped, never negative
    expect(gstGrandTotal(100, 18, b)).toBe(100);
  });
});

describe("receipt GST breakup", () => {
  const base: ReceiptSnapshot = {
    billNo: "KOS-2001",
    createdAt: "2026-06-12T10:00:00.000Z",
    rows: [{ name: "Ghee 1L", quantity: 1, unit: "pc", rate: 590, total: 590, hsn: "0405" }],
    subtotal: 590,
    discount: 0,
    total: 590,
    paid: 590,
    credit: 0,
    shop: { name: "Test Store" },
  };

  it("prints CGST/SGST rate rows and the inclusive note", () => {
    const html = buildReceiptHtml({
      ...base,
      showHsn: true,
      gst: { mode: "inclusive", gst: 90, cgst: 45, sgst: 45, byRate: [{ rate: 18, taxable: 500, cgst: 45, sgst: 45 }] },
    });
    expect(html).toContain("GST Breakup (CGST + SGST)");
    expect(html).toContain("CGST Rs 45");
    expect(html).toContain("SGST Rs 45");
    expect(html).toContain("@18% on Rs 500");
    expect(html).toContain("total includes GST of Rs 90");
    expect(html).toContain("HSN: 0405");
  });

  it("adds an exclusive GST summary line and skips the note", () => {
    const html = buildReceiptHtml({
      ...base,
      total: 696.2,
      gst: { mode: "exclusive", gst: 106.2, cgst: 53.1, sgst: 53.1, byRate: [{ rate: 18, taxable: 590, cgst: 53.1, sgst: 53.1 }] },
    });
    expect(html).toContain("GST (CGST + SGST)");
    expect(html).not.toContain("Prices are GST-inclusive");
  });

  it("omits the section entirely when there is no tax", () => {
    const html = buildReceiptHtml(base);
    expect(html).not.toContain("GST Breakup");
  });
});
