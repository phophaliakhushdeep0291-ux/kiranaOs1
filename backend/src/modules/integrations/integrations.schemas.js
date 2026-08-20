import { z } from "zod";

export const INTEGRATION_SCOPES = ["catalog:read", "customers:read", "bills:read"];
export const WEBHOOK_EVENTS = ["bill.created", "payment.recorded", "customer.updated", "customer_order.created", "customer_order.updated", "purchase_order.created", "purchase_order.received", "purchase_receipt.reconciled", "integration.test"];

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.enum(INTEGRATION_SCOPES)).min(1).max(INTEGRATION_SCOPES.length),
  expiresAt: z.string().datetime().nullable().optional(),
}).superRefine((value, ctx) => {
  if (!value.expiresAt) return;
  const expiresAt = Date.parse(value.expiresAt);
  const now = Date.now();
  if (expiresAt <= now + 5 * 60 * 1000) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Expiry must be at least 5 minutes in the future" });
  if (expiresAt > now + 2 * 365 * 24 * 60 * 60 * 1000) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Expiry cannot be more than 2 years away" });
});

export const createWebhookSchema = z.object({
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().url().max(2048),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
});

export const updateWebhookSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  url: z.string().trim().url().max(2048).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length).optional(),
  enabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const integrationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).optional(),
});

export const flipkartOrderSyncSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  maxShipments: z.coerce.number().int().min(1).max(500).default(100),
}).superRefine((value, ctx) => {
  const from = new Date(`${value.from}T00:00:00.000Z`);
  const to = new Date(`${value.to}T00:00:00.000Z`);
  if (to < from) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "End date must be on or after start date" });
    return;
  }
  if ((to.getTime() - from.getTime()) / 86_400_000 > 30) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "A Flipkart sync can cover at most 31 days" });
  }
});

// The books a shop can post to Tally. Sales alone leaves the accountant
// re-keying every purchase and collection by hand, so the default is the full
// set and narrowing it is the deliberate choice.
export const TALLY_DOCUMENTS = Object.freeze(["sales", "purchases", "returns", "receipts", "expenses", "production"]);

export const tallyExportQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  include: z
    .string()
    .trim()
    .default(TALLY_DOCUMENTS.join(","))
    .transform((value) => [...new Set(value.split(",").map((token) => token.trim().toLowerCase()).filter(Boolean))])
    .refine((tokens) => tokens.length > 0, "Choose at least one kind of document to export")
    .refine(
      (tokens) => tokens.every((token) => TALLY_DOCUMENTS.includes(token)),
      `Documents must be any of: ${TALLY_DOCUMENTS.join(", ")}`,
    ),
  // Off by default: most retail shops run Tally accounts-only and keep stock in
  // the POS, and a voucher naming a stock item their company has never heard of
  // is rejected on import. z.coerce.boolean() is not usable here — it reads the
  // string "false" as true.
  inventory: z.enum(["0", "1", "true", "false"]).default("0").transform((value) => value === "1" || value === "true"),
  // Set when pushing to a live Tally, where re-sending a document creates a
  // second voucher. A plain file download leaves it off, because the accountant
  // choosing a date range means to see that whole range.
  unsent: z.enum(["0", "1", "true", "false"]).default("0").transform((value) => value === "1" || value === "true"),
});

export const TALLY_DOCUMENT_TYPES = Object.freeze(["sale", "sales_return", "purchase", "purchase_return", "receipt", "expense", "production"]);

export const tallyPostedBodySchema = z.object({
  documents: z
    .array(
      z.object({
        type: z.enum(TALLY_DOCUMENT_TYPES),
        id: z.string().trim().min(1).max(64),
        voucherNumber: z.string().trim().min(1).max(120),
        remoteId: z.string().trim().min(1).max(80),
      }),
    )
    .min(1, "Nothing was reported as posted")
    .max(20000, "Too many documents in one confirmation"),
});
