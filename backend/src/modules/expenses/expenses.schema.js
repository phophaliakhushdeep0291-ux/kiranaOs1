import { z } from "zod";

export const createExpenseSchema = z.object({
  title: z.string().min(1).max(160),
  amount: z.coerce.number().finite().nonnegative(),
  category: z.string().min(1).max(60).default("general"),
  paymentMode: z.enum(["cash", "upi", "bank", "card", "other"]).default("cash"),
  vendor: z.string().max(160).optional(),
  status: z.enum(["paid", "pending"]).default("paid"),
  recurringInterval: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
  nextDueOn: z.string().optional(),
  notes: z.string().max(500).optional(),
  spentAt: z.string().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const expenseQuerySchema = z.object({
  category: z.string().optional(),
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().optional(),
});
