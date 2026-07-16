import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const billingPage = readFileSync("src/features/billing/pages/BillingPage.tsx", "utf8");
const billingQueries = readFileSync("src/features/billing/queries.ts", "utf8");
const offerApi = readFileSync("src/features/offers/api.ts", "utf8");
const billingTypes = readFileSync("src/features/billing/pages/billing-types.ts", "utf8");

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
    expect(billingPage).toContain("writeBillingDraft({ activeBillId, sourceOrderId, cart, discount: safeDiscount, appliedOffer");
    expect(billingPage).toContain("setAppliedOffer(bill.appliedOffer ?? null)");
  });
});
