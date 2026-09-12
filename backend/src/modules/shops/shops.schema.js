import { z } from "zod";
import { BUSINESS_TYPES } from "../../verticals/profile.js";

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
  targetBusinessType: z.enum(BUSINESS_TYPES),
});

export const setupStatusSchema = z.object({
  status: z.enum(["pending", "complete"]),
});
