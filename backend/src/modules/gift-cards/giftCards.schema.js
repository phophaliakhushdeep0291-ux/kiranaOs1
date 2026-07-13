import { z } from "zod";
import { moneyAmount } from "../../utils/validationSchemas.js";

const expiry = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export const issueGiftCardSchema = z.object({
  amount: moneyAmount({ positive: true }).refine((value) => value <= 100000, "Gift card amount cannot exceed Rs 1,00,000"),
  customerId: z.string().trim().min(1).optional(),
  expiresOn: expiry,
  note: z.string().trim().max(300).optional(),
  ownerPin: z.string().regex(/^\d{4}$/).optional(),
});

export const lookupGiftCardSchema = z.object({ code: z.string().trim().min(10).max(40) });

export const disableGiftCardSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  ownerPin: z.string().regex(/^\d{4}$/).optional(),
});

export const listGiftCardsSchema = z.object({
  status: z.enum(["all", "active", "depleted", "disabled", "expired"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
