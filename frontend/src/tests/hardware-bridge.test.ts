import { describe, expect, it } from "vitest";
import { isScaleBillingUnit, normalizeHardwareBridgeUrl, scaleReadingToBillingQuantity } from "@/features/core/hardware/local-hardware-bridge";

describe("local hardware bridge security boundary", () => {
  it("accepts only loopback HTTP(S) endpoints", () => {
    expect(normalizeHardwareBridgeUrl("http://127.0.0.1:17873/")).toBe("http://127.0.0.1:17873");
    expect(normalizeHardwareBridgeUrl("https://localhost:17873")).toBe("https://localhost:17873");
    expect(() => normalizeHardwareBridgeUrl("https://printer.example.com")).toThrow(/localhost/i);
    expect(() => normalizeHardwareBridgeUrl("http://192.168.1.20:17873")).toThrow(/localhost/i);
  });

  it("rejects embedded credentials and query-string routing", () => {
    expect(() => normalizeHardwareBridgeUrl("http://user:pass@127.0.0.1:17873")).toThrow(/credentials/i);
    expect(() => normalizeHardwareBridgeUrl("http://127.0.0.1:17873?target=remote")).toThrow(/query/i);
  });

  it("converts stable gram and kilogram readings to millesimal billing quantities", () => {
    expect(isScaleBillingUnit("kg")).toBe(true);
    expect(isScaleBillingUnit("grams")).toBe(true);
    expect(isScaleBillingUnit("litre")).toBe(false);
    expect(scaleReadingToBillingQuantity({ weight: 525, unit: "g", stable: true }, "kg")).toBe(0.525);
    expect(scaleReadingToBillingQuantity({ weight: 1.25, unit: "kg", stable: true }, "gram")).toBe(1250);
  });

  it("rejects unstable, empty, excessive, and incompatible readings", () => {
    expect(() => scaleReadingToBillingQuantity({ weight: 1, unit: "kg", stable: false }, "kg")).toThrow(/not stable/i);
    expect(() => scaleReadingToBillingQuantity({ weight: 0, unit: "g", stable: true }, "kg")).toThrow(/invalid or empty/i);
    expect(() => scaleReadingToBillingQuantity({ weight: 1001, unit: "kg", stable: true }, "kg")).toThrow(/safety limit/i);
    expect(() => scaleReadingToBillingQuantity({ weight: 500, unit: "g", stable: true }, "litre")).toThrow(/cannot be applied/i);
  });
});
