import { dateRangeForDateOnly, formatDateInTimeZone } from "../../../../utils/dates.js";
import { env } from "../../../../config/env.js";
import db from "../../../../db.js";
import { AppError } from "../../../../shared/errors/index.js";
import { defineTool, TOOL_RISK } from "../tool-contract.js";
import { listSupplierDues, previewSupplierPayment, recordSupplierPayment, supplierPaymentApproval } from "../../../suppliers/supplierPayments.service.js";
import * as stores from "../../../stores/stores.service.js";
import { createTransferSchema, receiveTransferSchema, cancelTransferSchema } from "../../../stores/stores.schema.js";
import { resolveOperationalLocation } from "../../../stores/location-context.service.js";
import { assertLocationCapability } from "../../../stores/location-access.service.js";

const str = maxLength => ({ type: "string", minLength: 1, maxLength, pattern: "\\S" });
const positive = { type: "number", exclusiveMinimum: 0, maximum: 100000000 };
const obj = (properties, required) => ({ type: "object", additionalProperties: false, properties, required });
const q = value => JSON.stringify(String(value ?? "").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " "));
const payment = { roles: ["owner", "admin"], feature: "purchase_entry", keywords: ["supplier", "payment", "due", "pay", "invoice", "सप्लायर", "भुगतान", "बकाया"] };
const transfer = { roles: ["owner", "admin"], feature: "multi_store", keywords: ["transfer", "branch", "dispatch", "receive", "shipment", "stock", "शाखा", "भेजो", "स्टॉक", "ट्रांसफर"] };
const safe = { kind: "read", risk: TOOL_RISK.SAFE };
const change = { kind: "write", risk: TOOL_RISK.OWNER_PIN };
function precision(value) {
  for (const item of Object.values(value)) {
    if (Array.isArray(item)) item.forEach(precision);
    else if (typeof item === "number" && Math.abs(item * 100 - Math.round(item * 100)) > 0.00001) throw new AppError("Use amounts and quantities with at most two decimals", 422, "TASK_PRECISION_INVALID");
  }
}
function paymentData(args) {
  precision(args);
  const paidAt = dateRangeForDateOnly(args.paidOn, env.DAILY_CLOSING_TIMEZONE).start;
  if (!Number.isFinite(paidAt.getTime()) || formatDateInTimeZone(paidAt, env.DAILY_CLOSING_TIMEZONE) !== args.paidOn || paidAt > new Date()) throw new AppError("Use the actual payment date, today or earlier", 422, "INVALID_PAYMENT_DATE");
  return { ...args, paidAt: paidAt.toISOString() };
}
async function counter(ctx) {
  const row = await resolveOperationalLocation(ctx.shopId, ctx.locationId);
  await assertLocationCapability({ ...ctx, locationId: row.id, capability: "transfer" });
  return row;
}
function brief(row) {
  return { id: row.id, referenceNo: row.referenceNo, fromName: row.fromLocation.name, toName: row.toLocation.name, status: row.status,
    items: row.items.map(item => ({ id: item.id, productName: item.productName, baseUnit: item.baseUnit, sent: item.quantityBaseQty, received: item.receivedBaseQty, remaining: item.remainingBaseQty })) };
}
async function dispatchData(args, ctx) {
  precision(args);
  return createTransferSchema.parse({ ...args, fromLocationId: (await counter(ctx)).id, fulfillmentMode: "shipment", movementReason: "branch_transfer" });
}
function actionData(action, args) {
  precision(args);
  return (action === "receive" ? receiveTransferSchema : cancelTransferSchema).parse(args);
}
async function actionAtCounter(action, args, ctx) {
  const [branch, row] = await Promise.all([counter(ctx), stores.getTransferForAssistant(ctx.shopId, args.transferId, ctx.userId, ctx.role)]);
  if (branch.id !== (action === "receive" ? row.toLocationId : row.fromLocationId)) throw new AppError(`Switch to the ${action === "receive" ? "receiving" : "dispatching"} branch`, 403, "LOCATION_ACCESS_DENIED");
  return row;
}
const lineText = row => `${q(row.productName)} ${row.quantityBaseQty} ${q(row.baseUnit)}`;

export const SETTLEMENT_TRANSFER_TOOLS = [
  defineTool({ ...payment, ...safe, name: "list_supplier_dues",
    description: "List up to 25 recent unpaid purchase rows for an existing supplier at this counter. Resolve the supplier first using find_supplier. Rows can be separate products on the same invoice: require the exact row and amount, never apply the whole invoice payment to every row. No money is sent.",
    parameters: obj({ supplierId: str(120) }, ["supplierId"]),
    handler: ({ supplierId }, ctx) => listSupplierDues(ctx.shopId, supplierId, ctx, ctx.locationId),
  }),
  defineTool({ ...payment, ...change, name: "record_supplier_payment",
    description: "Record money the user ALREADY PAID against one exact unpaid purchase row after review and owner PIN. This does not send money. Read list_supplier_dues first. Ask for exact amount, method and actual payment date (resolve today/yesterday from the supplied current date), whether payment has actually happened, and which row if ambiguous. User must explicitly confirm already paid; never infer from 'pay supplier'. No refunds/reversals. Amount in shop currency, two decimals.",
    parameters: obj({ purchaseHistoryId: str(120), amount: positive, paidOn: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }, mode: { type: "string", enum: ["cash", "upi", "bank", "card"] }, alreadyPaid: { type: "boolean", enum: [true] }, reference: str(120) }, ["purchaseHistoryId", "amount", "paidOn", "mode", "alreadyPaid"]),
    summarize: () => "Record an existing supplier payment",
    prepare: async (args, ctx) => {
      if (args.alreadyPaid !== true) throw new AppError("Confirm the payment was already made", 422, "PAYMENT_CONFIRMATION_REQUIRED");
      const row = await previewSupplierPayment(ctx.shopId, paymentData(args), ctx, ctx.locationId);
      return { approval: supplierPaymentApproval(row), summary: `Record ALREADY PAID ${row.amount} via ${row.mode} on ${args.paidOn} for supplier ${q(row.supplierName)}; purchase ${q(row.purchaseHistoryId)}; invoice ${q(row.invoiceNumber || "no invoice number")}; product ${q(row.productName)}; branch ${q(row.locationName)}. Due ${row.dueBefore} → ${row.dueAfter} (shop currency).${row.reference ? ` Reference ${q(row.reference)}.` : ""} This records payment only; no money is sent.` };
    },
    handler: async (args, ctx) => {
      if (args.alreadyPaid !== true || !ctx.actionKey) throw new AppError("Confirm the payment was already made", 422, "PAYMENT_CONFIRMATION_REQUIRED");
      const result = await recordSupplierPayment(ctx.shopId, { ...paymentData(args), paymentId: ctx.actionKey, idempotencyKey: ctx.actionKey }, ctx, { counterLocationId: ctx.locationId ?? null, approval: ctx.approval });
      return { paymentId: result.paymentId, ledgerEntryId: result.ledgerEntryId, receipt: result.idempotentReplay ? "This payment was already recorded; no duplicate payment entry." : `Recorded supplier payment ${result.amountPaid} via ${args.mode}; remaining due ${result.due} (shop currency). No money sent.` };
    },
  }),
  defineTool({ ...transfer, ...safe, name: "list_store_locations", description: "Find active, accessible branch IDs by name before transferring stock. Ask which branch when ambiguous. Exact IDs must come from this result.",
    handler: async (_args, ctx) => { const data = await stores.listLocations(ctx.shopId, ctx); const locations = data.locations.filter(row => row.active); return { locations: locations.slice(0, 50).map(row => ({ id: row.id, name: row.name, code: row.code, isPrimary: row.isPrimary })), count: locations.length }; },
  }),
  defineTool({ ...transfer, ...safe, name: "get_transfer_stock", description: "Read transferable base stock at the active counter branch for up to ten exact product IDs, before dispatch. This is location stock, not company-wide stock. Sizes, batches and registered tax documents need the Stock transfers screen.",
    parameters: obj({ productIds: { type: "array", minItems: 1, maxItems: 10, items: str(120) } }, ["productIds"]),
    handler: async ({ productIds }, ctx) => { const branch = await counter(ctx); const snapshot = await stores.getLocationInventory(ctx.shopId, branch.id); return { locationName: branch.name, products: snapshot.products.filter(row => productIds.includes(row.id)).map(row => ({ id: row.id, name: row.name, baseUnit: row.baseUnit, stockBaseQty: row.stockBaseQty })) }; },
  }),
  defineTool({ ...transfer, ...safe, name: "list_stock_transfers", description: "Read up to 25 transfers involving this counter, filtered from the latest 100 accessible transfers. Use exact returned transfer and line IDs. Older transfers may need the Stock transfers screen.",
    handler: async (_args, ctx) => { const branch = await counter(ctx); const transfers = await stores.listTransfers(ctx.shopId, { limit: 100 }, ctx); return { transfers: transfers.filter(row => [row.fromLocationId, row.toLocationId].includes(branch.id)).slice(0, 25).map(brief), limit: 25 }; },
  }),
  defineTool({ ...transfer, ...safe, name: "get_stock_transfer", description: "Read one exact stock transfer and remaining line quantities, with access to both branches. Never assume dispatch means goods have arrived.",
    parameters: obj({ transferId: str(120) }, ["transferId"]),
    handler: async ({ transferId }, ctx) => brief(await stores.getTransferForAssistant(ctx.shopId, transferId, ctx.userId, ctx.role)),
  }),
  defineTool({ ...transfer, ...change, name: "dispatch_stock_transfer",
    description: "Dispatch stock FROM this active counter to an existing branch, with review and owner PIN. Read locations and branch stock first. Ask explicit quantity and exact base unit. Creates an IN-TRANSIT shipment; destination must separately receive actual goods. Supports pooled stock without batch tracking, between unregistered locations, branch transfers only. Registered tax documents, counted sizes, batches or instant transfers must use get_workflow stock_transfers. Maximum ten distinct products, two decimals.",
    parameters: obj({ toLocationId: str(120), note: str(500), items: { type: "array", minItems: 1, maxItems: 10, items: obj({ productId: str(120), quantityBaseQty: positive, baseUnit: str(30) }, ["productId", "quantityBaseQty", "baseUnit"]) } }, ["toLocationId", "items"]),
    summarize: () => "Dispatch stock to another branch",
    prepare: async (args, ctx) => {
      const preview = await stores.previewTransferDispatch(db, ctx.shopId, await dispatchData(args, ctx), ctx.userId, ctx.role);
      preview.lines.forEach((row, i) => { if (row.baseUnit !== args.items[i].baseUnit) throw new AppError(`Use ${row.baseUnit} for ${row.productName}`, 422, "TRANSFER_UNIT_MISMATCH"); });
      return { approval: stores.transferApprovalToken(preview), summary: `Dispatch ${preview.lines.map(lineText).join("; ")} from ${q(preview.fromName)} to ${q(preview.toName)}. Stock remains IN TRANSIT until actual receipt is confirmed at the destination.${args.note ? ` Note ${q(args.note)}.` : ""}` };
    },
    handler: async (args, ctx) => { const row = await stores.createTransfer(ctx.shopId, await dispatchData(args, ctx), ctx.userId, ctx.role, null, ctx.approval); return { transferId: row.id, receipt: `${row.referenceNo}: dispatched from ${q(row.fromLocation.name)} to ${q(row.toLocation.name)}; in transit, not yet received.` }; },
  }),
  ...["receive", "cancel"].map(action => defineTool({ ...transfer, ...change, name: action === "receive" ? "receive_stock_transfer" : "cancel_stock_transfer",
    description: action === "receive" ? "Record goods actually received at the active destination branch from an existing open shipment, after review and owner PIN. Read transfer first; require explicit actual quantities in exact base units, never assume full delivery. Supports partial receipts, pooled lines without batch allocations. Sizes/batches use Stock transfers. Maximum ten distinct lines, two decimals." : "Cancel an existing shipment's UNRECEIVED remainder from the dispatching branch after review and owner PIN. Require explicit confirmation goods are physically back at source and an eight-character reason. Retains already received stock. Does not undo a completed transfer. Sizes/batches use Stock transfers.",
    parameters: action === "receive" ? obj({ transferId: str(120), note: str(500), items: { type: "array", minItems: 1, maxItems: 10, items: obj({ transferItemId: str(120), quantityBaseQty: positive, baseUnit: str(30) }, ["transferItemId", "quantityBaseQty", "baseUnit"]) } }, ["transferId", "items"]) : obj({ transferId: str(120), reason: { ...str(500), minLength: 8 }, goodsBackAtSource: { type: "boolean", enum: [true] } }, ["transferId", "reason", "goodsBackAtSource"]),
    summarize: () => `${action === "receive" ? "Receive" : "Cancel unreceived"} stock shipment`,
    prepare: async (args, ctx) => {
      if (action === "cancel" && args.goodsBackAtSource !== true) throw new AppError("Confirm goods are back at source", 422, "RETURN_CONFIRMATION_REQUIRED");
      await actionAtCounter(action, args, ctx);
      const preview = await stores.previewTransferAction(db, ctx.shopId, args.transferId, action, actionData(action, args), ctx.userId, ctx.role);
      if (action === "receive") args.items.forEach(input => { const row = preview.lines.find(row => row.id === input.transferItemId); if (row.baseUnit !== input.baseUnit) throw new AppError(`Use ${row.baseUnit} for ${row.productName}`, 422, "TRANSFER_UNIT_MISMATCH"); });
      const lines = action === "receive" ? args.items.map(input => ({ ...preview.lines.find(row => row.id === input.transferItemId), quantityBaseQty: input.quantityBaseQty })) : preview.lines.filter(row => row.remainingBaseQty > 0).map(row => ({ ...row, quantityBaseQty: row.remainingBaseQty }));
      return { approval: stores.transferApprovalToken(preview), summary: `${action === "receive" ? "Receive actual goods" : "Cancel unreceived goods and return stock to source"} for ${q(preview.referenceNo)}; ${q(preview.fromName)} → ${q(preview.toName)}: ${lines.map(lineText).join("; ")}.${action === "cancel" ? ` Goods confirmed back at source. Reason ${q(args.reason)}. Existing received stock is retained.` : " Only the listed actual quantities are received."}${args.note ? ` Note ${q(args.note)}.` : ""}` };
    },
    handler: async (args, ctx) => {
      if (action === "cancel" && args.goodsBackAtSource !== true) throw new AppError("Confirm goods are back at source", 422, "RETURN_CONFIRMATION_REQUIRED");
      await actionAtCounter(action, args, ctx);
      const row = await (action === "receive" ? stores.receiveTransfer : stores.cancelTransfer)(ctx.shopId, args.transferId, actionData(action, args), ctx.userId, ctx.role, null, ctx.approval);
      return { transferId: row.id, receipt: `${row.referenceNo}: ${row.status}. ${action === "cancel" ? "Unreceived stock returned to source; existing receipts retained." : "Actual received quantities added at destination."}` };
    },
  })),
];
