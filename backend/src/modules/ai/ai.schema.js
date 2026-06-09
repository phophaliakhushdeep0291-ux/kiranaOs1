import { z } from "zod";

export const parseCommandSchema = z.object({
  transcript: z.string().min(1, "Transcript cannot be empty"),
  context: z.object({
    currentCart: z.array(z.any()).optional(),
    currentCustomer: z.any().optional(),
    visibleProducts: z.array(z.any()).optional(),
    currentScreen: z.string().optional(),
  }).optional(),
});

export const logActionSchema = z.object({
  transcript: z.string(),
  parsedAction: z.any(),
  status: z.enum(["executed", "rejected", "failed", "blocked"]),
  error: z.string().optional(),
});
