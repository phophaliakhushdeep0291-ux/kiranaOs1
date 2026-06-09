import { z } from "zod";
import { PLAN_CODES } from "./planConfig.js";

const planCode = z.enum(PLAN_CODES);
const billingCycle = z.enum(["monthly", "yearly"]);

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

export const checkoutSchema = z.object({
  planCode,
  billingCycle: billingCycle.default("monthly"),
  provider: z.enum(["razorpay"]).default("razorpay"),
});

export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
  transactionId: z.string().min(1),
});
