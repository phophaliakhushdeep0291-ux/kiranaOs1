import { describe, expect, it } from "vitest";
import { ean13CheckDigit, ean13Modules, ean13Svg, generateInternalEan13, normalizeEan13 } from "@/lib/barcode/ean13";
import { buildLabelSheetHtml } from "@/features/core/products/label-print";

describe("ean13 encoder", () => {
  it("computes the standard check digit", () => {
    // Well-known reference numbers.
    expect(ean13CheckDigit("400638133393")).toBe(1); // 4006381333931
    expect(ean13CheckDigit("890103100355")).toBe(3); // weighted sum 77 → 3
    expect(ean13CheckDigit("000000000000")).toBe(0);
  });

  it("normalizes 12-digit bodies and validates 13-digit codes", () => {
    expect(normalizeEan13("4006381333931")).toBe("4006381333931");
    expect(normalizeEan13("4006381333930")).toBeNull(); // bad check digit
    expect(normalizeEan13("890103100355")).toBe("8901031003553");
    expect(normalizeEan13("no-barcode")).toBeNull();
    expect(normalizeEan13("")).toBeNull();
    expect(normalizeEan13(null)).toBeNull();
  });

  it("generates valid restricted-circulation barcodes for in-store labels", () => {
    const generated = generateInternalEan13();
    expect(generated).toMatch(/^29\d{11}$/);
    expect(normalizeEan13(generated)).toBe(generated);
  });

  it("emits exactly 95 modules with guards in place", () => {
    const modules = ean13Modules("4006381333931");
    expect(modules).toHaveLength(95);
    expect(modules.startsWith("101")).toBe(true);
    expect(modules.endsWith("101")).toBe(true);
    expect(modules.slice(45, 50)).toBe("01010"); // centre guard
  });

  it("encodes the leading digit through left-half parity", () => {
    // Digit 0 → all L-codes (odd parity); each L-code starts with 0 and has
    // odd bit-count. Leading 4 mixes G-codes in — the two strings must differ.
    const zero = ean13Modules("0006381333931".slice(0, 12) + String(ean13CheckDigit("000638133393")));
    const four = ean13Modules("4006381333931");
    expect(zero.slice(3, 45)).not.toBe(four.slice(3, 45));
    // Right half is parity-independent for identical digits (the final R-code
    // differs because the check digits differ, so compare the shared five).
    expect(zero.slice(50, 85)).toBe(four.slice(50, 85));
  });

  it("renders an svg with bars and human-readable digits", () => {
    const svg = ean13Svg("4006381333931");
    expect(svg).toContain("<svg");
    expect(svg).toContain("<rect");
    expect(svg).toContain("4006381333931");
  });
});

describe("label sheet", () => {
  it("uses EAN-13 bars for barcoded products and QR for the rest", () => {
    const html = buildLabelSheetHtml([
      { id: "p1", name: "Sugar Jar", barcode: "8901031003553", defaultPricePerRateUnit: 45, displayUnit: "piece" },
      { id: "p2", name: "Loose Rice", sku: "RICE-01", defaultPricePerRateUnit: 60, displayUnit: "kg" },
    ]);
    expect(html).toContain("Sugar Jar");
    expect(html).toContain("8901031003553");
    expect(html).toContain("Loose Rice");
    expect(html).toContain("RICE-01"); // QR caption for the unbarcoded product
    expect(html).toContain("Rs 45");
    expect(html).toContain("Rs 60");
  });

  it("repeats labels per the copies option and escapes markup", () => {
    const html = buildLabelSheetHtml(
      [{ id: "p3", name: "<b>Chili & Spice</b>", defaultPricePerRateUnit: 20 }],
      { copies: 3 },
    );
    expect(html).not.toContain("<b>Chili");
    expect((html.match(/Chili &amp; Spice/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("shows MRP only when above the selling price", () => {
    const withMrp = buildLabelSheetHtml([{ name: "Tea", defaultPricePerRateUnit: 120, mrp: 140 }]);
    const withoutMrp = buildLabelSheetHtml([{ name: "Tea", defaultPricePerRateUnit: 120, mrp: 120 }]);
    expect(withMrp).toContain("MRP Rs 140");
    expect(withoutMrp).not.toContain("MRP");
  });
});
