import { z } from "zod";
import { quantityAmount } from "../../utils/validationSchemas.js";

export const listPurchaseReturnsSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100), locationId: z.string().min(1).optional() });
export const createPurchaseReturnSchema = z.object({
  purchaseReceiptId: z.string().min(1),
  refundMode: z.enum(["supplier_credit", "cash", "bank"]).default("supplier_credit"),
  reason: z.string().trim().min(3).max(500),
  supplierReference: z.string().trim().max(100).optional(),
  items: z.array(z.object({ purchaseReceiptItemId: z.string().min(1), quantityBaseQty: quantityAmount({ positive: true }) })).min(1).max(100),
}).superRefine((value, context) => {
  const ids = new Set(); value.items.forEach((item, index) => { if (ids.has(item.purchaseReceiptItemId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index], message: "A receipt line can appear only once" }); ids.add(item.purchaseReceiptItemId); });
});
