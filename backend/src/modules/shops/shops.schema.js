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

export const businessTypeCompatibilitySchema = z.object({
  targetBusinessType: z.enum(["kirana", "clothing", "footwear", "auto_parts", "electronics", "pharmacy", "stationery", "furniture", "cosmetics", "restaurant", "other"]),
});

export const setupStatusSchema = z.object({
  status: z.enum(["pending", "complete"]),
});
