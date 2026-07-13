import { z } from "zod";

export const createStockCountSchema = z.object({
  name: z.string().trim().min(3).max(120),
  blindCount: z.boolean().default(true),
  productIds: z.array(z.string().min(1)).max(2000).optional(),
});

export const updateStockCountLinesSchema = z.object({
  lines: z.array(z.object({
    productId: z.string().min(1),
    countedBaseQty: z.coerce.number().finite().min(0).max(1_000_000_000),
    reason: z.string().trim().max(300).optional(),
  })).min(1).max(500),
});

export const stockCountListSchema = z.object({
  status: z.enum(["counting", "review", "applied", "cancelled", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const stockCountDecisionSchema = z.object({
  note: z.string().trim().min(3).max(300).optional(),
  ownerPin: z.string().regex(/^\d{4}$/).optional(),
});
