import { z } from "zod";
import { moneyAmount, percentageRate, quantityAmount } from "../../utils/validationSchemas.js";

const billItemSchema = z.object({
  productId: z.string().optional(),
  name: z.string().min(1),
  quantity: quantityAmount({ positive: true }),
  enteredUnit: z.string(),
  ratePerRateUnit: moneyAmount(),
  gstRate: percentageRate().default(0),
});

const paymentSchema = z.object({
  mode: z.enum(["cash", "upi", "credit"]),
  amount: moneyAmount({ positive: true }),
});

export const confirmBillSchema = z.object({
  billType: z.enum(["estimate", "normal_sale", "gst_invoice", "udhar_entry"]).default("normal_sale"),
  // inclusive (default): entered prices already contain GST — the payable stays
  // subtotal − discount and tax is extracted for the invoice breakup.
  // exclusive: GST is added on top of entered prices. none: no GST.
  gstMode: z.enum(["inclusive", "exclusive", "none"]).default("inclusive"),
  customerId: z.string().optional(),
  customerName: z.string().default("Walk-in"),
  items: z.array(billItemSchema).min(1, "At least one item required"),
  discount: moneyAmount().default(0),
  actualAmount: moneyAmount().optional(),
  buyerPaidAmount: moneyAmount().optional(),
  waivedAmount: moneyAmount().default(0),
  creditAmount: moneyAmount().default(0).optional(),
  payments: z.array(paymentSchema).default([]),
}).superRefine((data, ctx) => {
  if (data.billType !== "estimate" && data.payments.length === 0 && Number(data.creditAmount ?? 0) <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payments"],
      message: "At least one real payment or credit amount required",
    });
  }
});

export const cancelBillSchema = z.object({
  reason: z.string().min(3, "Cancellation reason required"),
});

export const billQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.enum(["active", "cancelled", "all"]).default("active"),
  customerId: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(50),
});
