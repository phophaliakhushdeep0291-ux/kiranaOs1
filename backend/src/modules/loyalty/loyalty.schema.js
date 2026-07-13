import { z } from "zod";

export const updateProgramSchema = z.object({
  active: z.boolean(),
  pointsPerRupee: z.coerce.number().positive().max(100),
  redemptionPaisePerPoint: z.coerce.number().int().min(1).max(10000),
  minimumRedeemPoints: z.coerce.number().int().min(1).max(1000000),
  ownerPin: z.string().regex(/^\d{4}$/).optional(),
});

export const redeemSchema = z.object({
  points: z.coerce.number().int().positive(),
  note: z.string().trim().min(3).max(300),
  ownerPin: z.string().regex(/^\d{4}$/).optional(),
});

