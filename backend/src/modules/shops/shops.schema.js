import { z } from "zod";

export const updateShopSchema = z.object({
  name: z.string().min(2).optional(),
  ownerName: z.string().min(2).optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  gstNumber: z.string().optional(),
  phone: z.string().optional(),
  settingsJson: z.string().max(20000).optional(),
});

/**
 * What the counter asks for when a guest wants to pay by scanning.
 *
 * Amount in paise so the figure the guest approves is the figure on the bill —
 * a float here reaches a UPI app as 1234.5599999 or refuses to parse.
 */
export const upiCollectSchema = z.object({
  amountPaise: z.number().int().positive(),
  note: z.string().trim().max(50).optional(),
  reference: z.string().trim().regex(/^[A-Za-z0-9-]{1,35}$/).optional(),
});

export const businessTypeCompatibilitySchema = z.object({
  targetBusinessType: z.enum(["kirana", "clothing", "footwear", "auto_parts", "electronics", "pharmacy", "stationery", "furniture", "cosmetics", "restaurant", "other"]),
});

export const setupStatusSchema = z.object({
  status: z.enum(["pending", "complete"]),
});
