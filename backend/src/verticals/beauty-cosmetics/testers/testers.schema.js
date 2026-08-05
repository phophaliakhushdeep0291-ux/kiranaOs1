import { z } from "zod";

const dayString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const openTesterSchema = z.object({
  productId: z.string().trim().min(1, "Choose which product this tester is"),
  /** The shade. A tester is opened per shade, not per product. */
  variant: z.string().trim().max(120).nullish(),
  // A quarter is the usual life of a counter tester; a mascara is shorter and a
  // powder longer, so it is per tester rather than a fixed rule.
  expectedDays: z.coerce.number().int().min(1).max(730).default(90),
  /** Defaults to the product's weighted cost. Set it when the shop knows better. */
  costValue: z.coerce.number().finite().nonnegative().nullish(),
  /** Defaults to today. Backdating records a tester opened before this was set up. */
  openedOn: dayString.optional(),
  sellingUnitId: z.string().trim().min(1).nullish(),
  locationId: z.string().trim().min(1).nullish(),
  /**
   * Whether to take the unit out of stock now. False for a shop recording a
   * tester it already removed from the shelf by hand — moving it again would
   * decrement twice.
   */
  moveStock: z.coerce.boolean().default(true),
  notes: z.string().trim().max(500).nullish(),
});

export const closeTesterSchema = z.object({
  // "replaced" means a fresh one went out — the usual case, and the one that
  // costs the shop again. "discarded" means nothing replaced it.
  status: z.enum(["replaced", "discarded"]).default("replaced"),
  notes: z.string().trim().max(500).nullish(),
});

export const updateTesterSchema = z.object({
  variant: z.string().trim().max(120).nullish(),
  expectedDays: z.coerce.number().int().min(1).max(730).optional(),
  costValue: z.coerce.number().finite().nonnegative().optional(),
  notes: z.string().trim().max(500).nullish(),
});
