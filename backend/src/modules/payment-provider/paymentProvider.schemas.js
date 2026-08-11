import { z } from "zod";
import { PLAN_CODES } from "../subscription/planConfig.js";
import { paiseAmount } from "../../utils/validationSchemas.js";

export const manualPaymentSchema = z.object({
  // shopId is intentionally not accepted here; the authenticated tenant comes from req.shopId.
  planCode: z.enum(PLAN_CODES),
  period: z.enum(["monthly", "yearly"]).default("monthly"),
  amountPaise: paiseAmount({ positive: true }).optional(),
  note: z.string().max(500).optional(),
});

export const retailIntentSchema = z.object({
  amountPaise: paiseAmount({ positive: true }),
  locationId: z.string().min(1).optional(),
  mode: z.enum(["checkout", "dynamic_qr"]).default("checkout"),
});

export const verifyRetailIntentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});
