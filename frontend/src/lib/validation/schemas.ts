import { z } from "zod";

const emptyStringToUndefined = (value: unknown) => (value === "" ? undefined : value);
const nullableText = z.preprocess(emptyStringToUndefined, z.string().trim().min(1).optional()).nullable().optional();
const optionalText = z.preprocess(emptyStringToUndefined, z.string().trim().min(1).optional());
const money = z.coerce.number().finite().nonnegative();
const positiveMoney = z.coerce.number().finite().positive();
const quantity = z.coerce.number().finite().positive();
const nonNegativeQuantity = z.coerce.number().finite().nonnegative();
const percentage = z.coerce.number().finite().min(0).max(100);

export const mobileNumberSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{10}$/, "Mobile number must be 10 digits")
  .optional()
  .or(z.literal(""));

export const customerCreationSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(120),
  mobile: mobileNumberSchema,
  type: z.enum(["regular", "udhar"]).default("regular"),
  address: optionalText,
  udharLimit: money.optional(),
  reminderOverrideUntil: optionalText,
  notes: optionalText,
});

export const quantitySlabPriceSchema = z.object({
  minQty: z.coerce.number().finite().positive(),
  price: positiveMoney,
});

export const customerSpecificPriceSchema = z.object({
  customerId: optionalText,
  customerName: optionalText,
  price: positiveMoney,
});

export const productCreationSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(160),
  category: optionalText,
  unit: optionalText,
  aliases: z.array(z.string().trim().min(1)).default([]),
  sku: optionalText,
  barcode: optionalText,
  hsn: optionalText,
  brand: optionalText,
  mrp: money.optional(),
  reorderLevel: nonNegativeQuantity.optional(),
  description: z.string().trim().max(500).optional(),
  imageUrl: z.string().optional(),
  isLooseItem: z.boolean().default(false),
  baseUpdatedAt: z.string().optional(),
  displayUnit: z.string().trim().min(1).default("piece"),
  baseUnit: z.string().trim().min(1).default("piece"),
  rateUnit: z.string().trim().min(1).default("piece"),
  stockBaseQty: nonNegativeQuantity.default(0),
  stockQuantity: nonNegativeQuantity.optional(),
  stockUnit: optionalText,
  stockTrackingEnabled: z.boolean().default(true),
  trackStock: z.boolean().optional(),
  costPerRateUnit: money.optional(),
  costPrice: money.optional(),
  averageCostPrice: money.optional(),
  minPricePerRateUnit: money.optional(),
  minimumSellingPrice: money.optional(),
  defaultPricePerRateUnit: positiveMoney,
  sellingPrice: positiveMoney.optional(),
  retailPricePerRateUnit: positiveMoney.optional(),
  retailPrice: positiveMoney.optional(),
  retailFromQuantity: nonNegativeQuantity.optional(),
  wholesalePricePerRateUnit: positiveMoney.optional(),
  wholesalePrice: positiveMoney.optional(),
  wholesaleFromQuantity: nonNegativeQuantity.optional(),
  quantitySlabPricing: z.array(quantitySlabPriceSchema).default([]),
  customerSpecificPricing: z.union([z.array(customerSpecificPriceSchema), z.record(z.coerce.number().finite().nonnegative())]).optional(),
  gstRate: percentage.default(0),
  lowStockThreshold: nonNegativeQuantity.optional(),
  lowStockAlert: nonNegativeQuantity.optional(),
  isActive: z.boolean().default(true),
  status: z.enum(["active", "inactive"]).default("active"),
  ownerPin: optionalText,
  ownerPinReason: optionalText,
}).superRefine((product, ctx) => {
  const min = Number(product.minPricePerRateUnit ?? product.minimumSellingPrice ?? 0);
  const prices = [
    product.defaultPricePerRateUnit,
    product.sellingPrice,
    product.retailPricePerRateUnit,
    product.retailPrice,
    product.wholesalePricePerRateUnit,
    product.wholesalePrice,
    ...product.quantitySlabPricing.map((row) => row.price),
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const hasBelowMin = min > 0 && prices.some((price) => price > 0 && price < min);
  if (hasBelowMin && !product.ownerPin) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ownerPin"],
      message: "Owner PIN is required when selling price is below minimum price",
    });
  }
});

export const billItemCreationSchema = z.object({
  productId: optionalText,
  productLocalId: optionalText,
  name: z.string().trim().min(1, "Item name is required").max(160),
  quantity,
  enteredUnit: z.string().trim().min(1),
  ratePerRateUnit: money,
  gstRate: percentage.default(0),
});

export const billPaymentSchema = z.object({
  mode: z.enum(["cash", "upi", "credit"]),
  amount: money,
  referenceNo: optionalText,
  note: optionalText,
});

export const billCreationSchema = z
  .object({
    billType: z.enum(["normal_sale", "udhar_entry", "gst_invoice", "estimate"]),
    customerId: optionalText,
    customerLocalId: optionalText,
    customerName: optionalText,
    customerMobile: mobileNumberSchema,
    items: z.array(billItemCreationSchema).min(1, "At least one bill item is required"),
    discount: money.default(0),
    actualAmount: money.optional(),
    buyerPaidAmount: money.optional(),
    waivedAmount: money.optional(),
    allowAdvancePayment: z.boolean().optional(),
    advanceAmount: money.optional(),
    payments: z.array(billPaymentSchema).default([]),
  })
  .superRefine((bill, ctx) => {
    const subtotal = bill.items.reduce((sum, item) => sum + item.quantity * item.ratePerRateUnit, 0);
    const gst = bill.items.reduce((sum, item) => sum + item.quantity * item.ratePerRateUnit * (item.gstRate / 100), 0);
    const total = Math.max(0, subtotal + gst - bill.discount);
    const paid = bill.payments.reduce((sum, payment) => sum + payment.amount, 0);

    if (bill.discount > subtotal + gst) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discount"],
        message: "Discount cannot exceed bill total",
      });
    }

    if (paid > total && !bill.allowAdvancePayment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payments"],
        message: "Total paid amount cannot exceed bill total unless marked as advance",
      });
    }

    if ((bill.billType === "udhar_entry" || bill.payments.some((payment) => payment.mode === "credit")) && !bill.customerId && !bill.customerLocalId && !bill.customerName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customerName"],
        message: "Customer is required for udhar or credit bills",
      });
    }
  });

export const paymentRecordingSchema = z.object({
  customerId: optionalText,
  customerLocalId: optionalText,
  billId: optionalText,
  ledgerEntryId: optionalText,
  amount: positiveMoney,
  mode: z.enum(["cash", "upi"]),
  referenceNo: optionalText,
  note: optionalText,
  paidAt: optionalText,
}).superRefine((payment, ctx) => {
  if (!payment.customerId && !payment.customerLocalId && !payment.billId && !payment.ledgerEntryId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["customerId"],
      message: "Payment must be linked to a customer, bill, or ledger entry",
    });
  }
});

export const stockAdjustmentSchema = z.object({
  productId: optionalText,
  productLocalId: optionalText,
  movementType: z.enum(["purchase", "sale", "damage", "return", "correction", "opening_stock"]),
  quantityDelta: z.coerce.number().finite(),
  unit: z.string().trim().min(1),
  reason: optionalText,
  supplierId: optionalText,
  supplierName: optionalText,
  ownerPin: optionalText,
}).superRefine((movement, ctx) => {
  if (!movement.productId && !movement.productLocalId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["productId"],
      message: "Product is required for stock adjustment",
    });
  }

  if (movement.quantityDelta === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["quantityDelta"],
      message: "Stock adjustment quantity cannot be zero",
    });
  }

  if (movement.movementType === "correction" && !movement.ownerPin) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ownerPin"],
      message: "Owner PIN is required for stock correction",
    });
  }
});

export const subscriptionFeatureAccessSchema = z.object({
  planCode: z.string().trim().min(1),
  feature: z.enum(["billing", "udhar_ledger", "reports", "multi_device", "staff", "inventory", "sync", "recycle_bin"]),
  enabledFeatures: z.array(z.string().trim().min(1)),
  usageCount: z.coerce.number().int().nonnegative().default(0),
  usageLimit: z.coerce.number().int().positive().nullable().optional(),
}).superRefine((access, ctx) => {
  if (!access.enabledFeatures.includes(access.feature)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["feature"],
      message: "Feature is not available in the current subscription plan",
    });
  }

  if (typeof access.usageLimit === "number" && access.usageCount >= access.usageLimit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["usageCount"],
      message: "Subscription usage limit has been reached",
    });
  }
});

export const ownerPinRequiredActionSchema = z.object({
  action: z.enum([
    "cancel_bill",
    "delete_bill",
    "delete_customer",
    "delete_product",
    "delete_supplier",
    "stock_adjustment",
    "stock_correction",
    "price_below_minimum",
    "large_discount",
    "data_export",
    "export_report",
    "change_settings",
    "staff_permission_change",
    "restore_from_recycle_bin",
    "reverse_payment",
    "ledger_adjustment",
  ]),
  ownerPin: z.string().trim().min(4, "Owner PIN is required"),
  reason: optionalText,
  entityId: optionalText,
  entityLocalId: optionalText,
});

export const syncOutboxOperationSchema = z.object({
  operationType: z.enum(["create", "update", "delete", "restore"]),
  entityType: z.enum([
    "product",
    "customer",
    "bill",
    "bill_item",
    "payment",
    "ledger_entry",
    "inventory_movement",
    "supplier",
    "staff_user",
    "subscription_plan",
    "device_license",
    "audit_log",
  ]),
  entityId: z.string().trim().min(1),
  payload: z.record(z.unknown()),
});

export const supplierCreationSchema = z.object({
  name: z.string().trim().min(1, "Supplier name is required").max(120),
  mobile: mobileNumberSchema,
  address: nullableText,
  gstNumber: optionalText,
  notes: optionalText,
});

export type CustomerCreationInput = z.infer<typeof customerCreationSchema>;
export type QuantitySlabPriceInput = z.infer<typeof quantitySlabPriceSchema>;
export type CustomerSpecificPriceInput = z.infer<typeof customerSpecificPriceSchema>;
export type ProductCreationInput = z.infer<typeof productCreationSchema>;
export type BillItemCreationInput = z.infer<typeof billItemCreationSchema>;
export type BillCreationInput = z.infer<typeof billCreationSchema>;
export type BillPaymentInput = z.infer<typeof billPaymentSchema>;
export type PaymentRecordingInput = z.infer<typeof paymentRecordingSchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type SubscriptionFeatureAccessInput = z.infer<typeof subscriptionFeatureAccessSchema>;
export type OwnerPinRequiredActionInput = z.infer<typeof ownerPinRequiredActionSchema>;
export type SyncOutboxOperationInput = z.infer<typeof syncOutboxOperationSchema>;
export type SupplierCreationInput = z.infer<typeof supplierCreationSchema>;
