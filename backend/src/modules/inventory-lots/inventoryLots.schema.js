import { z } from "zod";

export const lotQuerySchema = z.object({
  locationId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  status: z.enum(["all", "active", "depleted", "quarantined", "recalled"]).default("active"),
  expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export const expiryAlertQuerySchema = z.object({
  criticalDays: z.coerce.number().int().min(1).max(3650).default(30),
  warningDays: z.coerce.number().int().min(1).max(3650).default(90),
}).refine((value) => value.warningDays >= value.criticalDays, {
  path: ["warningDays"],
  message: "The warning window must reach at least as far as the critical one",
});
export const trackingSchema = z.object({ enabled: z.boolean() });
export const lotStatusSchema = z.object({ status: z.enum(["active", "quarantined", "recalled"]), note: z.string().trim().min(3).max(500) });
