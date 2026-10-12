import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
export const assistantSupplierInput = z.object({
  name: text(120), mobile: z.string().regex(/^[0-9]{10}$/).optional(), address: text(500).optional(),
}).strict();
export const assistantExpenseInput = z.object({
  title: text(160), amount: z.number().finite().positive().max(1_000_000_000)
    .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.0001),
  category: text(60), paymentMode: z.enum(["cash", "upi", "bank", "card", "other"]),
  status: z.enum(["paid", "pending"]), recurringInterval: z.literal("none"),
  spentAt: z.string().datetime(), vendor: text(160).optional(), notes: text(500).optional(),
}).strict();
