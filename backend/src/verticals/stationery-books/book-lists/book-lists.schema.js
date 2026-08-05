import { z } from "zod";

// "2026-27" or a bare "2026". Indian academic years straddle two calendar years,
// so a bare year is ambiguous every April — but a shop that writes it that way
// should not be blocked, only kept consistent.
const academicYear = z
  .string()
  .trim()
  .min(4)
  .max(12)
  .regex(/^\d{4}(-\d{2,4})?$/, "Write the year as 2026-27");

const bookListItemSchema = z.object({
  productId: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(1, "Every line needs a name").max(200),
  qty: z.coerce.number().finite().positive("Quantity must be more than 0").max(1000),
  unit: z.string().trim().max(30).default("piece"),
  /** The spare drawing book: on the list, but not a shortfall if it is out. */
  isOptional: z.coerce.boolean().default(false),
  notes: z.string().trim().max(300).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(500).optional(),
});

export const createBookListSchema = z.object({
  schoolName: z.string().trim().min(1, "Enter the school").max(160),
  className: z.string().trim().min(1, "Enter the class").max(60),
  academicYear,
  /** Optional label for the case one class has two lists ("Science stream"). */
  name: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  isActive: z.coerce.boolean().default(true),
  items: z.array(bookListItemSchema).max(200).default([]),
});

// Partial edits. An items array that is present replaces the whole list, so it
// may legitimately be emptied — a school that withdraws a list leaves a real,
// empty document rather than a deleted one.
export const updateBookListSchema = z.object({
  schoolName: z.string().trim().min(1).max(160).optional(),
  className: z.string().trim().min(1).max(60).optional(),
  academicYear: academicYear.optional(),
  name: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  isActive: z.coerce.boolean().optional(),
  items: z.array(bookListItemSchema).max(200).optional(),
});

export const copyBookListSchema = z.object({
  academicYear: academicYear.optional(),
  className: z.string().trim().min(1).max(60).optional(),
  schoolName: z.string().trim().min(1).max(160).optional(),
  name: z.string().trim().max(80).nullish(),
});
