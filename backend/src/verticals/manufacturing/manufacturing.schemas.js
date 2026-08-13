import { z } from "zod";

const id = z.string().trim().min(1).max(64);
const qty = z.coerce.number().positive().max(1_000_000_000);

export const createBomSchema = z.object({
  finishedProductId: id,
  name: z.string().trim().min(2).max(160),
  outputQuantityBaseQty: qty,
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(z.object({
    materialProductId: id,
    quantityBaseQty: qty,
    wastagePercent: z.coerce.number().min(0).max(100).default(0),
  })).min(1).max(100),
}).superRefine((value, ctx) => {
  if (new Set(value.items.map((row) => row.materialProductId)).size !== value.items.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "A material can appear only once in a BOM" });
  }
  if (value.items.some((row) => row.materialProductId === value.finishedProductId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "A finished good cannot consume itself" });
  }
});

export const createRunSchema = z.object({
  locationId: id.optional(),
  bomId: id,
  runNumber: z.string().trim().min(1).max(64),
  plannedOutputBaseQty: qty,
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const completeRunSchema = z.object({
  actualOutputBaseQty: qty,
  finishedBatchNumber: z.string().trim().min(1).max(80),
  manufacturedOn: z.string().date(),
  expiresOn: z.string().date(),
  qcStatus: z.enum(["passed", "conditional", "failed"]),
  notes: z.string().trim().max(1000).nullable().optional(),
  consumptions: z.array(z.object({
    productId: id,
    inventoryLotId: id.nullable().optional(),
    sellingUnitId: id.nullable().optional(),
    packageCount: qty.nullable().optional(),
    actualBaseQty: qty,
  })).min(1).max(100),
  outputs: z.array(z.object({
    sellingUnitId: id.nullable().optional(),
    packageCount: qty.nullable().optional(),
    quantityBaseQty: qty,
  })).min(1).max(50),
}).refine((value) => value.expiresOn > value.manufacturedOn, { path: ["expiresOn"], message: "Expiry must be after manufacturing date" });

export const traceQuerySchema = z.object({ batchNumber: z.string().trim().min(1).max(80) });

const optionalText = (max = 300) => z.string().trim().max(max).nullable().optional();
const orderItemSchema = z.object({
  productId: id,
  sellingUnitId: id.nullable().optional(),
  buyerProductCode: optionalText(120),
  quantity: qty,
  unitPrice: z.coerce.number().nonnegative().max(1_000_000_000),
  lineDiscount: z.coerce.number().nonnegative().max(1_000_000_000).default(0),
});

export const createTradeOrderSchema = z.object({
  locationId: id.optional(), orderNumber: z.string().trim().min(1).max(64),
  buyerPoNumber: optionalText(120), customerId: id.nullable().optional(),
  customerName: z.string().trim().min(2).max(160), customerGstin: optionalText(15),
  billingAddress: optionalText(1000), shippingAddress: optionalText(1000),
  orderType: z.enum(["domestic", "export"]).default("domestic"),
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/).default("INR"),
  exchangeRate: z.coerce.number().positive().max(1_000_000).default(1),
  priceBasis: z.enum(["ex_works", "fob", "cif", "dap"]).nullable().optional(),
  requestedDeliveryDate: z.string().date().nullable().optional(),
  iec: optionalText(20), lutBondReference: optionalText(120), countryOfDestination: optionalText(120),
  countryOfOrigin: optionalText(120), portOfLoading: optionalText(160), portOfDischarge: optionalText(160),
  incoterm: optionalText(20), paymentTerms: optionalText(300), notes: optionalText(1000),
  items: z.array(orderItemSchema).min(1).max(500),
}).superRefine((value, ctx) => {
  if (value.orderType === "domestic" && (value.currencyCode !== "INR" || value.exchangeRate !== 1)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["currencyCode"], message: "Domestic orders must be in INR at exchange rate 1" });
  if (value.orderType === "export" && (!value.countryOfDestination || !value.incoterm)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["countryOfDestination"], message: "Export orders require destination country and Incoterm" });
});

export const allocateTradeOrderSchema = z.object({ allocations: z.array(z.object({ orderItemId: id, inventoryLotId: id, quantityBaseQty: qty })).min(1).max(1000) });
export const packTradeOrderSchema = z.object({ items: z.array(z.object({ orderItemId: id, packedQuantity: qty })).min(1).max(500) });
export const dispatchTradeOrderSchema = z.object({
  dispatchNumber: z.string().trim().min(1).max(64), dispatchDate: z.string().date(),
  transporterName: optionalText(160), transporterGstin: optionalText(15), vehicleNumber: optionalText(32),
  lrAwbNumber: optionalText(80), ewayBillNumber: optionalText(32), shippingBillNumber: optionalText(80),
  shippingBillDate: z.string().date().nullable().optional(), containerNumber: optionalText(80),
  packageCount: qty.nullable().optional(), netWeight: qty.nullable().optional(), grossWeight: qty.nullable().optional(),
  sealNumber: optionalText(80), notes: optionalText(1000),
}).refine((value) => value.grossWeight == null || value.netWeight == null || value.grossWeight >= value.netWeight, { path: ["grossWeight"], message: "Gross weight cannot be below net weight" });
export const attachTradeBillSchema = z.object({ billId: id });
export const tradeOrderListQuerySchema = z.object({ status: z.enum(["all", "draft", "confirmed", "allocated", "packed", "dispatched", "invoiced", "cancelled"]).default("all"), limit: z.coerce.number().int().min(1).max(500).default(100) });
