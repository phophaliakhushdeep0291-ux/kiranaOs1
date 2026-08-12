import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { hardwareBridgeFailureMessage, isScaleBillingUnit, normalizeHardwareBridgeUrl, scaleReadingToBillingQuantity } from "@/features/core/hardware/local-hardware-bridge";

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

  it("offers a six-character pairing code instead of exposing a long token field", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/features/core/settings/pages/PrinterSettingsPage.tsx"), "utf8");
    expect(source).toContain("6-character pairing code");
    expect(source).toContain("pairHardwareBridge");
    expect(source).not.toContain("Per-device pairing token");
    expect(source).not.toContain("setHardwareBridgeToken(bridgeToken)");
  });

  it("blames the browser, not the printer, when the request is silently held", () => {
    // A browser holding the request until our abort fires is the one failure a
    // counter cannot diagnose: the bridge logs nothing and the printer was never
    // contacted. Sending staff to check paper and cables is the wrong advice.
    const blocked = hardwareBridgeFailureMessage("stalled", "blocked");
    expect(blocked).toMatch(/browser is blocking/i);
    expect(blocked).toMatch(/local network/i);
    expect(blocked).toMatch(/printer itself is not the problem/i);

    // Without evidence the browser is at fault we must not accuse it outright,
    // but must still stop pointing at the printer first.
    const ambiguous = hardwareBridgeFailureMessage("stalled", "unknown");
    expect(ambiguous).toMatch(/service is stopped or this browser is blocking/i);
    expect(ambiguous).toMatch(/before checking the printer/i);

    // A refused connection is a different fault with different advice.
    expect(hardwareBridgeFailureMessage("unreachable", "unknown")).toMatch(/service is running/i);

    // The old wording named a timeout and nothing else, which read as a dead
    // printer. No variant may regress to it.
    for (const state of ["blocked", "unknown"] as const) {
      expect(hardwareBridgeFailureMessage("stalled", state)).not.toMatch(/did not respond in time/i);
    }
  });

  it("only accuses the browser on evidence, never on a granted permission", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/features/core/hardware/local-hardware-bridge.ts"), "utf8");
    // Chrome reports "granted" for local-network access while loopback stays
    // blocked and every request still hangs, so a granted state must collapse
    // into "unknown" rather than clearing the browser.
    expect(source).toContain('state === "granted" ? "unknown" : "blocked"');
    expect(source).not.toContain("Hardware bridge did not respond in time.");
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
