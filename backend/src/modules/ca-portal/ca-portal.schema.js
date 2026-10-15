import { z } from "zod";
const period = {
  from: z.string().date().optional(), to: z.string().date().optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
};
export const caPeriodQuerySchema = z.object({ ...period, status: z.enum(["all", "not_reviewed", "attention_needed"]).default("all") });
export const caLinkClientSchema = z.object({
  linkCode: z.string().trim().toUpperCase().regex(/^CA-[A-F0-9]{48}$/),
  note: z.string().trim().max(200).default(""),
});
export const caGenerateCodeSchema = z.object({ expiresInHours: z.number().int().min(1).max(72).default(72) });
export const caTallyExportQuerySchema = z.object({
  ...period,
  inventory: z.enum(["true", "false", "0", "1"]).default("false").transform(v => v === "true" || v === "1"),
  format: z.enum(["json", "xml"]).default("json"),
});
