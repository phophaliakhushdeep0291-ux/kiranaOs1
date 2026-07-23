import { describe, expect, it } from "vitest";
import { resolveScanMatch } from "@/features/billing/pages/billing-calculations";
import type { Product } from "@/types/api";

function product(overrides: Record<string, unknown> = {}): Product {
  return { id: "p", name: "Item", barcode: null, sku: null, ...overrides } as never;
}

const SOAP = product({ id: "soap", name: "Soap", barcode: "8901031003553", sku: "SOAP-1" });
const RICE = product({ id: "rice", name: "Rice", barcode: "8901031009999", sku: "RICE-1" });

describe("resolveScanMatch", () => {
  it("matches an exact barcode even when several products are on screen", () => {
    expect(resolveScanMatch("8901031003553", [SOAP, RICE])?.id).toBe("soap");
  });

  it("matches an exact SKU", () => {
    expect(resolveScanMatch("RICE-1", [SOAP, RICE])?.id).toBe("rice");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(resolveScanMatch("  rice-1  ", [SOAP, RICE])?.id).toBe("rice");
  });

  it("adds the sole filtered result when the user typed a few letters", () => {
    expect(resolveScanMatch("soa", [SOAP])?.id).toBe("soap");
  });

  it("returns null when the filter is still ambiguous", () => {
    expect(resolveScanMatch("a", [SOAP, RICE])).toBeNull();
  });

  it("returns null for an empty search or no matches", () => {
    expect(resolveScanMatch("", [SOAP, RICE])).toBeNull();
    expect(resolveScanMatch("   ", [SOAP, RICE])).toBeNull();
    expect(resolveScanMatch("9999999999999", [])).toBeNull();
  });

  it("prefers the exact barcode over a larger filtered set (scanner wins)", () => {
    // Filter left both on screen, but the scanned code is exact → no ambiguity.
    expect(resolveScanMatch("8901031009999", [SOAP, RICE])?.id).toBe("rice");
  });
});
