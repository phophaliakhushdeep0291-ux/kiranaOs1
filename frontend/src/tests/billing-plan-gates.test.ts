import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BUSINESS_TYPE_IDS } from "@/features/core/settings/business-type-store";
import { getPlanForBusinessType } from "@/features/core/subscription/plans";

const billing = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");

/**
 * Loyalty is not a universal feature, and the billing screen is shared by every
 * trade. /loyalty/program is gated server-side by requireFeature, so a shop whose
 * plan will never include it got a 403 on every billing screen it opened —
 * several per load, burying the console errors that matter. The /loyalty route
 * was already gated this way; the inline query on the billing screen was not.
 */
describe("billing plan-gated backend calls", () => {
  it("does not ask for the loyalty program unless the plan includes it", () => {
    expect(billing).toContain('useFeature("loyalty_program")');
    expect(billing).toContain("enabled: isOnline && loyaltyFeature.allowed");
  });

  it("gates on the plan, not the trade, because the same trade differs by plan", () => {
    // The reported shop was a pharmacy on growth, which does not include
    // loyalty; the same pharmacy on pro does. So the answer cannot be derived
    // from the business type — it has to read the subscription snapshot, which
    // is what useFeature does and what the server checks.
    const growth = getPlanForBusinessType("growth", "pharmacy").features;
    const pro = getPlanForBusinessType("pro", "pharmacy").features;
    expect(growth).not.toContain("loyalty_program");
    expect(pro).toContain("loyalty_program");

    // And it is not unique to pharmacy: several trades leave loyalty off growth,
    // so this silenced a 403 on more than one vertical's billing screen.
    const withoutOnGrowth = BUSINESS_TYPE_IDS.filter((businessType) =>
      !getPlanForBusinessType("growth", businessType).features.includes("loyalty_program"),
    );
    expect(withoutOnGrowth.length).toBeGreaterThan(1);
  });

  it("gates on the same entitlement the server checks", () => {
    // decideFeature reads snapshot.plan.features; requireFeatureAccess reads the
    // effective plan's features for the same key. Same name, same answer — a
    // different key here would re-open the 403 while looking gated.
    expect(billing).not.toContain('useFeature("loyalty")');
    expect(billing).toContain("loyaltyFeature.allowed");
  });
});
