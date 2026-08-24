import { z } from "zod";

const date = z.string().datetime({ offset: true });
const line = z.object({ accountCode: z.string().trim().min(1).max(20), debitPaise: z.number().int().nonnegative().safe().default(0), creditPaise: z.number().int().nonnegative().safe().default(0), memo: z.string().trim().max(500).optional() })
  .refine((value) => (value.debitPaise > 0) !== (value.creditPaise > 0), "Exactly one of debitPaise or creditPaise must be positive");

export const accountCreateSchema = z.object({ code: z.string().trim().regex(/^[A-Z0-9.-]{2,20}$/i), name: z.string().trim().min(2).max(120), category: z.enum(["asset", "liability", "equity", "income", "expense"]), normalSide: z.enum(["debit", "credit"]) });
export const accountUpdateSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), active: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0, "At least one field is required");
export const journalCreateSchema = z.object({ reference: z.string().trim().min(3).max(100), businessDate: date, description: z.string().trim().min(3).max(500), lines: z.array(line).min(2).max(100) });
export const openingBalanceSchema = journalCreateSchema.extend({ reference: z.string().trim().min(3).max(100), description: z.string().trim().max(500).default("Opening balances") });
export const reversalSchema = z.object({ reason: z.string().trim().min(3).max(500), businessDate: date.optional() });
export const periodCreateSchema = z.object({ name: z.string().trim().min(2).max(100), startsAt: date, endsAt: date }).refine((value) => new Date(value.startsAt) <= new Date(value.endsAt), { path: ["endsAt"], message: "endsAt must be on or after startsAt" });
export const periodCloseSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const balanceSheetQuerySchema = z.object({ asOf: date.optional() });
