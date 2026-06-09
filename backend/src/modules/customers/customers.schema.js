import { z } from "zod";
import { moneyAmount } from "../../utils/validationSchemas.js";

export const createCustomerSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Valid Indian mobile required").optional().nullable(),
  type: z.enum(["regular", "udhar"]).default("regular"),
  udharAmount: moneyAmount().default(0).optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  reminderOverrideUntil: z.string().datetime().optional(),
});

export const udharPaymentSchema = z.object({
  amount: moneyAmount({ positive: true }),
  mode: z.enum(["cash", "upi"]),
  note: z.string().optional(),
});


export const reverseUdharPaymentSchema = z.object({
  reason: z.string().min(3, "Reversal reason required").max(500),
  ownerPin: z.string().optional(),
});
