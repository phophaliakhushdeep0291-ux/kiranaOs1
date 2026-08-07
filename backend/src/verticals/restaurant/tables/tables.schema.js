import { z } from "zod";

const tableName = z.string().trim().min(1, "A table needs a name the staff call it by").max(60);
const section = z.string().trim().max(60);
const seats = z.coerce.number().int().min(0).max(60);

export const createTableSchema = z.object({
  name: tableName,
  // Optional: normally derived from the name. Accepted so a restaurant that
  // already has stickers printed can keep the codes on them.
  code: z.string().trim().max(40).optional(),
  section: section.default("Dining"),
  seats: seats.default(4),
  selfOrderEnabled: z.coerce.boolean().default(true),
  active: z.coerce.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  locationId: z.string().trim().min(1).nullish(),
});

export const updateTableSchema = z
  .object({
    name: tableName.optional(),
    section: section.optional(),
    seats: seats.optional(),
    selfOrderEnabled: z.coerce.boolean().optional(),
    active: z.coerce.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

/**
 * The whole floor at once. Used when a restaurant lays out its room, and when a
 * till's existing device-local plan is lifted up to the server — which is why
 * `code` is accepted here: matching on it is what stops a second run duplicating
 * every table.
 */
export const replaceFloorPlanSchema = z.object({
  tables: z
    .array(
      z.object({
        name: tableName,
        code: z.string().trim().max(40).optional(),
        section: section.default("Dining"),
        seats: seats.default(4),
        selfOrderEnabled: z.coerce.boolean().default(true),
        sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
      }),
    )
    .max(400),
});
