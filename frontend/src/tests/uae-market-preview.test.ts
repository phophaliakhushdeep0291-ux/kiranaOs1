import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/money";
import { MARKETS, isUaeTrn, marketBusinessDate, normalizeUaeMobile } from "@/lib/market";
import { calculateUaeVatPreview, parsePreviewDecimal, previewVatReturn, uaeInvoiceKind, type VatPreviewLine } from "@/features/core/settings/uae-vat-preview";

const line = (overrides: Partial<VatPreviewLine> = {}): VatPreviewLine => ({ id: "one", quantityMilli: 1000, unitPriceMinor: 10500, treatment: "standard", ...overrides });

describe("UAE pilot arithmetic and regional contract", () => {
  it("requires an explicit denomination without changing legacy INR formatting", () => {
    expect(formatMoney(100)).toBe("₹100");
    expect(formatMoney(100.05, "AED").replace(/\s/g, " ")).toBe("AED 100.05");
    expect(formatMoney(1000000, "AED").replace(/\s/g, " ")).toBe("AED 1,000,000.00");
    expect(formatMoney(1000000)).toBe("₹10,00,000");
    expect(formatMoney(-0, "AED")).not.toContain("-");
    expect(() => formatMoney(100, "USD" as never)).toThrow("UNSUPPORTED_CURRENCY");
    expect(MARKETS.AE.tradingEnabled).toBe(false);
  });

  it("extracts five dirhams VAT from AED 105 inclusive and adds it to AED 100 exclusive", () => {
    for (const result of [calculateUaeVatPreview([line()], "inclusive"), calculateUaeVatPreview([line({ unitPriceMinor: 10000 })], "exclusive")]) {
      expect(result).toMatchObject({ currencyCode: "AED", netMinor: 10000, vatMinor: 500, totalMinor: 10500 });
    }
    const discounted = calculateUaeVatPreview([line()], "inclusive", 1050);
    expect(discounted).toMatchObject({ netMinor: 9000, vatMinor: 450, totalMinor: 9450 });
  });

  it("does not round an AED 1.05 sale to a whole dirham", () => {
    expect(calculateUaeVatPreview([line({ unitPriceMinor: 105 })], "inclusive")).toMatchObject({ netMinor: 100, vatMinor: 5, totalMinor: 105 });
  });

  it("keeps zero-rated and exempt categories distinct while reconciling mixed-line discounts", () => {
    const result = calculateUaeVatPreview([line(), line({ id: "zero", treatment: "zero" }), line({ id: "exempt", treatment: "exempt" })], "inclusive", 300);
    expect(result).toMatchObject({ netMinor: 30705, vatMinor: 495, totalMinor: 31200 });
    expect(result.lines.map((row) => row.treatment)).toEqual(["standard", "zero", "exempt"]);
    expect(result.lines.map((row) => row.discountMinor)).toEqual([100, 100, 100]);
  });

  it("parses fractional units and rejects lossy or blank cashier entries", () => {
    expect(parsePreviewDecimal("1.125", 3)).toBe(1125);
    expect(parsePreviewDecimal(" 10.05 ", 2)).toBe(1005);
    expect(calculateUaeVatPreview([line({ quantityMilli: 125 })], "inclusive").totalMinor).toBe(1313);
    for (const input of ["", " ", "-1", "NaN", "Infinity", "1e2", "1.001", "1,20", "1.", "999999999999999999"]) expect(() => parsePreviewDecimal(input, 2)).toThrow();
    for (const invalid of [-1, NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER]) expect(() => calculateUaeVatPreview([line({ unitPriceMinor: invalid })], "inclusive")).toThrow();
    expect(() => calculateUaeVatPreview([line({ quantityMilli: 0 })], "inclusive")).toThrow();
    expect(() => calculateUaeVatPreview([line()], "inclusive", 10501)).toThrow();
    expect(() => calculateUaeVatPreview([line(), line()], "inclusive")).toThrow();
    expect(() => calculateUaeVatPreview([], "inclusive")).toThrow();
    expect(() => calculateUaeVatPreview([line({ treatment: "18%" as never })], "inclusive")).toThrow();
  });

  it("uses Dubai midnight independently of the device timezone", () => {
    expect(marketBusinessDate("2026-10-05T19:59:59.999Z", "AE")).toBe("2026-10-05");
    expect(marketBusinessDate("2026-10-05T20:00:00.000Z", "AE")).toBe("2026-10-06");
    expect(marketBusinessDate("2026-10-05T19:00:00Z", "IN")).toBe("2026-10-06");
    expect(marketBusinessDate("2026-10-05T19:00:00Z", "AE")).toBe("2026-10-05");
    expect(() => marketBusinessDate("bad", "AE")).toThrow();
    expect(() => marketBusinessDate("2026-10-05T23:00:00", "AE")).toThrow();
    expect(marketBusinessDate("2026-10-06T00:00:00+04:00", "AE")).toBe("2026-10-06");
  });

  it("retains +971 and validates mobile prefixes without touching India identities", () => {
    for (const input of ["050 123 4567", "+971 (50) 123-4567", "00971501234567", "971501234567"]) expect(normalizeUaeMobile(input)).toBe("+971501234567");
    for (const prefix of ["050", "052", "054", "055", "056", "058"]) expect(normalizeUaeMobile(`${prefix}1234567`)).not.toBeNull();
    for (const input of ["0511234567", "050123456", "+919876543210", "9876543210", "050123456789", "abc"]) expect(normalizeUaeMobile(input)).toBeNull();
    expect(isUaeTrn("100123456789003")).toBe(true);
    expect(isUaeTrn("10012345678900")).toBe(false);
    expect(isUaeTrn("22AAAAA0000A1Z5")).toBe(false);
  });

  it("uses the VAT-inclusive AED 10,000 threshold only for registered buyers", () => {
    expect(uaeInvoiceKind(true, 1000000)).toBe("simplified");
    expect(uaeInvoiceKind(true, 1000001)).toBe("full");
    expect(uaeInvoiceKind(false, 4000000)).toBe("simplified");
  });

  it("conserves every fils through mixed rates, discounts, serialization and three partial returns", () => {
    let seed = 92017;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    for (let run = 0; run < 1000; run++) {
      const rows = Array.from({ length: 1 + random(7) }, (_, index) => line({ id: String(index), quantityMilli: 3 + random(3000), unitPriceMinor: random(100000), treatment: (["standard", "zero", "exempt"] as const)[random(3)] }));
      const mode = run % 2 ? "inclusive" : "exclusive";
      const original = calculateUaeVatPreview(rows, mode);
      const maxDiscount = original.lines.reduce((sum, row) => sum + (mode === "inclusive" ? row.totalMinor : row.netMinor), 0);
      const discount = random(maxDiscount + 1);
      const saved = JSON.parse(JSON.stringify(calculateUaeVatPreview(rows, mode, discount)));
      expect(saved.lines.reduce((sum: number, row: { discountMinor: number }) => sum + row.discountMinor, 0)).toBe(discount);
      expect(saved.netMinor + saved.vatMinor).toBe(saved.totalMinor);
      for (const row of saved.lines) {
        const first = Math.floor(row.quantityMilli / 3);
        const refunds = [previewVatReturn(row, 0, first), previewVatReturn(row, first, first), previewVatReturn(row, first * 2, row.quantityMilli - first * 2)];
        for (const key of ["netMinor", "vatMinor", "totalMinor"] as const) expect(refunds.reduce((sum, refund) => sum + refund[key], 0)).toBe(row[key]);
        expect(() => previewVatReturn(row, row.quantityMilli, 1)).toThrow();
      }
    }
  });
});
