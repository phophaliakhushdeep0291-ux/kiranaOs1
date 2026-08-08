import { z } from "zod";

/**
 * A combo's component list.
 *
 * There is no price here on purpose: a combo IS a Product and is sold at that
 * product's own price, so the money lives where every other dish's money lives.
 * This is only the list of what the guest receives.
 */
export const setComboComponentsSchema = z.object({
  components: z
    .array(
      z.object({
        componentProductId: z.string().trim().min(1, "Pick a dish to include").max(60),
        /** 2 roti in a thali. Fractional is legal — half a portion of raita. */
        quantity: z.coerce.number().positive("A combo cannot include none of a dish").max(1000).default(1),
        sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
        note: z.string().trim().max(200).nullish(),
      }),
    )
    .max(24)
    .default([]),
});
