import { z } from "zod";

/**
 * An identifier as it is stamped on a box. Kept as text, not a number: an IMEI
 * is 15 digits and would lose a leading zero as an integer, and a serial is
 * freely alphanumeric.
 */
const identifier = z
  .string()
  .trim()
  .max(60)
  .regex(/^[A-Za-z0-9\-/]*$/, "An IMEI or serial can only contain letters, digits, - and /")
  .nullish();

export const UNIT_STATUSES = ["in_stock", "sold", "returned", "rma", "lost", "scrapped"];
export const UNIT_CONDITIONS = ["new", "open_box", "refurbished"];

/** Statuses in which the shop still physically holds the unit. */
export const HELD_STATUSES = ["in_stock", "returned", "rma"];

const unitIdentity = z
  .object({
    imei: identifier,
    imei2: identifier,
    serialNumber: identifier,
    condition: z.enum(UNIT_CONDITIONS).default("new"),
    costPrice: z.coerce.number().finite().nonnegative().default(0),
    notes: z.string().trim().max(500).nullish(),
  })
  // A unit nobody can identify is just stock, and the whole point of this table
  // is being able to find one piece again.
  .refine((v) => Boolean(v.imei || v.serialNumber), {
    message: "Enter an IMEI or a serial number",
    path: ["imei"],
  })
  .refine((v) => !v.imei || !v.imei2 || v.imei !== v.imei2, {
    message: "The two IMEI numbers on a dual-SIM handset must differ",
    path: ["imei2"],
  });

/**
 * Receiving a box. Several units of one product arrive together and share a
 * supplier, a purchase bill and usually a cost, so those sit outside the list
 * rather than being retyped per handset.
 */
export const receiveUnitsSchema = z.object({
  productId: z.string().trim().min(1, "Choose which product these units are"),
  purchaseBillId: z.string().trim().min(1).nullish(),
  supplierId: z.string().trim().min(1).nullish(),
  /** Applied to any unit that does not carry its own. */
  costPrice: z.coerce.number().finite().nonnegative().default(0),
  warrantyMonths: z.coerce.number().int().min(0).max(120).default(0),
  units: z.array(unitIdentity).min(1, "Add at least one unit").max(200),
});

export const updateUnitSchema = z.object({
  imei: identifier,
  imei2: identifier,
  serialNumber: identifier,
  condition: z.enum(UNIT_CONDITIONS).optional(),
  costPrice: z.coerce.number().finite().nonnegative().optional(),
  warrantyMonths: z.coerce.number().int().min(0).max(120).optional(),
  supplierId: z.string().trim().min(1).nullish(),
  purchaseBillId: z.string().trim().min(1).nullish(),
  notes: z.string().trim().max(500).nullish(),
});

export const sellUnitSchema = z.object({
  billId: z.string().trim().min(1).nullish(),
  billNumber: z.string().trim().max(60).nullish(),
  customerId: z.string().trim().min(1).nullish(),
  customerName: z.string().trim().max(160).nullish(),
  customerPhone: z.string().trim().max(20).regex(/^[0-9+\-\s()]*$/, "Mobile number can only contain digits").nullish(),
  sellingPrice: z.coerce.number().finite().nonnegative().default(0),
  /** Overrides the months recorded when the unit was received. */
  warrantyMonths: z.coerce.number().int().min(0).max(120).nullish(),
  /** Defaults to today. Backdating is allowed so a missed entry can be caught up. */
  soldOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").nullish(),
  notes: z.string().trim().max(500).nullish(),
});

export const returnUnitSchema = z.object({
  /** Where it goes back to. A returned handset is not new stock. */
  condition: z.enum(UNIT_CONDITIONS).default("open_box"),
  reason: z.string().trim().max(500).nullish(),
});

export const serviceUnitSchema = z.object({
  reason: z.string().trim().max(500).nullish(),
});

export const writeOffUnitSchema = z.object({
  status: z.enum(["lost", "scrapped"]),
  reason: z.string().trim().max(500).nullish(),
});
