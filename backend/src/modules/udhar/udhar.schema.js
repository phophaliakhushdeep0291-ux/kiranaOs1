import { z } from "zod";

export const udharQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  customerId: z.string().optional(),
  type: z.enum(["debit", "payment", "all"]).default("all"),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(100),
});
