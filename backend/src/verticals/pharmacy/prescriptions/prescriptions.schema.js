import { z } from "zod";

const dayString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

// Indian mobile numbers as typed at a counter: 10 digits, optionally with +91,
// spaces or dashes. Optional here — a walk-in buying a strip of antibiotics
// often will not give one, and the register must still be recordable.
const phone = z
  .string()
  .trim()
  .max(20)
  .regex(/^[0-9+\-\s()]*$/, "Mobile number can only contain digits")
  .optional()
  .nullable();

/**
 * Which schedule the strictest drug on the slip falls under.
 *
 * "otc" is allowed because a chemist may want the register entry for a repeat
 * customer's own record even where the law does not demand one; the retention
 * and inspection rules only bite on h/h1/x.
 */
export const SCHEDULE_TYPES = ["h", "h1", "x", "otc", "other"];

const prescriptionItemSchema = z.object({
  productId: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(1, "Medicine name is required").max(200),
  strength: z.string().trim().max(60).nullish(),
  dosage: z.string().trim().max(120).nullish(),
  qty: z.coerce.number().finite().positive("Quantity must be more than 0").max(10_000),
  unit: z.string().trim().max(30).default("strip"),
  batchNumber: z.string().trim().max(60).nullish(),
  substitutedFor: z.string().trim().max(200).nullish(),
});

export const createPrescriptionSchema = z.object({
  doctorName: z.string().trim().min(1, "Doctor name is required").max(160),
  doctorRegNo: z.string().trim().max(60).nullish(),
  doctorClinic: z.string().trim().max(200).nullish(),

  customerId: z.string().trim().min(1).nullish(),
  patientName: z.string().trim().min(1, "Patient name is required").max(160),
  patientPhone: phone,
  patientAge: z.string().trim().max(30).nullish(),
  patientGender: z.enum(["male", "female", "other"]).nullish(),
  patientAddress: z.string().trim().max(500).nullish(),

  scheduleType: z.enum(SCHEDULE_TYPES).default("h"),
  prescribedOn: dayString,
  items: z.array(prescriptionItemSchema).min(1, "Add at least one medicine"),

  billId: z.string().trim().min(1).nullish(),
  billNumber: z.string().trim().max(60).nullish(),
  refillsAllowed: z.coerce.number().int().min(0).max(24).default(0),

  imageUrl: z.string().trim().max(2_000_000).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  /** Record and hand over in one step, for the usual counter case. */
  dispenseNow: z.coerce.boolean().default(false),
});

// Partial edits. Every field is optional, but an items array that is present
// must still be non-empty — a register entry listing no medicine is not a
// record of anything.
export const updatePrescriptionSchema = z.object({
  doctorName: z.string().trim().min(1).max(160).optional(),
  doctorRegNo: z.string().trim().max(60).nullish(),
  doctorClinic: z.string().trim().max(200).nullish(),

  customerId: z.string().trim().min(1).nullish(),
  patientName: z.string().trim().min(1).max(160).optional(),
  patientPhone: phone,
  patientAge: z.string().trim().max(30).nullish(),
  patientGender: z.enum(["male", "female", "other"]).nullish(),
  patientAddress: z.string().trim().max(500).nullish(),

  scheduleType: z.enum(SCHEDULE_TYPES).optional(),
  prescribedOn: dayString.optional(),
  items: z.array(prescriptionItemSchema).min(1).optional(),

  billId: z.string().trim().min(1).nullish(),
  billNumber: z.string().trim().max(60).nullish(),
  refillsAllowed: z.coerce.number().int().min(0).max(24).optional(),

  imageUrl: z.string().trim().max(2_000_000).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export const dispensePrescriptionSchema = z.object({
  billId: z.string().trim().min(1).nullish(),
  billNumber: z.string().trim().max(60).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export const cancelPrescriptionSchema = z.object({
  reason: z.string().trim().max(500).nullish(),
});
