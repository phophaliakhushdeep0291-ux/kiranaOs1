import { z } from "zod";

const binKind = z.enum(["pick", "bulk", "staging"]);

export const createBinSchema = z.object({
  locationId: z.string().trim().min(1),
  code: z.string().trim().min(1).max(24),
  name: z.string().trim().min(1).max(80).optional(),
  zone: z.string().trim().max(40).optional().nullable(),
  kind: binKind.default("pick"),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
}).strict();

export const updateBinSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  zone: z.string().trim().max(40).optional().nullable(),
  kind: binKind.optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
}).strict();

export const binMapQuerySchema = z.object({
  locationId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  sellingUnitId: z.string().trim().min(1).optional(),
});

// fromBinId/toBinId are nullable on purpose: null means the unplaced pool, so one
// shape covers put-away, bin-to-bin and pulling stock back to the floor.
export const movePlacementSchema = z.object({
  locationId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  sellingUnitId: z.string().trim().min(1).optional().nullable(),
  fromBinId: z.string().trim().min(1).optional().nullable(),
  toBinId: z.string().trim().min(1).optional().nullable(),
  quantityBaseQty: z.coerce.number().positive(),
}).strict();

export const reconcilePlacementsSchema = z.object({
  locationId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  sellingUnitId: z.string().trim().min(1).optional().nullable(),
}).strict();
