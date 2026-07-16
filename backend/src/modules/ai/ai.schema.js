import { z } from "zod";

const boundedProductContext = z.object({
  id: z.string().max(100).optional(),
  productId: z.string().max(100).optional(),
  name: z.string().max(120).optional(),
  productName: z.string().max(120).optional(),
  quantity: z.number().finite().min(0).max(1_000_000).optional(),
  unit: z.string().max(30).optional(),
});

export const parseCommandSchema = z.object({
  transcript: z.string().trim().min(1, "Transcript cannot be empty").max(2_000),
  context: z.object({
    currentCart: z.array(boundedProductContext).max(50).optional(),
    currentCustomer: z.object({
      name: z.string().max(100).optional(),
      mobile: z.string().max(30).optional(),
    }).optional(),
    visibleProducts: z.array(boundedProductContext).max(100).optional(),
    currentScreen: z.string().max(160).optional(),
  }).strict().optional(),
}).strict();

export const logActionSchema = z.object({
  transcript: z.string().max(2_000),
  parsedAction: z.record(z.unknown()),
  status: z.enum(["executed", "rejected", "failed", "blocked"]),
  error: z.string().max(500).optional(),
}).strict();
