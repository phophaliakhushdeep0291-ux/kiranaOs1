import { z } from "zod";

export const createSupplierSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().optional(),
  address: z.string().optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();
