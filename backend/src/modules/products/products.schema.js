import { z } from "zod";
import { moneyAmount, percentageRate, quantityAmount } from "../../utils/validationSchemas.js";

/**
 * One axis of a variant grid: "Size" over S/M/L/XL.
 *
 * Two axes at most. Size × colour is what garment and footwear retail actually
 * needs, and a third would multiply the grid past the point a shopkeeper can
 * count stock for. Adding one later is another additive migration.
 */
const variantAxisSchema = z.object({
  name: z.string().trim().min(1).max(40),
  values: z.array(z.string().trim().min(1).max(60)).min(1).max(50),
});

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
  // Where this row sits on the parent's axes — "L", "Blue". Null on ordinary
  // packaging rows. Nullable as well as optional: a whole-record payload states
  // an empty column as null, and .optional() alone rejects that.
  variantValue1: z.string().trim().max(60).optional().nullable(),
  variantValue2: z.string().trim().max(60).optional().nullable(),
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
  // The variant grid this product declares, in axis order. Empty for ordinary
  // products. A product with axes is forced to "per_pack" in the service: each
  // size/colour holds its own stock, and pooled they would share one number.
  variantAxes: z.array(variantAxisSchema).max(2).default([]),
  // Raised from 30 for variant grids — 6 sizes × 6 colours is 36 rows and used
  // to be rejected outright. This array rides the sync payload, so the cap is a
  // real limit on push size, not decoration; 100 covers any grid a counter can
  // physically stock.
  sellingUnits: z.array(sellingUnitSchema).max(100).optional(),
  // Optimistic-concurrency guard: the server updatedAt the client based this edit on.
  baseUpdatedAt: z.string().optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const productQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  lowStock: z.coerce.boolean().optional(),
});
