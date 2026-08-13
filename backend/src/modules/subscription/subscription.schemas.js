import { z } from "zod";
import { PLAN_CODES } from "./planConfig.js";

const planCode = z.enum(PLAN_CODES);
const billingCycle = z.enum(["monthly", "yearly"]);
const couponCode = z.string().trim().toUpperCase().min(3).max(32).regex(/^[A-Z0-9_-]+$/);

export const manualActivateSchema = z.object({
  planCode,
  period: billingCycle.default("monthly"),
  provider: z.enum(["manual", "admin"]).default("manual"),
  amountPaise: z.coerce.number().int().positive().optional(),
  paidAt: z.coerce.date().optional(),
  note: z.string().max(500).optional(),
});

export const changePlanSchema = z.object({
  planCode,
});

export const extendGraceSchema = z.object({
  days: z.coerce.number().int().min(1).max(30),
});

export const foundingCustomerSchema = z.object({
  intendedPaidPlanCode: planCode.default("starter"),
  endsAt: z.coerce.date().optional(),
});

export const onboardingPurchaseSchema = z.object({
  amountPaise: z.coerce.number().int().nonnegative().optional(),
  status: z.enum(["recorded", "delivered", "waived", "refunded"]).default("recorded"),
  deliveredAt: z.coerce.date().optional(),
  notes: z.string().trim().max(500).optional(),
  includes: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});

export const checkoutSchema = z.object({
  planCode,
  billingCycle: billingCycle.default("monthly"),
  provider: z.enum(["razorpay"]).default("razorpay"),
  couponCode: couponCode.optional(),
  idempotencyKey: z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9:_-]+$/).optional(),
});

export const validateCouponSchema = z.object({ planCode, billingCycle, couponCode });

export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
  transactionId: z.string().min(1),
});
