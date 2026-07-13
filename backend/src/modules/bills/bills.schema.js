import { z } from "zod";
import { moneyAmount, percentageRate, quantityAmount } from "../../utils/validationSchemas.js";

const billItemSchema = z.object({
  productId: z.string().optional(),
  sellingUnitId: z.string().optional(),
  sellingUnitCode: z.string().optional(),
  sellingUnitLabel: z.string().optional(),
  conversionToBase: quantityAmount({ positive: true }).optional(),
  name: z.string().min(1),
  quantity: quantityAmount({ positive: true }),
  enteredUnit: z.string(),
  ratePerRateUnit: moneyAmount(),
  originalUnitPrice: moneyAmount().optional(),
  appliedPricingRuleId: z.string().optional(),
  appliedPricingRuleType: z.string().optional(),
  pricingExplanation: z.string().max(500).optional(),
  pricingConfidence: z.coerce.number().min(0).max(1).optional(),
  pricingCalculationVersion: z.string().optional(),
  wasPriceOverridden: z.boolean().optional(),
  priceOverrideReason: z.string().max(500).optional(),
  gstRate: percentageRate().default(0),
});

const paymentSchema = z.object({
  mode: z.enum(["cash", "upi", "bank", "credit"]),
  amount: moneyAmount({ positive: true }),
  clientPaymentId: z.string().min(1).optional(),
  client_payment_id: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  idempotency_key: z.string().min(1).optional(),
  ownerPin: z.string().optional(),
  reason: z.string().optional(),
  sensitiveActions: z.array(z.string()).optional(),
});

export const confirmBillSchema = z.object({
  locationId: z.string().min(1).optional(),
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
  localBillId: z.string().min(1).optional(),
  local_bill_id: z.string().min(1).optional(),
  clientBillId: z.string().min(1).optional(),
  client_bill_id: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  idempotency_key: z.string().min(1).optional(),
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
  locationId: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(50),
});
