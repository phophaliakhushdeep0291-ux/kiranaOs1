import { z } from "zod";
import { moneyAmount, percentageRate, quantityAmount } from "../../utils/validationSchemas.js";

export const createProductSchema = z.object({
  name: z.string().min(1),
  category: z.string().default("general"),
  aliases: z.array(z.string()).default([]),
  displayUnit: z.string().default("piece"),
  baseUnit: z.string().default("piece"),
  rateUnit: z.string().default("piece"),
  stockBaseQty: quantityAmount().default(0),
  costPerRateUnit: moneyAmount().default(0),
  minPricePerRateUnit: moneyAmount().default(0),
  defaultPricePerRateUnit: moneyAmount(),
  gstRate: percentageRate().default(0),
  hsn: z.string().optional(),
  brand: z.string().optional(),
  mrp: moneyAmount().default(0),
  reorderLevel: quantityAmount().default(0),
  description: z.string().max(500).optional(),
  imageUrl: z.string().optional(),
  isLooseItem: z.boolean().default(false),
  lowStockThreshold: quantityAmount().default(0),
});

export const updateProductSchema = createProductSchema.partial();

export const productQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  lowStock: z.coerce.boolean().optional(),
});
