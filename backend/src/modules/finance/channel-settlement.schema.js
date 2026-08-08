import { z } from "zod";

const optionalHeader = z.string().trim().min(1).max(160).optional();

export const channelSettlementImportSchema = z.object({
  provider: z.string().trim().min(2).max(80),
  locationId: z.string().trim().min(1).max(100).optional(),
  fileName: z.string().trim().min(1).max(180),
  csvText: z.string().min(1).max(2_000_000),
  mapping: z.object({
    externalOrderId: z.string().trim().min(1).max(160),
    orderDate: z.string().trim().min(1).max(160),
    orderStatus: optionalHeader,
    gross: z.string().trim().min(1).max(160),
    merchantDiscount: optionalHeader,
    platformCommission: optionalHeader,
    paymentFee: optionalHeader,
    taxOnFees: optionalHeader,
    tcs: optionalHeader,
    tds: optionalHeader,
    adjustment: optionalHeader,
    refund: optionalHeader,
    expectedNet: optionalHeader,
    paidNet: z.string().trim().min(1).max(160),
  }).strict(),
}).strict();

export const channelSettlementImportQuerySchema = z.object({
  provider: z.string().trim().min(1).max(80).optional(),
  locationId: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const channelSettlementReportQuerySchema = z.object({
  importId: z.string().trim().min(1).max(100).optional(),
  provider: z.string().trim().min(1).max(80).optional(),
  locationId: z.string().trim().min(1).max(100).optional(),
  resolutionStatus: z.enum(["all", "open", "matched", "ignored"]).default("all"),
  mismatchType: z.enum([
    "all", "missing_order", "ambiguous_order", "duplicate_settlement", "net_mismatch",
    "expected_net_formula_mismatch", "unpaid_order", "gross_mismatch", "status_mismatch",
  ]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const channelSettlementResolveSchema = z.object({
  action: z.enum(["match", "ignore", "reverse"]),
  customerOrderId: z.string().trim().min(1).max(100).optional(),
  billId: z.string().trim().min(1).max(100).optional(),
  bankStatementTransactionId: z.string().trim().min(1).max(100).optional(),
  reason: z.string().trim().min(5).max(500).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === "match" && !value.customerOrderId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customerOrderId"], message: "Customer order is required for an explicit match" });
  }
  if ((value.action === "ignore" || value.action === "reverse") && !value.reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "A reason is required for this action" });
  }
});
