import { z } from "zod";

export const updateProgramSchema = z.object({
  active: z.boolean(),
  pointsPerRupee: z.coerce.number().positive().max(100),
  redemptionPaisePerPoint: z.coerce.number().int().min(1).max(10000),
  minimumRedeemPoints: z.coerce.number().int().min(1).max(1000000),
  pointsExpireDays: z.coerce.number().int().min(0).max(3650).default(365),
  tiers: z.array(z.object({
    name: z.string().trim().min(2).max(40),
    minLifetimePoints: z.coerce.number().int().min(0).max(100000000),
  })).min(1).max(10).superRefine((tiers, context) => {
    if (tiers[0]?.minLifetimePoints !== 0) context.addIssue({ code: z.ZodIssueCode.custom, message: "The first tier must start at zero points" });
    for (let index = 1; index < tiers.length; index += 1) {
      if (tiers[index].minLifetimePoints <= tiers[index - 1].minLifetimePoints) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "minLifetimePoints"], message: "Tier thresholds must increase" });
    }
  }).default([{ name: "Bronze", minLifetimePoints: 0 }, { name: "Silver", minLifetimePoints: 1000 }, { name: "Gold", minLifetimePoints: 5000 }]),
  ownerPin: z.string().regex(/^\d{4}$/).optional(),
});

export const redeemSchema = z.object({
  points: z.coerce.number().int().positive(),
  note: z.string().trim().min(3).max(300),
  ownerPin: z.string().regex(/^\d{4}$/).optional(),
});
