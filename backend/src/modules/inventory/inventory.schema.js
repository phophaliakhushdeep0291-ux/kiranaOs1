import { z } from "zod";
import { moneyAmount, quantityAmount } from "../../utils/validationSchemas.js";

const optionalText = z.string().trim().min(1).max(80).optional();
const purchaseDueDate = z.string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Purchase due date must be YYYY-MM-DD")
  .optional();

export const purchaseSchema = z.object({
  productId: z.string(),
  supplierId: z.string().optional(),
  supplierName: z.string().default("Unknown Supplier"),
  invoiceNumber: optionalText,
  purchaseBillNo: optionalText,
  supplierBillNo: optionalText,
  quantity: quantityAmount({ positive: true }),
  enteredUnit: z.string(),
  billAmount: moneyAmount({ positive: true }),
  purchasePaymentStatus: z.enum(["paid", "partial", "due"]).optional(),
  purchasePaymentMode: z.enum(["cash", "upi", "bank"]).optional(),
  purchasePaidAmount: moneyAmount().optional(),
  purchaseDueAmount: moneyAmount().optional(),
  purchaseDueDate,
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
  productId: z.string(),
  quantity: quantityAmount({ positive: true }),
  enteredUnit: z.string(),
  note: z.string().optional(),
});

export const correctionSchema = z.object({
  productId: z.string(),
  newStockBaseQty: quantityAmount(),
  note: z.string().optional(),
});

export const ledgerQuerySchema = z.object({
  productId: z.string().optional(),
  action: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(100),
});
