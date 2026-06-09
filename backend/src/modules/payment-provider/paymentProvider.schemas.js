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
