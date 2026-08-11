import { z } from "zod";

const auditReason = z.string().trim().min(3).max(500).optional();

export const createOfferSchema = z.object({
  title: z.string().min(1).max(160),
  code: z.string().trim().max(40).optional(),
  type: z.enum(["percentage", "flat"]).default("percentage"),
  value: z.coerce.number().finite().nonnegative(),
  minBillAmount: z.coerce.number().finite().nonnegative().default(0),
  maxDiscount: z.coerce.number().finite().nonnegative().default(0),
  scope: z.enum(["all", "category", "product"]).default("all"),
  scopeValue: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  usageLimit: z.coerce.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
  auditReason,
});

export const updateOfferSchema = createOfferSchema.partial();

export const applyOfferSchema = z.object({
  subtotal: z.coerce.number().finite().nonnegative(),
  code: z.string().trim().optional(),
});

export const offerActionSchema = z.object({ auditReason }).default({});
