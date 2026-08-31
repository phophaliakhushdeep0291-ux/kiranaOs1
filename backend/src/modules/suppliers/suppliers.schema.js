import { z } from "zod";
import { validateGstin } from "../../utils/gst.js";

export const createSupplierSchema = z.object({
  name: z.string().min(1),
  // Every column here is nullable: an explicit null clears it, and whole-record payloads
  // (conflict resolution, sync echoes) carry null for an empty field.
  mobile: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  // Validated rather than free text, because its first two digits decide whether a
  // purchase posts central+state or integrated tax. A typo there sends input tax
  // credit to the wrong government, which is worse than having no GSTIN at all.
  gstin: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => value === "" || validateGstin(value).valid, "Enter a valid 15-character GSTIN")
    .transform((value) => value || null)
    .optional()
    .nullable(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

const statementDate = z.string().trim().refine(
  (value) => !Number.isNaN(new Date(value).getTime()),
  "Enter a valid statement date",
);

export const supplierStatementQuerySchema = z.object({
  from: statementDate.optional(),
  to: statementDate.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
}).superRefine((value, ctx) => {
  if (value.from && value.to && new Date(value.from) > new Date(value.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "Statement end date must be on or after the start date" });
  }
});
