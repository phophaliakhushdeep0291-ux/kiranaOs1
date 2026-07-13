import { z } from "zod";

export const lotQuerySchema = z.object({
  locationId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  status: z.enum(["all", "active", "depleted", "quarantined", "recalled"]).default("active"),
  expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export const trackingSchema = z.object({ enabled: z.boolean() });
export const lotStatusSchema = z.object({ status: z.enum(["active", "quarantined", "recalled"]), note: z.string().trim().min(3).max(500) });
