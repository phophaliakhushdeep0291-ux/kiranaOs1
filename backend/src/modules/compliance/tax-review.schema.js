import { z } from "zod";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date");

export const taxReviewQuery = z.object({
  from: dateOnly,
  to: dateOnly,
  locationId: z.string().trim().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  const days = (Date.parse(value.to) - Date.parse(value.from)) / 86400000;
  if (days < 0 || days > 365) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "Choose an ordered period of at most 366 days" });
});
