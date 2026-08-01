import { z } from "zod";

export const createSupplierSchema = z.object({
  name: z.string().min(1),
  // Both columns are nullable: an explicit null clears them, and whole-record payloads
  // (conflict resolution, sync echoes) carry null for an empty field.
  mobile: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

export const updateSupplierSchema = createSupplierSchema.partial();
