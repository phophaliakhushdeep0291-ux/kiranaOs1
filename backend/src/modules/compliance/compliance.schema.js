import { z } from "zod";

export const complianceExportQuery = z.object({
  range: z.enum(["daily", "weekly", "monthly", "yearly", "custom"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(["json", "csv"]).default("json"),
});
