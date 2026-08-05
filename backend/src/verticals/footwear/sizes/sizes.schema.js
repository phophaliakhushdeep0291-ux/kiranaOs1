import { z } from "zod";
import { SIZE_GENDERS, SIZE_SYSTEMS } from "./size-systems.js";

export const sizeProfileSchema = z.object({
  sizeSystem: z.enum(SIZE_SYSTEMS),
  gender: z.enum(SIZE_GENDERS).default("unisex"),
  /** "D", "2E", "Narrow" — for the shops that stock width fittings. */
  widthFit: z.string().trim().max(20).nullish(),
  notes: z.string().trim().max(500).nullish(),
});

export const findBySizeSchema = z.object({
  system: z.enum(SIZE_SYSTEMS),
  // Kept as text: half sizes are written "8.5" and "8½" off a box, and a
  // number would lose the distinction between EU 44.5 and CM 28.5.
  value: z.string().trim().min(1, "Enter a size to look up").max(12),
  gender: z.enum(SIZE_GENDERS).default("unisex"),
});
