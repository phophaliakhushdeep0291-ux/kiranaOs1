import { z } from "zod";

const dayString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

// Indian mobile numbers as typed at a counter. Optional: a walk-in taking a
// quotation away to think about it often will not leave one.
const phone = z
  .string()
  .trim()
  .max(20)
  .regex(/^[0-9+\-\s()]*$/, "Mobile number can only contain digits")
  .optional()
  .nullable();

export const ORDER_STATUSES = [
  "quote", "confirmed", "in_production", "ready", "delivered", "installed", "cancelled",
];

export const PAYMENT_MODES = ["cash", "upi", "bank", "card", "other"];

const orderItemSchema = z.object({
  // Null for a made-to-order piece that is not in the catalogue, which is most
  // of what this trade sells to order.
  productId: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(1, "Every line needs a name").max(200),
  /** "Teak, 6ft, walnut finish" — the spec a carpenter works from. */
  variant: z.string().trim().max(200).nullish(),
  qty: z.coerce.number().finite().positive("Quantity must be more than 0").max(10_000),
  rate: z.coerce.number().finite().nonnegative().default(0),
  /** Whether this line holds a piece off the showroom floor while the order is open. */
  reserveStock: z.coerce.boolean().default(true),
  notes: z.string().trim().max(500).nullish(),
});

export const createOrderSchema = z.object({
  customerId: z.string().trim().min(1).nullish(),
  customerName: z.string().trim().min(1, "Enter the customer's name").max(160),
  customerPhone: phone,
  deliveryAddress: z.string().trim().max(500).nullish(),
  // A quotation is the usual starting point, but a piece sold off the floor for
  // delivery next week is confirmed from the moment it is written.
  status: z.enum(["quote", "confirmed"]).default("quote"),
  items: z.array(orderItemSchema).min(1, "Add at least one item").max(100),
  discount: z.coerce.number().finite().nonnegative().default(0),
  deliveryCharge: z.coerce.number().finite().nonnegative().default(0),
  installCharge: z.coerce.number().finite().nonnegative().default(0),
  quotedOn: dayString.optional(),
  /** What the customer was told. The single most chased number in this trade. */
  promisedOn: dayString.nullish(),
  isCustom: z.coerce.boolean().default(false),
  notes: z.string().trim().max(1000).nullish(),
});

// Partial edits, allowed only while the order is still open — the service
// enforces that, because "open" is a property of the record rather than the
// payload.
export const updateOrderSchema = z.object({
  customerId: z.string().trim().min(1).nullish(),
  customerName: z.string().trim().min(1).max(160).optional(),
  customerPhone: phone,
  deliveryAddress: z.string().trim().max(500).nullish(),
  items: z.array(orderItemSchema).min(1).max(100).optional(),
  discount: z.coerce.number().finite().nonnegative().optional(),
  deliveryCharge: z.coerce.number().finite().nonnegative().optional(),
  installCharge: z.coerce.number().finite().nonnegative().optional(),
  promisedOn: dayString.nullish(),
  isCustom: z.coerce.boolean().optional(),
  notes: z.string().trim().max(1000).nullish(),
});

export const setStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  /** The bill raised when the goods finally went out. */
  billId: z.string().trim().min(1).nullish(),
  billNumber: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(500).nullish(),
});

export const addPaymentSchema = z.object({
  amount: z.coerce.number().finite().positive("Enter how much was paid").max(100_000_000),
  mode: z.enum(PAYMENT_MODES).default("cash"),
  /** Defaults to today. Backdating catches up an advance taken and not entered. */
  paidOn: dayString.optional(),
  reference: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(500).nullish(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(500).nullish(),
});
