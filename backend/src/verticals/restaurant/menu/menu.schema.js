import { z } from "zod";
import { FOOD_TYPES } from "./menu.service.js";

// Nullable throughout, because clearing a dish's course or spice mark is a real
// edit — a partial() schema whose fields are only .optional() would reject the
// null the UI sends to unset one.
const menuFields = {
  menuCourse: z.string().trim().max(60).nullish(),
  foodType: z.enum(FOOD_TYPES).nullish(),
  spiceLevel: z.coerce.number().int().min(0).max(3).nullish(),
  prepMinutes: z.coerce.number().int().min(0).max(600).nullish(),
  tags: z.union([z.array(z.string().trim().max(30)).max(8), z.string().trim().max(200)]).nullish(),
  menuAvailable: z.coerce.boolean().optional(),
  menuSortOrder: z.coerce.number().int().min(0).max(9999).optional(),
};

export const updateDishMenuSchema = z
  .object(menuFields)
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

export const bulkUpdateMenuSchema = z.object({
  updates: z
    .array(z.object({ productId: z.string().trim().min(1), ...menuFields }))
    .min(1)
    .max(200),
});

/**
 * A dish's portion sizes — Half and Full, Small and Large, Quarter kg.
 *
 * These are stored as the product's selling units, not as a new table, because
 * billing, scanning, pricing rules and BillItem history already read that shape:
 * the cart's unit dropdown, the per-unit price and the `sellingUnitLabel`
 * snapshot on a finalised bill all work the day this ships. What separates a
 * portion from a retail pack row is that it carries NO pack size, so none of the
 * packet arithmetic — conversion to grams, the MRP ceiling scaled per pack —
 * applies to a plate of food.
 */
const variationName = z.string().trim().min(1, "A portion needs a name the waiter can read out").max(40);

export const setDishVariationsSchema = z.object({
  variations: z
    .array(
      z.object({
        /**
         * Present for a portion that already exists, absent for a new one. Sending it
         * back is what lets "Half" be renamed to "Half plate" in place instead of
         * retiring one portion and creating another that shares no history.
         */
        unitCode: z.string().trim().max(60).optional(),
        name: variationName,
        /**
         * Positive, never zero. A zero here would quietly bill a dish at nothing, and
         * a free item is a dish priced at zero with no portions — not a portion.
         */
        price: z.coerce.number().positive("A portion needs a price").max(1_000_000),
        /**
         * How much of one full portion this is: Half = 0.5. It drives what the kitchen
         * actually loses, so a half plate takes half the recipe out of stock.
         */
        portionFactor: z.coerce.number().positive().max(100).default(1),
        isDefault: z.coerce.boolean().default(false),
      }),
    )
    // Twelve is already more portions than a guest will read; the cap is here so a
    // bad loop client-side cannot write hundreds of rows against one dish.
    .max(12),
});
