import { z } from "zod";

const optionalText = z.string().trim().max(160).optional().nullable();

export const createLocationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().min(2).max(16).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()),
  address: optionalText,
  city: optionalText,
  gstNumber: z.string().trim().max(15).optional().nullable(),
  phone: z.string().trim().max(15).optional().nullable(),
});

export const updateLocationSchema = createLocationSchema.partial().extend({
  active: z.boolean().optional(),
});

export const createTransferSchema = z.object({
  fromLocationId: z.string().min(1),
  toLocationId: z.string().min(1),
  note: z.string().trim().max(500).optional().nullable(),
  ownerPin: z.string().regex(/^\d{4}$/).optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantityBaseQty: z.coerce.number().positive().finite(),
  })).min(1).max(100),
});

