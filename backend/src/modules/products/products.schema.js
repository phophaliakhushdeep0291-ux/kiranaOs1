import { z } from "zod";
import { moneyAmount, percentageRate, quantityAmount } from "../../utils/validationSchemas.js";

const sellingUnitSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(80),
  unitType: z.string().trim().min(1).max(40),
  unitCode: z.string().trim().min(1).max(80),
  packSizeValue: quantityAmount({ positive: true }).optional().nullable(),
  packSizeUnit: z.string().trim().min(1).max(40).optional().nullable(),
  conversionToBase: quantityAmount({ positive: true }),
  barcode: z.string().trim().max(120).optional().nullable(),
  defaultPrice: moneyAmount({ positive: true }),
  minimumPrice: moneyAmount().optional().nullable(),
  maximumPrice: moneyAmount().optional().nullable(),
  costPrice: moneyAmount().optional().nullable(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

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
  barcode: z.string().optional(),
  sku: z.string().optional(),
  brand: z.string().optional(),
  mrp: moneyAmount().default(0),
  reorderLevel: quantityAmount().default(0),
  description: z.string().max(500).optional(),
  imageUrl: z.string().optional(),
  isLooseItem: z.boolean().default(false),
  lowStockThreshold: quantityAmount().default(0),
  batchTrackingEnabled: z.boolean().default(false),
  sellingUnits: z.array(sellingUnitSchema).max(30).optional(),
  // Optimistic-concurrency guard: the server updatedAt the client based this edit on.
  baseUpdatedAt: z.string().optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const productQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  lowStock: z.coerce.boolean().optional(),
});
