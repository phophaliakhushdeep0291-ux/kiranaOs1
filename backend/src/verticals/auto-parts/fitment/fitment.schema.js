import { z } from "zod";

/**
 * Vehicles have been made for a long time and will go on being made, so the year
 * bounds are generous rather than clever. What they must stop is a typo like
 * "205" quietly excluding every real vehicle from a fitment.
 */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const year = z.coerce.number().int().min(MIN_YEAR).max(MAX_YEAR).nullish();

export const CROSS_REFERENCE_KINDS = ["oem", "alternative", "supersedes", "superseded_by"];

export const createFitmentSchema = z
  .object({
    productId: z.string().trim().min(1, "Choose which part this is"),
    make: z.string().trim().min(1, "Enter the make, e.g. Maruti Suzuki").max(80),
    model: z.string().trim().min(1, "Enter the model, e.g. Swift").max(80),
    /** Null means the part fits every variant of the model. */
    variant: z.string().trim().max(80).nullish(),
    yearFrom: year,
    yearTo: year,
    notes: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.yearFrom == null || v.yearTo == null || v.yearTo >= v.yearFrom, {
    message: "The last year cannot be before the first",
    path: ["yearTo"],
  });

export const updateFitmentSchema = z
  .object({
    make: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(80).optional(),
    variant: z.string().trim().max(80).nullish(),
    yearFrom: year,
    yearTo: year,
    notes: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.yearFrom == null || v.yearTo == null || v.yearTo >= v.yearFrom, {
    message: "The last year cannot be before the first",
    path: ["yearTo"],
  });

/**
 * Several fitments for one part in one go. A single oil filter routinely covers
 * a dozen model-years, and adding them one at a time is how a shop gives up on
 * recording them at all.
 */
export const bulkFitmentSchema = z.object({
  productId: z.string().trim().min(1, "Choose which part this is"),
  fitments: z
    .array(
      z
        .object({
          make: z.string().trim().min(1, "Enter the make").max(80),
          model: z.string().trim().min(1, "Enter the model").max(80),
          variant: z.string().trim().max(80).nullish(),
          yearFrom: year,
          yearTo: year,
          notes: z.string().trim().max(500).nullish(),
        })
        .refine((v) => v.yearFrom == null || v.yearTo == null || v.yearTo >= v.yearFrom, {
          message: "The last year cannot be before the first",
          path: ["yearTo"],
        }),
    )
    .min(1, "Add at least one vehicle")
    .max(200),
});

export const createCrossReferenceSchema = z.object({
  productId: z.string().trim().min(1, "Choose which part this is"),
  /** Set only when the alternative is something this shop actually stocks. */
  alternateProductId: z.string().trim().min(1).nullish(),
  partNumber: z.string().trim().min(1, "Enter the part number").max(80),
  brand: z.string().trim().max(80).nullish(),
  kind: z.enum(CROSS_REFERENCE_KINDS).default("alternative"),
  notes: z.string().trim().max(500).nullish(),
});

export const updateCrossReferenceSchema = z.object({
  alternateProductId: z.string().trim().min(1).nullish(),
  partNumber: z.string().trim().min(1).max(80).optional(),
  brand: z.string().trim().max(80).nullish(),
  kind: z.enum(CROSS_REFERENCE_KINDS).optional(),
  notes: z.string().trim().max(500).nullish(),
});
