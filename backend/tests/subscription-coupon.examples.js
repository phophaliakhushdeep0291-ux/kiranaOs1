import assert from "node:assert/strict";
import { env } from "../src/config/env.js";
import { applySubscriptionCoupon } from "../src/modules/payment-provider/paymentProvider.service.js";

const original = env.SUBSCRIPTION_COUPONS_JSON;

try {
  env.SUBSCRIPTION_COUPONS_JSON = JSON.stringify({
    LAUNCH25: { percentOff: 25, plans: ["growth", "pro"], billingCycles: ["yearly"], expiresAt: "2026-12-31T23:59:59.999Z" },
    SAVE500: { fixedOffPaise: 50000, plans: ["pro"] },
  });

  assert.deepEqual(
    applySubscriptionCoupon({ couponCode: " launch25 ", planCode: "growth", billingCycle: "yearly", baseAmountPaise: 499900, now: new Date("2026-07-13T00:00:00.000Z") }),
    { couponCode: "LAUNCH25", discountPaise: 124975, finalAmountPaise: 374925 },
  );
  assert.equal(
    applySubscriptionCoupon({ couponCode: "SAVE500", planCode: "pro", billingCycle: "monthly", baseAmountPaise: 99900 }).finalAmountPaise,
    49900,
  );
  assert.throws(
    () => applySubscriptionCoupon({ couponCode: "LAUNCH25", planCode: "starter", billingCycle: "yearly", baseAmountPaise: 299900 }),
    (error) => error?.code === "COUPON_PLAN_NOT_ELIGIBLE",
  );
  assert.throws(
    () => applySubscriptionCoupon({ couponCode: "MISSING", planCode: "growth", billingCycle: "yearly", baseAmountPaise: 499900 }),
    (error) => error?.code === "COUPON_INVALID",
  );
} finally {
  env.SUBSCRIPTION_COUPONS_JSON = original;
}

console.log("Subscription coupon examples passed");
