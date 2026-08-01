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
  // Per-packaging stock, in this unit's own counts (packets, boxes) — not product
  // base units. Only meaningful when the product is "per_pack"; pooled products
  // leave these out and keep using the single Product.stockBaseQty pool.
  onHandQty: quantityAmount().optional().nullable(),
  lowStockThreshold: quantityAmount().optional().nullable(),
  reorderLevel: quantityAmount().optional().nullable(),
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
  // Nullable columns accept an explicit null: that is how a caller clears an optional
  // field, and how a whole-record payload (conflict resolution, sync echo) states the
  // field is empty. Without it every such payload fails with "expected string, received
  // null" even though the value is exactly what the column holds.
  hsn: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  mrp: moneyAmount().default(0),
  reorderLevel: quantityAmount().default(0),
  description: z.string().max(500).optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  isLooseItem: z.boolean().default(false),
  lowStockThreshold: quantityAmount().default(0),
  // "pooled": every packaging draws on one base-unit pool (loose goods — 1 kg and a
  // 5 kg bag come from the same sack). "per_pack": each packaging holds its own
  // count and is reordered on its own (70 g packet vs 8-pack).
  packagingMode: z.enum(["pooled", "per_pack"]).default("pooled"),
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
