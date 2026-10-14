import db from "../../../../db.js";
import { AppError } from "../../../../shared/errors/index.js";
import { defineTool, TOOL_RISK } from "../tool-contract.js";
import * as orders from "../../../purchase-orders/purchaseOrders.service.js";
import { newOrderPreview, orderActionPreview, approvalToken } from "../../../purchase-orders/purchaseOrderApproval.js";
import { createPurchaseOrderSchema, receivePurchaseOrderSchema } from "../../../purchase-orders/purchaseOrders.schema.js";
import { assertLocationCapability } from "../../../stores/location-access.service.js";
import { resolveOperationalLocation } from "../../../stores/location-context.service.js";
import { scheduleAuditEvaluation } from "../../../assurance/assurance.hooks.js";
import { ENTITY_TYPES } from "../../../assurance/assurance.constants.js";

const str = maxLength => ({ type: "string", minLength: 1, maxLength, pattern: "\\S" });
const amount = { type: "number", minimum: 0, maximum: 100000000 };
const positive = { ...amount, exclusiveMinimum: 0 };
const date = { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" };
const object = (properties, required) => ({ type: "object", additionalProperties: false, properties, required });
const keywords = ["purchase", "reorder", "supplier", "receive", "procurement", "goods", "order", "खरीद", "मंगाना", "सप्लायर", "प्राप्त"];
const common = { keywords, feature: "purchase_entry", roles: ["owner", "admin"] };
const q = value => JSON.stringify(String(value ?? "").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " "));
const actor = ctx => ({ userId: ctx.userId, deviceId: ctx.deviceId });
async function location(ctx, capability = "view") {
  const row = await resolveOperationalLocation(ctx.shopId, ctx.locationId);
  await assertLocationCapability({ ...ctx, locationId: row.id, capability });
  return row;
}
async function orderAtCounter(ctx, id, capability = "view") {
  const [branch, order] = await Promise.all([location(ctx, capability), orders.getPurchaseOrder(ctx.shopId, id)]);
  if (order.locationId !== branch.id) throw new AppError("Switch to this order's counter branch before continuing", 403, "LOCATION_ACCESS_DENIED");
  return order;
}
function datesAndPrecision(value) {
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) item.forEach(datesAndPrecision);
    else if (typeof item === "number" && Math.abs(item * 100 - Math.round(item * 100)) > 0.00001) throw new AppError("Purchase amounts and quantities need at most two decimal places", 422, "PURCHASE_PRECISION_INVALID");
    else if (["expectedOn", "dueDate", "manufacturedOn", "expiresOn"].includes(key) && item) {
      const parsed = new Date(`${item}T00:00:00.000Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== item) throw new AppError("Use a real calendar date", 422, "INVALID_DATE");
    }
  }
}
function draftData(args, ctx) {
  datesAndPrecision(args);
  return createPurchaseOrderSchema.parse({ ...args, supplierName: "Resolved supplier", locationId: ctx.locationId ?? undefined });
}
function receiptData(args, ctx) {
  datesAndPrecision(args);
  return receivePurchaseOrderSchema.parse({ ...args, idempotencyKey: ctx.actionKey ?? "assistant-preview" });
}
const describeOrder = preview => `${q(preview.orderNumber)}; supplier ${q(preview.supplierName)}; branch ${q(preview.locationName)}`;
const brief = row => ({ id: row.id, orderNumber: row.orderNumber, supplierName: row.supplierName, locationName: row.location?.name, status: row.status, expectedTotal: row.expectedTotal });

async function prepareDraft(args, ctx) {
  const branch = await location(ctx, "purchase");
  const preview = await newOrderPreview(db, ctx.shopId, { ...draftData(args, ctx), locationId: branch.id });
  // Unit names are explicit: 500 grams must not silently become 500 kilograms.
  preview.items.forEach((row, i) => {
    if (row.baseUnit !== args.items[i].baseUnit || row.rateUnit !== args.items[i].rateUnit) throw new AppError(`Use ${row.baseUnit} quantities and prices per ${row.rateUnit} for ${row.productName}`, 422, "PURCHASE_UNIT_MISMATCH");
  });
  return { approval: approvalToken(preview), summary: `Create DRAFT purchase order for ${q(preview.supplierName)}; branch ${q(preview.locationName)}; ${preview.items.map(row => `${q(row.productName)}: ${row.orderedBaseQty} ${row.baseUnit} at ${row.expectedRate}/${row.rateUnit} = ${row.expectedAmount}`).join("; ")}; total ${preview.expectedTotal} (shop currency). No stock received, payment or supplier message.${args.expectedOn ? ` Expected ${args.expectedOn}.` : ""}${args.note ? ` Note ${q(args.note)}.` : ""}` };
}
async function prepareExisting(action, args, ctx) {
  await orderAtCounter(ctx, args.orderId, "purchase");
  const data = action === "receive" ? receiptData(args, ctx) : {};
  const preview = await orderActionPreview(db, ctx.shopId, args.orderId, action, data, ctx.userId);
  let summary;
  if (action === "send") summary = `Mark purchase order ${describeOrder(preview)} as sent; expected total ${preview.expectedTotal} (shop currency). This records its status; no message is sent to the supplier.`;
  else if (action === "cancel") summary = `Cancel the unreceived remainder of purchase order ${describeOrder(preview)}; reason ${q(args.reason)}. Existing receipts and payments are kept.`;
  else {
    preview.lines.forEach((row, i) => {
      if (row.baseUnit !== args.items[i].baseUnit || row.rateUnit !== args.items[i].rateUnit) throw new AppError(`Use ${row.baseUnit} quantities and prices per ${row.rateUnit} for ${row.productName}`, 422, "PURCHASE_UNIT_MISMATCH");
    });
    summary = `Receive goods against ${describeOrder(preview)}: ${preview.lines.map(row => `${q(row.productName)} ${row.quantityBaseQty} ${row.baseUnit} at ${row.actualRate}/${row.rateUnit} = ${row.lineAmount}${row.batchNumber ? `; batch ${q(row.batchNumber)}` : ""}${row.manufacturedOn ? `; manufactured ${row.manufacturedOn}` : ""}${row.expiresOn ? `; expires ${row.expiresOn}` : ""}${row.mrp !== undefined ? `; MRP ${row.mrp}` : ""}`).join("; ")}. Total ${preview.totalAmount}; recorded paid ${data.paidAmount}${data.paidAmount > 0 ? ` via ${data.paymentMode}` : ""}; due ${preview.dueAmount} (shop currency)${data.dueDate ? ` by ${data.dueDate}` : ""}. ${data.updateCost ? "Update weighted average cost" : "Keep existing cost"}. This increases stock and records accounting; no money transfer.${data.supplierInvoiceNumber ? ` Invoice ${q(data.supplierInvoiceNumber)}; total ${data.supplierInvoiceAmount ?? "not supplied"}; tax ${data.supplierInvoiceTax ?? "not supplied"}.` : ""}${data.varianceReason ? ` Variance reason ${q(data.varianceReason)}.` : ""}${data.note ? ` Note ${q(data.note)}.` : ""}`;
  }
  return { summary, approval: approvalToken(preview) };
}

export const PURCHASING_TOOLS = [
  defineTool({ ...common, name: "list_purchase_orders", kind: "read", risk: TOOL_RISK.SAFE,
    description: "List up to 25 recent purchase orders at this counter branch. Use exact returned IDs; ask which order if ambiguous. This is not customer sales orders. Old orders outside the result need the Purchase bills screen.",
    parameters: object({ status: { type: "string", enum: ["all", "draft", "sent", "partially_received", "received", "cancelled"] } }, ["status"]),
    handler: async ({ status }, ctx) => ({ orders: (await orders.listPurchaseOrders(ctx.shopId, { status, locationId: (await location(ctx)).id, limit: 25 })).map(brief), limit: 25 }),
  }),
  defineTool({ ...common, name: "get_purchase_order", kind: "read", risk: TOOL_RISK.SAFE,
    description: "Read a purchase order, exact line IDs, base quantities, rate units and already received quantities at this counter. Read before changing or receiving it. Never guess unit conversions or treat expected rates as the actual supplier invoice.",
    parameters: object({ orderId: str(120) }, ["orderId"]),
    handler: async ({ orderId }, ctx) => {
      const row = await orderAtCounter(ctx, orderId);
      return { ...brief(row), items: row.items.map(({ id, productName, baseUnit, rateUnit, orderedBaseQty, receivedBaseQty, expectedRate, product }) => ({ id, productName, baseUnit, rateUnit, orderedBaseQty, receivedBaseQty, expectedRate, batchTrackingEnabled: product?.batchTrackingEnabled })) };
    },
  }),
  defineTool({ ...common, name: "get_reorder_suggestions", kind: "read", risk: TOOL_RISK.SAFE,
    description: "Read branch reorder suggestions calculated by KiranaOS from stock, demand and open orders. These are suggestions, not purchase authorization. Obtain actual supplier, quantities and rates before preparing a draft.",
    handler: async (_args, ctx) => { const rows = await orders.getReorderSuggestions(ctx.shopId, (await location(ctx)).id); return { suggestions: rows.slice(0, 25), total: rows.length }; },
  }),
  defineTool({ ...common, name: "create_purchase_order", kind: "write", risk: TOOL_RISK.CONFIRM,
    description: "Create a draft purchase order for an EXISTING supplier and existing products at this counter branch. Read supplier and products first. Require explicit base quantities and expected rates per rate unit, copy exact unit names from product data. Ask for missing details. Does not receive stock, pay or message supplier. Newly created local suppliers/products must sync before they can be used here. Maximum 10 lines; two decimals.",
    parameters: object({ supplierId: str(120), expectedOn: date, note: str(500), items: { type: "array", minItems: 1, maxItems: 10, items: object({ productId: str(120), orderedBaseQty: positive, expectedRate: positive, baseUnit: str(30), rateUnit: str(30) }, ["productId", "orderedBaseQty", "expectedRate", "baseUnit", "rateUnit"]) } }, ["supplierId", "items"]),
    summarize: () => "Create a draft purchase order", prepare: prepareDraft,
    handler: async (args, ctx) => {
      await location(ctx, "purchase");
      const row = await orders.createPurchaseOrder(ctx.shopId, draftData(args, ctx), actor(ctx), ctx.approval);
      return { ...brief(row), receipt: `Created draft ${row.orderNumber}; expected total ${row.expectedTotal} (shop currency)` };
    },
  }),
  ...["send", "cancel"].map(action => defineTool({ ...common, name: action === "send" ? "mark_purchase_order_sent" : "cancel_purchase_order", kind: "write", risk: TOOL_RISK.OWNER_PIN,
    description: action === "send" ? "Record an existing draft purchase order as sent after review and owner PIN. This changes its status ONLY; it does not contact the supplier. Use when the user asks to mark it sent, not to email or WhatsApp it." : "Cancel the unreceived remainder of an existing purchase order after explicit confirmation and owner PIN. Require a reason. This does not reverse receipts, reduce stock or refund payments.",
    parameters: object({ orderId: str(120), ...(action === "cancel" ? { reason: { ...str(300), minLength: 3 } } : {}) }, action === "cancel" ? ["orderId", "reason"] : ["orderId"]),
    summarize: () => "Change purchase order status", prepare: (args, ctx) => prepareExisting(action, args, ctx),
    handler: async (args, ctx) => {
      await orderAtCounter(ctx, args.orderId, "purchase");
      const row = action === "send" ? await orders.sendPurchaseOrder(ctx.shopId, args.orderId, actor(ctx), ctx.approval) : await orders.cancelPurchaseOrder(ctx.shopId, args.orderId, args.reason, actor(ctx), ctx.approval);
      return { ...brief(row), receipt: `${row.orderNumber}: ${row.status}. No supplier message or money transfer.` };
    },
  })),
  defineTool({ ...common, name: "receive_purchase_order", kind: "write", risk: TOOL_RISK.OWNER_PIN,
    description: "Receive actual goods against an EXISTING sent purchase order at this counter, after confirmation and owner PIN. Read order and exact line IDs first. Require actual quantity, rate, exact base/rate units, recorded paid amount (explicit zero if unpaid), and whether to update cost. For positive payment require method. Never assume fully paid. Ask for batch/expiry for tracked items and variance explanation when needed. Two decimals, maximum 10 lines. Records stock/accounting, never transfers money. Cannot create and receive a new order in the same plan.",
    parameters: object({ orderId: str(120), paidAmount: amount, paymentMode: { type: "string", enum: ["cash", "upi", "bank"] }, updateCost: { type: "boolean" }, dueDate: date,
      supplierInvoiceNumber: str(100), supplierInvoiceAmount: positive, supplierInvoiceTax: amount, varianceReason: { ...str(500), minLength: 3 }, note: str(500),
      items: { type: "array", minItems: 1, maxItems: 10, items: object({ purchaseOrderItemId: str(120), quantityBaseQty: positive, actualRate: positive, baseUnit: str(30), rateUnit: str(30), batchNumber: str(100), manufacturedOn: date, expiresOn: date, mrp: positive }, ["purchaseOrderItemId", "quantityBaseQty", "actualRate", "baseUnit", "rateUnit"]) } }, ["orderId", "paidAmount", "updateCost", "items"]),
    summarize: () => "Receive purchase goods", prepare: (args, ctx) => prepareExisting("receive", args, ctx),
    handler: async (args, ctx) => {
      await orderAtCounter(ctx, args.orderId, "purchase");
      const result = await orders.receivePurchaseOrder(ctx.shopId, args.orderId, receiptData(args, ctx), actor(ctx), ctx.approval);
      if (!result.idempotentReplay) scheduleAuditEvaluation(ctx.shopId, ENTITY_TYPES.PURCHASE, result.receipt.id, { userId: ctx.userId });
      return { order: brief(result.purchaseOrder), receiptId: result.receipt.id, receipt: `${result.receipt.receiptNumber}: goods received ${result.receipt.totalAmount}; recorded paid ${result.receipt.paidAmount}; due ${result.receipt.dueAmount} (shop currency)` };
    },
  }),
];
