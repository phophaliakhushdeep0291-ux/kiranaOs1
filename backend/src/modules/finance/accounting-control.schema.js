import { z } from "zod";

export const accountingControlQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).superRefine((value, ctx) => {
  if (value.from && value.to && new Date(value.from) > new Date(value.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "to must be on or after from" });
  }
});