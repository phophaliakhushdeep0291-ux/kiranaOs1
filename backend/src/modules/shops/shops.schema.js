import { z } from "zod";

export const updateShopSchema = z.object({
  name: z.string().min(2).optional(),
  ownerName: z.string().min(2).optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  gstNumber: z.string().optional(),
  phone: z.string().optional(),
});
