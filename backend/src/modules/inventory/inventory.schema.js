import { z } from "zod";
import { moneyAmount, quantityAmount } from "../../utils/validationSchemas.js";

const optionalText = z.string().trim().min(1).max(80).optional();
const purchaseDueDate = z.string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Purchase due date must be YYYY-MM-DD")
  .optional();
// Batch dates are day-precision and typed off a printed strip, so they are
// carried as YYYY-MM-DD and parsed to a UTC day by the lot service — the same
// contract the purchase-order receive endpoint already uses.
const batchDay = z.string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Batch date must be YYYY-MM-DD")
  .optional();
const idempotencyKey = z.string().trim().min(8).max(160);
const clientMovementId = z.string().trim().min(8).max(160).optional();

export const purchaseSchema = z.object({
  idempotencyKey,
  clientMovementId,
  locationId: z.string().min(1).optional(),
  productId: z.string(),
  supplierId: z.string().optional(),
  supplierName: z.string().default("Unknown Supplier"),
  invoiceNumber: optionalText,
  purchaseBillNo: optionalText,
  supplierBillNo: optionalText,
  quantity: quantityAmount({ positive: true }),
  enteredUnit: z.string(),
  // Which packaging was received. When set, `quantity` counts that pack ("12 boxes
  // of the 8-pack"), exactly as it does on a bill line, and the base quantity is
  // derived from the pack's own conversion rather than from enteredUnit. Omitted
  // for pooled goods, which keep counting in base/rate units.
  sellingUnitId: z.string().min(1).optional().nullable(),
  billAmount: moneyAmount({ positive: true }),
  purchasePaymentStatus: z.enum(["paid", "partial", "due"]).optional(),
  purchasePaymentMode: z.enum(["cash", "upi", "bank"]).optional(),
  purchasePaidAmount: moneyAmount().optional(),
  purchaseDueAmount: moneyAmount().optional(),
  purchaseDueDate,
  // ── The lot in hand, for stock that carries one ─────────────────────────
  // Optional on the wire even for a batch-tracked product, and deliberately so:
  // an offline device can hold a queued purchase written before this field
  // existed, and an event that can never validate would block its whole outbox.
  // The receiving screen requires them; the server records a lot when it is
  // given one. See recordPurchase.
  batchNumber: z.string().trim().min(1).max(80).optional(),
  manufacturedOn: batchDay,
  expiresOn: batchDay,
  // The MRP printed on THIS batch's pack. Medicine MRP is revised between
  // batches, so the strip in hand and the product record routinely disagree.
  batchMrp: moneyAmount({ positive: true }).optional(),
  note: z.string().optional(),
  updateCost: z.boolean().default(true),
  updateMinPrice: z.boolean().default(false),
}).passthrough().superRefine((purchase, ctx) => {
  const status = purchase.purchasePaymentStatus;
  const paid = purchase.purchasePaidAmount;
  const due = purchase.purchaseDueAmount;

  if (paid !== undefined && paid > purchase.billAmount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["purchasePaidAmount"], message: "Paid amount cannot exceed purchase bill amount" });
  }
  if (due !== undefined && due > purchase.billAmount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["purchaseDueAmount"], message: "Due amount cannot exceed purchase bill amount" });
  }
  if (paid !== undefined && due !== undefined && Math.abs((paid + due) - purchase.billAmount) > 0.01) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["purchaseDueAmount"], message: "Paid amount plus due amount must equal purchase bill amount" });
  }
  if (status === "paid" && due !== undefined && due > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["purchaseDueAmount"], message: "Paid purchase cannot have due amount" });
  }
  if (status === "due" && paid !== undefined && paid > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["purchasePaidAmount"], message: "Due purchase cannot have paid amount" });
  }
  if (status === "partial") {
    if (paid !== undefined && paid <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["purchasePaidAmount"], message: "Partial purchase must have a paid amount" });
    }
    if (paid !== undefined && paid >= purchase.billAmount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["purchasePaidAmount"], message: "Partial purchase paid amount must be less than bill amount" });
    }
  }
});

export const damageSchema = z.object({
  idempotencyKey,
  clientMovementId,
  locationId: z.string().min(1).optional(),
  productId: z.string(),
  quantity: quantityAmount({ positive: true }),
  enteredUnit: z.string(),
  // Which packaging left the shelf, same contract as purchaseSchema: when set,
  // `quantity` counts that pack and its own conversion gives the base quantity.
  sellingUnitId: z.string().min(1).optional().nullable(),
  note: z.string().optional(),
});

export const correctionSchema = z.object({
  idempotencyKey,
  clientMovementId,
  locationId: z.string().min(1).optional(),
  productId: z.string(),
  newStockBaseQty: quantityAmount(),
  note: z.string().optional(),
});

export const ledgerQuerySchema = z.object({
  locationId: z.string().optional(),
  productId: z.string().optional(),
  action: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(100),
});
