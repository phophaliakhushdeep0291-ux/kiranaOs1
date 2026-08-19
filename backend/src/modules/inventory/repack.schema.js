import { z } from "zod";

export const repackSchema = z.object({
  productId: z.string().trim().min(1),
  fromSellingUnitId: z.string().trim().min(1),
  toSellingUnitId: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  // Spillage and torn packs are declared, never inferred from a leftover: the
  // repack refuses to complete if the maths does not land on whole packs.
  wastageBaseQty: z.coerce.number().min(0).optional(),
  locationId: z.string().trim().min(1).optional(),
  note: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().trim().min(1).max(120).optional(),
}).strict();
