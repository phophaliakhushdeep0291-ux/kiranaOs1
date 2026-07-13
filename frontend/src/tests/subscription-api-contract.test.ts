import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/http", () => ({
  apiRequest: apiRequestMock,
}));

import {
  getSubscriptionStatus,
  listSubscriptionPlans,
  requestSubscriptionUpgrade,
  validateSubscriptionCoupon,
  verifySubscriptionPayment,
} from "@/features/subscription/api";

describe("subscription api contract", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it("uses backend current subscription endpoint", async () => {
    apiRequestMock.mockResolvedValueOnce({ planCode: "starter", status: "trial" });

    await getSubscriptionStatus();

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/subscription/current",
      expect.objectContaining({ method: "GET", background: true }),
    );
  });

  it("creates a real checkout instead of a legacy upgrade request", async () => {
    apiRequestMock.mockResolvedValueOnce({ orderId: "order_1", transactionId: "txn_1" });

    await requestSubscriptionUpgrade({ planCode: "growth" });

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/subscription/checkout",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          billingCycle: "monthly",
          provider: "razorpay",
          planCode: "growth",
        }),
      }),
    );
  });

  it("sends an optional coupon to server-side checkout pricing", async () => {
    apiRequestMock.mockResolvedValueOnce({ orderId: "order_2", transactionId: "txn_2", discountPaise: 124975 });

    await requestSubscriptionUpgrade({ planCode: "growth", billingCycle: "yearly", couponCode: "LAUNCH25" });

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/subscription/checkout",
      expect.objectContaining({
        body: JSON.stringify({ billingCycle: "yearly", provider: "razorpay", planCode: "growth", couponCode: "LAUNCH25" }),
      }),
    );
  });

  it("validates a coupon before opening payment checkout", async () => {
    apiRequestMock.mockResolvedValueOnce({ valid: true, couponCode: "LAUNCH25", discountPaise: 124975 });

    await validateSubscriptionCoupon({ planCode: "growth", billingCycle: "yearly", couponCode: "LAUNCH25" });

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/subscription/validate-coupon",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ planCode: "growth", billingCycle: "yearly", couponCode: "LAUNCH25" }),
      }),
    );
  });

  it("verifies subscription payments against backend", async () => {
    apiRequestMock.mockResolvedValueOnce({ activated: true });

    await verifySubscriptionPayment({
      razorpay_order_id: "order_1",
      razorpay_payment_id: "pay_1",
      razorpay_signature: "signature",
      transactionId: "txn_1",
    });

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/subscription/verify-payment",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reads public plans from the subscription plans route", async () => {
    apiRequestMock.mockResolvedValueOnce([]);

    await listSubscriptionPlans();

    expect(apiRequestMock).toHaveBeenCalledWith(
      "/subscription/plans",
      expect.objectContaining({ method: "GET", skipAuth: true, skipDevice: true }),
    );
  });
});
