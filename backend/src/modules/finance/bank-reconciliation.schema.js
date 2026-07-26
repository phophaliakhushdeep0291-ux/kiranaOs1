import { z } from "zod";

const accountType = z.enum(["bank", "upi"]);
const optionalText = (max) => z.string().trim().max(max).optional();

export const bankStatementImportSchema = z.object({
  accountType,
  accountName: z.string().trim().min(2).max(100),
  accountLast4: z.string().trim().regex(/^\d{4}$/).optional(),
  fileName: z.string().trim().min(1).max(160),
  csvText: z.string().min(1).max(1_750_000),
  note: optionalText(500),
});

export const bankStatementListQuerySchema = z.object({
  accountType: accountType.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const bankReconciliationQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  status: z.enum(["all", "unmatched", "partial", "matched", "ignored"]).default("all"),
  accountType: accountType.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const bankReconciliationMatchSchema = z.object({
  ledgerRowIds: z.array(z.string().trim().min(1)).min(1).max(100)
    .refine((values) => new Set(values).size === values.length, "Ledger rows must be unique"),
  note: optionalText(500),
});

export const bankReconciliationUnmatchSchema = z.object({
  allocationIds: z.array(z.string().trim().min(1)).min(1).max(100)
    .refine((values) => new Set(values).size === values.length, "Allocations must be unique")
    .optional(),
  reason: z.string().trim().min(5).max(500),
});

export const bankReconciliationIgnoreSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

export const bankReconciliationRestoreSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
