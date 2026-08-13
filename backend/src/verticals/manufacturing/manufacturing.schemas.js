import { z } from "zod";

const id = z.string().trim().min(1).max(64);
const qty = z.coerce.number().positive().max(1_000_000_000);

export const createBomSchema = z.object({
  finishedProductId: id,
  name: z.string().trim().min(2).max(160),
  outputQuantityBaseQty: qty,
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(z.object({
    materialProductId: id,
    quantityBaseQty: qty,
    wastagePercent: z.coerce.number().min(0).max(100).default(0),
  })).min(1).max(100),
}).superRefine((value, ctx) => {
  if (new Set(value.items.map((row) => row.materialProductId)).size !== value.items.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "A material can appear only once in a BOM" });
  }
  if (value.items.some((row) => row.materialProductId === value.finishedProductId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "A finished good cannot consume itself" });
  }
});

export const createRunSchema = z.object({
  locationId: id.optional(),
  bomId: id,
  runNumber: z.string().trim().min(1).max(64),
  plannedOutputBaseQty: qty,
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const completeRunSchema = z.object({
  actualOutputBaseQty: qty,
  finishedBatchNumber: z.string().trim().min(1).max(80),
  manufacturedOn: z.string().date(),
  expiresOn: z.string().date(),
  qcStatus: z.enum(["passed", "conditional", "failed"]),
  notes: z.string().trim().max(1000).nullable().optional(),
  consumptions: z.array(z.object({
    productId: id,
    inventoryLotId: id.nullable().optional(),
    sellingUnitId: id.nullable().optional(),
    packageCount: qty.nullable().optional(),
    actualBaseQty: qty,
  })).min(1).max(100),
  outputs: z.array(z.object({
    sellingUnitId: id.nullable().optional(),
    packageCount: qty.nullable().optional(),
    quantityBaseQty: qty,
  })).min(1).max(50),
}).refine((value) => value.expiresOn > value.manufacturedOn, { path: ["expiresOn"], message: "Expiry must be after manufacturing date" });

export const traceQuerySchema = z.object({ batchNumber: z.string().trim().min(1).max(80) });
