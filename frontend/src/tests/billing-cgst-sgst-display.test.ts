import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/billing/pages/components/BillingSummary.tsx", "utf8");

// Mirrors halveTax() in BillingSummary.tsx.
function halveTax(gst: number): { cgst: number; sgst: number } {
  const cgst = Math.round((gst / 2) * 100) / 100;
  return { cgst, sgst: Math.round((gst - cgst) * 100) / 100 };
}

describe("CGST/SGST shown on the billing screen", () => {
  // Regression: the summary printed fmtRs(gstAmount / 2) twice. On an inclusive 5% bill of
  // ₹56 the GST is ₹2.67, so each half rendered as ₹1.335 — three decimals is not a real
  // currency amount and cannot go on a GST return.
  it("never renders a raw half of the tax", () => {
    expect(source).not.toContain("fmtRs(gstAmount / 2)");
    expect(source).toContain("halveTax(gstAmount).cgst");
    expect(source).toContain("halveTax(gstAmount).sgst");
  });

  it("keeps both halves at two decimals and summing to the exact tax", () => {
    for (const gst of [2.67, 0.01, 1.005, 5, 13.33, 99.99, 0.05]) {
      const { cgst, sgst } = halveTax(gst);
      expect(Number((cgst + sgst).toFixed(2))).toBe(Number(gst.toFixed(2)));
      for (const half of [cgst, sgst]) {
        const decimals = (String(half).split(".")[1] ?? "").length;
        expect(decimals).toBeLessThanOrEqual(2);
      }
    }
  });

  it("splits the ₹2.67 case into 1.34 + 1.33 rather than 1.335 twice", () => {
    expect(halveTax(2.67)).toEqual({ cgst: 1.34, sgst: 1.33 });
  });

  it("still splits an even tax exactly in half", () => {
    expect(halveTax(9)).toEqual({ cgst: 4.5, sgst: 4.5 });
  });
});
