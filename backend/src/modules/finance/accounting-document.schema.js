import { z } from "zod";

const date = z.string().datetime({ offset: true });
const line = z.object({
  accountCode: z.string().trim().min(1).max(20),
  debitPaise: z.number().int().nonnegative().safe().default(0),
  creditPaise: z.number().int().nonnegative().safe().default(0),
  memo: z.string().trim().max(500).optional(),
}).refine((value) => (value.debitPaise > 0) !== (value.creditPaise > 0), "Exactly one side must be positive");

export const accountingDocumentListSchema = z.object({
  status: z.enum(["review_required", "approved", "rejected"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const accountingDocumentApproveSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  supplierId: z.string().trim().min(1).max(100).optional(),
  businessDate: date.optional(),
  description: z.string().trim().min(3).max(500).optional(),
  lines: z.array(line).min(2).max(100).optional(),
  confirmInputTaxEligibility: z.boolean().default(false),
});

export const accountingDocumentRejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });
