import { z } from "zod";

export const INTEGRATION_SCOPES = ["catalog:read", "customers:read", "bills:read"];
export const WEBHOOK_EVENTS = ["bill.created", "payment.recorded", "customer.updated", "purchase_order.created", "purchase_order.received", "integration.test"];

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

export const tallyExportQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
