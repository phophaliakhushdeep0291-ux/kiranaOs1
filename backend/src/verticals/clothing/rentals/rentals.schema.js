import { z } from "zod";

const dayString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

// Indian mobile numbers as typed at a counter: 10 digits, optionally with +91,
// spaces or dashes. Normalised down to the bare digits by the service.
const phone = z
  .string()
  .trim()
  .min(1, "Mobile number is required")
  .max(20)
  .regex(/^[0-9+\-\s()]+$/, "Mobile number can only contain digits");

const rentalItemSchema = z.object({
  productId: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(1, "Item name is required").max(200),
  unit: z.string().trim().max(30).default("piece"),
  qty: z.coerce.number().finite().positive("Quantity must be more than 0").max(10_000),
  ratePerDay: z.coerce.number().finite().nonnegative().default(0),
  amount: z.coerce.number().finite().nonnegative().default(0),
});

export const createRentalSchema = z
  .object({
    customerId: z.string().trim().min(1).nullish(),
    customerName: z.string().trim().min(1, "Renter name is required").max(160),
    customerPhone: phone,
    customerAddress: z.string().trim().min(1, "Address is required").max(500),
    idProofType: z.enum(["aadhaar", "pan", "driving_licence", "voter_id", "other"]).nullish(),
    idProofNumber: z.string().trim().max(60).nullish(),
    fromDate: dayString,
    toDate: dayString,
    items: z.array(rentalItemSchema).min(1, "Add at least one item to rent"),
    rentAmount: z.coerce.number().finite().nonnegative().default(0),
    depositAmount: z.coerce.number().finite().nonnegative().default(0),
    advancePaid: z.coerce.number().finite().nonnegative().default(0),
    notes: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => v.toDate >= v.fromDate, {
    message: "Return date cannot be before the booking date",
    path: ["toDate"],
  });

// Partial edits. Dates are validated as a pair in the service, because a PATCH
// may move only one end of the window and the other has to come off the record.
export const updateRentalSchema = z.object({
  customerId: z.string().trim().min(1).nullish(),
  customerName: z.string().trim().min(1).max(160).optional(),
  customerPhone: phone.optional(),
  customerAddress: z.string().trim().min(1).max(500).optional(),
  idProofType: z.enum(["aadhaar", "pan", "driving_licence", "voter_id", "other"]).nullish(),
  idProofNumber: z.string().trim().max(60).nullish(),
  fromDate: dayString.optional(),
  toDate: dayString.optional(),
  items: z.array(rentalItemSchema).min(1).optional(),
  rentAmount: z.coerce.number().finite().nonnegative().optional(),
  depositAmount: z.coerce.number().finite().nonnegative().optional(),
  advancePaid: z.coerce.number().finite().nonnegative().optional(),
  notes: z.string().trim().max(1000).nullish(),
});

export const returnRentalSchema = z.object({
  lateFee: z.coerce.number().finite().nonnegative().default(0),
  damageCharge: z.coerce.number().finite().nonnegative().default(0),
  notes: z.string().trim().max(1000).nullish(),
});

export const cancelRentalSchema = z.object({
  reason: z.string().trim().max(500).nullish(),
});
