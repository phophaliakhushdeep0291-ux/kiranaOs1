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
