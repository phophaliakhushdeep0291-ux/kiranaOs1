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
