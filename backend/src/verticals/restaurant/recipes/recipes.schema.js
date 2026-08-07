import { z } from "zod";

export const saveRecipeSchema = z.object({
  components: z
    .array(
      z.object({
        ingredientProductId: z.string().trim().min(1, "Choose the ingredient"),
        // In the ingredient's own base unit (g, ml, piece) per one portion of the
        // dish. Zero is allowed and means "listed but not counted" — a cook
        // noting the spice mix they have not weighed yet.
        qtyBase: z.coerce.number().finite().nonnegative().max(1_000_000),
        wastagePct: z.coerce.number().finite().min(0).max(90).default(0),
        optional: z.coerce.boolean().default(false),
        note: z.string().trim().max(300).nullish(),
      }),
    )
    .max(60),
});
