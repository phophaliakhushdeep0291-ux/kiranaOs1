import { describe, expect, it } from "vitest";
import { getPlanForEntitlementSnapshot, getPlanForSubscriptionDisplay } from "@/features/core/subscription/plans";

describe("subscription display pricing", () => {
  it("uses kirana pricing even for legacy feature snapshots", () => {
    const plan = getPlanForSubscriptionDisplay("pro", "kirana", ["basic_billing"]);
    expect(plan.price).toBe(599);
    expect(plan.annualPrice).toBe(5999);
    expect(plan.features).toEqual(getPlanForEntitlementSnapshot("pro", "kirana", ["basic_billing"]).features);
  });

  it("retains the server's locked price and paise precision", () => {
    const plan = getPlanForSubscriptionDisplay("growth", "kirana", null, {
      code: "growth", priceMonthlyPaise: 19950, priceYearlyPaise: 199900,
    });
    expect(plan.price).toBe(199.5);
    expect(plan.annualPrice).toBe(1999);
  });

  it("does not use cached pricing from a different plan", () => {
    const plan = getPlanForSubscriptionDisplay("growth", "kirana", null, {
      code: "starter", priceMonthlyPaise: 9900,
    });
    expect(plan.price).toBe(299);
  });

  it("accepts a free subscription and rejects malformed price fields", () => {
    expect(getPlanForSubscriptionDisplay("starter", "kirana", null, {
      code: "starter", priceMonthlyPaise: 0, priceYearlyPaise: -100,
    })).toMatchObject({ price: 0, annualPrice: 999 });
    expect(getPlanForSubscriptionDisplay("starter", "kirana", null, {
      code: "starter", priceMonthlyPaise: "9900", priceYearlyPaise: Number.NaN,
    })).toMatchObject({ price: 99, annualPrice: 999 });
  });

  it("uses the restaurant's plan name without altering legacy permissions", () => {
    const plan = getPlanForSubscriptionDisplay("growth", "restaurant", null);
    expect(plan.name).toBe("Dine-in");
    expect(plan.features).toEqual(getPlanForEntitlementSnapshot("growth", "restaurant", null).features);
  });
});
