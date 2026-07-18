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
  // Flat rupee discount applied to this whole line (not per unit). GST is
  // computed on the discounted line total (discount reduces taxable value).
  lineDiscount: moneyAmount().default(0),
  // Free-text callout for this line ("no bag", weight callout) — printed on the receipt.
  note: z.string().trim().max(200).optional(),
  originalUnitPrice: moneyAmount().optional(),
  appliedPricingRuleId: z.string().optional(),
  appliedPricingRuleType: z.string().optional(),
  pricingExplanation: z.string().max(500).optional(),
  pricingConfidence: z.coerce.number().min(0).max(1).optional(),
  pricingCalculationVersion: z.string().optional(),
  wasPriceOverridden: z.boolean().optional(),
  priceOverrideReason: z.string().max(500).optional(),
  gstRate: percentageRate().default(0),
  hsn: z.string().trim().regex(/^\d{4}(?:\d{2})?(?:\d{2})?$/, "HSN must contain 4, 6 or 8 digits").optional(),
});

const paymentSchema = z.object({
  mode: z.enum(["cash", "upi", "bank", "credit", "gift_card"]),
  amount: moneyAmount({ positive: true }),
  giftCardCode: z.string().trim().min(10).max(40).optional(),
  gift_card_code: z.string().trim().min(10).max(40).optional(),
  clientPaymentId: z.string().min(1).optional(),
  client_payment_id: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  idempotency_key: z.string().min(1).optional(),
  retailPaymentIntentId: z.string().min(1).optional(),
  retail_payment_intent_id: z.string().min(1).optional(),
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
  // Optional free-text reason for the bill-level discount (discounts report).
  discountReason: z.string().trim().max(200).optional(),
  offerId: z.string().min(1).optional(),
  offerCode: z.string().trim().max(40).optional(),
  offerDiscount: moneyAmount().default(0),
  loyaltyPointsToRedeem: z.coerce.number().int().min(1).max(100000000).optional(),
  actualAmount: moneyAmount().optional(),
  buyerPaidAmount: moneyAmount().optional(),
  waivedAmount: moneyAmount().default(0),
  creditAmount: moneyAmount().default(0).optional(),
  payments: z.array(paymentSchema).default([]),
  ownerPin: z.string().regex(/^\d{4}$/, "Owner PIN must be exactly 4 digits").optional(),
  reason: z.string().trim().min(3).max(500).optional(),
  sensitiveActions: z.array(z.enum(["large_discount", "selling_below_minimum_price", "loyalty_redemption"])).max(3).default([]),
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
  if (data.loyaltyPointsToRedeem && !data.customerId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customerId"], message: "Choose a customer before redeeming loyalty points" });
  }
  if (data.loyaltyPointsToRedeem && data.billType === "estimate") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loyaltyPointsToRedeem"], message: "Loyalty points cannot be redeemed on an estimate" });
  }
  if (data.offerDiscount > 0 && !data.offerId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["offerId"], message: "Offer reference is required for a coupon discount" });
  }
  if (data.offerId && data.offerDiscount <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["offerDiscount"], message: "Validated coupon discount is required" });
  }
  data.payments.forEach((payment, index) => {
    if (payment.mode === "gift_card" && !(payment.giftCardCode || payment.gift_card_code)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payments", index, "giftCardCode"], message: "Gift card code is required" });
    }
  });
});

export const cancelBillSchema = z.object({
  reason: z.string().min(3, "Cancellation reason required"),
});

export const saleReturnSchema = z.object({
  locationId: z.string().min(1).optional(),
  refundMode: z.enum(["cash", "upi", "bank", "udhar", "gift_card"]).default("cash"),
  gstMode: z.enum(["inclusive", "exclusive", "none"]).default("inclusive"),
  customerId: z.string().min(1).optional(),
  customerName: z.string().trim().min(1).max(160).optional(),
  returnOfBillId: z.string().min(1).optional(),
  reason: z.string().trim().min(3).max(500),
  items: z.array(billItemSchema.extend({ originalBillItemId: z.string().min(1).optional(), damaged: z.boolean().default(false) })).min(1, "At least one item required"),
  localBillId: z.string().min(1).optional(),
  clientBillId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
}).superRefine((data, ctx) => {
  if (data.refundMode === "udhar" && !data.customerId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customerId"], message: "Choose a customer to refund to udhar" });
  }
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
