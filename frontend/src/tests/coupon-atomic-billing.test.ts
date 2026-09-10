import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const billingPage = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");
const billingQueries = readFileSync("src/features/core/billing/queries.ts", "utf8");
const offerApi = readFileSync("src/features/core/offers/api.ts", "utf8");
const billingTypes = readFileSync("src/features/core/billing/pages/billing-types.ts", "utf8");

describe("atomic coupon billing client", () => {
  it("sends the server-verifiable offer reference with bill confirmation", () => {
    expect(billingPage).toContain("offerId: appliedOffer?.id");
    expect(billingPage).toContain("offerCode: appliedOffer?.code");
    expect(billingPage).toContain("offerDiscount: appliedOffer?.discount");
  });

  it("never performs a fire-and-forget standalone redemption", () => {
    expect(billingPage).not.toContain("redeemOffer(");
    expect(offerApi).not.toContain("/redeem");
    expect(billingQueries).toContain("if (data.offerId ||");
    expect(billingQueries).toContain("return createBill(data)");
  });

  it("persists the validated coupon across reloads and held-bill switching", () => {
    expect(billingTypes).toContain("appliedOffer?: AppliedOffer | null");
    // Field order is not the contract. The draft gained `tableId` mid-list and an
    // exact-substring match went red while the coupon was still being saved, so
    // assert the saved fields themselves.
    const draftFields = (billingPage.match(/writeBillingDraft\(\{([^}]*)\}\)/)?.[1] ?? "").split(",").map((field) => field.trim());
    for (const field of ["activeBillId", "sourceOrderId", "sourceOrderFingerprint", "cart", "discount: safeDiscount", "discountReason", "appliedOffer"]) {
      expect(draftFields).toContain(field);
    }
    // …and read back on both paths: a reload restores the draft, a switch resumes a held bill.
    expect(billingPage).toContain("setAppliedOffer(draft.appliedOffer ?? null)");
    expect(billingPage).toContain("setAppliedOffer(bill.appliedOffer ?? null)");
  });
});
