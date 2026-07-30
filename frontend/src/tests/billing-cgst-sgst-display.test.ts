import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeGstBreakdown } from "@/lib/gst";
import { describeTaxSplit } from "@/features/billing/pages/components/BillingSummary";

const summarySource = readFileSync("src/features/billing/pages/components/BillingSummary.tsx", "utf8");
const pageSource = readFileSync("src/features/billing/pages/BillingPage.tsx", "utf8");

describe("tax split shown on the billing screen", () => {
  // Regression: the summary printed fmtRs(gstAmount / 2) twice. On an inclusive 5% bill of
  // ₹56 the GST is ₹2.67, so each half rendered as ₹1.335 — three decimals is not a real
  // currency amount and cannot go on a GST return.
  it("never renders a raw half of the tax", () => {
    expect(summarySource).not.toContain("fmtRs(gstAmount / 2)");
    expect(summarySource).toContain("describeTaxSplit(gstAmount");
  });

  it("keeps both halves at two decimals and summing to the exact tax", () => {
    for (const gst of [2.67, 0.01, 1.005, 5, 13.33, 99.99, 0.05]) {
      const label = describeTaxSplit(gst);
      const parts = [...label.matchAll(/₹([\d,.]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
      expect(parts).toHaveLength(2);
      expect(Number(parts.reduce((a, b) => a + b, 0).toFixed(2))).toBe(Number(gst.toFixed(2)));
      for (const half of parts) {
        expect((String(half).split(".")[1] ?? "").length).toBeLessThanOrEqual(2);
      }
    }
  });

  it("splits the ₹2.67 case into 1.34 + 1.33 rather than 1.335 twice", () => {
    expect(describeTaxSplit(2.67)).toBe("CGST ₹1.34 + SGST ₹1.33");
  });

  it("still splits an even tax exactly in half", () => {
    expect(describeTaxSplit(9)).toBe("CGST ₹4.5 + SGST ₹4.5");
  });
});

describe("interstate sales are charged IGST, not CGST+SGST", () => {
  // Regression: BillingPage called computeGstBreakdown WITHOUT the jurisdiction argument, so
  // `interstate` was always false and the counter showed CGST+SGST even for an out-of-state
  // buyer. The printed tax invoice already passed the state codes, so the two disagreed.
  it("passes the seller and buyer state codes into the GST engine", () => {
    expect(pageSource).toContain("sellerStateCode, buyerStateCode");
    expect(pageSource).toContain("gstStateCode(shop?.gstNumber)");
  });

  it("labels an interstate supply as IGST for the whole tax", () => {
    expect(describeTaxSplit(2.67, { igst: 2.67, supplyType: "interstate" })).toBe("IGST ₹2.67");
  });

  it("keeps CGST+SGST for an intrastate supply", () => {
    expect(describeTaxSplit(2.67, { cgst: 1.34, sgst: 1.33, supplyType: "intrastate" }))
      .toBe("CGST ₹1.34 + SGST ₹1.33");
  });

  it("matches what the shared GST engine resolves for each jurisdiction", () => {
    const lines = [{ price: 28, quantity: 2, gstRate: 5, lineDiscount: 0 }];

    const sameState = computeGstBreakdown(lines, "inclusive", { sellerStateCode: "23", buyerStateCode: "23" });
    expect(sameState.supplyType).toBe("intrastate");
    expect(describeTaxSplit(sameState.gst, sameState)).toBe("CGST ₹1.34 + SGST ₹1.33");

    const crossState = computeGstBreakdown(lines, "inclusive", { sellerStateCode: "23", buyerStateCode: "27" });
    expect(crossState.supplyType).toBe("interstate");
    expect(crossState.igst).toBe(2.67);
    expect(crossState.cgst).toBe(0);
    expect(describeTaxSplit(crossState.gst, crossState)).toBe("IGST ₹2.67");
  });

  it("treats a walk-in with no buyer state as intrastate", () => {
    const walkIn = computeGstBreakdown([{ price: 28, quantity: 2, gstRate: 5, lineDiscount: 0 }], "inclusive", {
      sellerStateCode: "23",
      buyerStateCode: undefined,
    });
    expect(walkIn.supplyType).toBe("intrastate");
    expect(describeTaxSplit(walkIn.gst, walkIn)).toBe("CGST ₹1.34 + SGST ₹1.33");
  });
});
