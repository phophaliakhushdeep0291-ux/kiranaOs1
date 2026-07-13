import { z } from "zod";
import { moneyAmount, quantityAmount } from "../../utils/validationSchemas.js";

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export const listPurchaseOrdersSchema = z.object({
  status: z.enum(["all", "draft", "sent", "partially_received", "received", "cancelled"]).default("all"),
  locationId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createPurchaseOrderSchema = z.object({
  locationId: z.string().trim().min(1).optional(),
  supplierId: z.string().trim().min(1).optional(),
  supplierName: z.string().trim().min(2).max(120),
  expectedOn: date,
  vendorReference: z.string().trim().max(100).optional(),
  paymentTerms: z.string().trim().max(200).optional(),
  deliveryAddress: z.string().trim().max(500).optional(),
  termsAndConditions: z.string().trim().max(1000).optional(),
  note: z.string().trim().max(500).optional(),
  items: z.array(z.object({
    productId: z.string().trim().min(1),
    orderedBaseQty: quantityAmount({ positive: true }),
    expectedRate: moneyAmount({ positive: true }),
  })).min(1).max(100),
}).superRefine((value, context) => {
  const ids = new Set();
  value.items.forEach((item, index) => {
    if (ids.has(item.productId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "productId"], message: "A product can appear only once" });
    ids.add(item.productId);
  });
});

export const receivePurchaseOrderSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(160).optional(),
  supplierInvoiceNumber: z.string().trim().max(100).optional(),
  paidAmount: moneyAmount().optional(),
  paymentMode: z.enum(["cash", "upi", "bank"]).optional(),
  dueDate: date,
  note: z.string().trim().max(500).optional(),
  updateCost: z.boolean().default(true),
  items: z.array(z.object({
    purchaseOrderItemId: z.string().trim().min(1),
    quantityBaseQty: quantityAmount({ positive: true }),
    actualRate: moneyAmount({ positive: true }),
    batchNumber: z.string().trim().min(1).max(100).optional(),
    manufacturedOn: date,
    expiresOn: date,
  })).min(1).max(100),
}).superRefine((value, context) => {
  const ids = new Set();
  value.items.forEach((item, index) => {
    if (ids.has(item.purchaseOrderItemId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "purchaseOrderItemId"], message: "A purchase-order line can be received only once per receipt" });
    ids.add(item.purchaseOrderItemId);
  });
});

export const cancelPurchaseOrderSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});
