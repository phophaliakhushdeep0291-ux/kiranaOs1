import { z } from "zod";

export const INTEGRATION_SCOPES = ["catalog:read", "customers:read", "bills:read"];
export const WEBHOOK_EVENTS = ["bill.created", "payment.recorded", "customer.updated", "stock.low", "sync.failed", "integration.test"];

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.enum(INTEGRATION_SCOPES)).min(1).max(INTEGRATION_SCOPES.length),
  expiresAt: z.string().datetime().nullable().optional(),
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
