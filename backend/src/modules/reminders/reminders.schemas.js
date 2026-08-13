import { z } from "zod";

const channel = z.enum(["whatsapp", "sms", "email"]).default("whatsapp");

export const createTemplateSchema = z.object({
  name: z.string().min(2).max(80),
  channel,
  templateText: z.string().min(5).max(1000),
  active: z.boolean().optional(),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  channel: z.enum(["whatsapp", "sms", "email"]).optional(),
  templateText: z.string().min(5).max(1000).optional(),
  active: z.boolean().optional(),
});

export const listLogsQuerySchema = z.object({
  customerId: z.string().optional(),
  status: z.enum(["queued", "sending", "accepted", "sent", "delivered", "read", "failed", "skipped"]).optional(),
  channel: z.enum(["whatsapp", "sms", "email"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sendReminderSchema = z.object({
  customerId: z.string().min(1),
  templateId: z.string().optional(),
  channel,
  customMessage: z.string().min(3).max(1000).optional(),
  overrideCooldown: z.boolean().default(false),
});

export const sendStatementSchema = z.object({
  customerId: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  channel,
  overrideCooldown: z.boolean().default(false),
});
