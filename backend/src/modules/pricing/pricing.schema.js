import { z } from "zod";

const money = z.coerce.number().finite().nonnegative();
const qty = z.coerce.number().finite().nonnegative();

export const evaluateSchema = z.object({
  productId: z.string().min(1),
  unitCode: z.string().optional(),
  customerId: z.string().optional(),
  customerGroup: z.string().optional(),
  quantity: qty.default(1),
  billDate: z.string().optional(),
  paymentMethod: z.string().optional(),
  source: z.enum(["BILLING", "ESTIMATE", "ORDER", "OFFLINE_BILLING", "BILL_EDIT", "RETURN"]).optional(),
}).passthrough();

const ruleBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  ruleType: z.enum([
    "CUSTOMER_FIXED_PRICE", "CUSTOMER_QUANTITY_PRICE", "CUSTOMER_GROUP_PRICE",
    "CUSTOMER_GROUP_QUANTITY_PRICE", "PRODUCT_QUANTITY_PRICE", "SELLING_UNIT_PRICE",
    "PROMOTIONAL_PRICE", "PAYMENT_METHOD_PRICE",
  ]),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "EXPIRED", "ARCHIVED"]).optional(),
  priority: z.coerce.number().int().optional(),
  productId: z.string().optional().nullable(),
  unitCode: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  customerGroup: z.string().optional().nullable(),
  minQuantity: qty.optional().nullable(),
  maxQuantity: qty.optional().nullable(),
  fixedUnitPrice: money.optional().nullable(),
  adjustmentType: z.enum(["FIXED_PRICE", "FIXED_DISCOUNT", "PERCENTAGE_DISCOUNT", "MARKUP_ON_COST", "MARGIN_ON_COST"]).optional().nullable(),
  adjustmentValue: z.coerce.number().finite().optional().nullable(),
  minimumMarginPercent: z.coerce.number().finite().optional().nullable(),
  paymentMethod: z.string().optional().nullable(),
  combinePolicy: z.enum(["CANNOT_COMBINE", "CAN_COMBINE", "BEST_PRICE_WINS", "CUSTOMER_CONTRACT_WINS", "PROMOTION_WINS"]).optional().nullable(),
  validFrom: z.string().optional().nullable(),
  validUntil: z.string().optional().nullable(),
  requiresOwnerApproval: z.boolean().optional(),
});

export const createRuleSchema = ruleBody;
export const updateRuleSchema = ruleBody.partial();

export const pricingSettingsSchema = z.object({
  smartPricingEnabled: z.boolean().optional(),
  recommendationOnly: z.boolean().optional(),
  autoFillThreshold: z.coerce.number().min(0).max(1).optional(),
  autoApplyThreshold: z.coerce.number().min(0).max(1).nullable().optional(),
  minObservations: z.coerce.number().int().min(1).max(1000).optional(),
  requireApprovalBelowMinMargin: z.boolean().optional(),
  allowStaffOverride: z.boolean().optional(),
});
