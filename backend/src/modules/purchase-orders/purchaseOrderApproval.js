/** Read-only previews shared by assistant approval and the committing transaction. */
import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/index.js";
import { multiplyMoney, round2 } from "../../utils/money.js";
import { rateUnitFactorsFor } from "../inventory/rate-unit-factor.js";
import { resolveOperationalLocation } from "../stores/location-context.service.js";
import { calculateReceiptReconciliation } from "./procurementReconciliation.js";

export const approvalToken = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function assertApproval(preview, expected) {
  if (expected && approvalToken(preview) !== expected) throw new AppError("The purchase details changed. Review a new plan before continuing.", 409, "PURCHASE_APPROVAL_CHANGED");
}
export async function newOrderPreview(client, shopId, data) {
  const location = await resolveOperationalLocation(shopId, data.locationId, client);
  const supplier = data.supplierId ? await client.supplier.findFirst({ where: { id: data.supplierId, shopId, deletedAt: null } }) : null;
  if (data.supplierId && !supplier) throw new AppError("Supplier not found", 404, "SUPPLIER_NOT_FOUND");
  const products = await client.product.findMany({ where: { shopId, id: { in: data.items.map(row => row.productId) }, deletedAt: null } });
  if (products.length !== data.items.length) throw new AppError("A purchase-order product was not found", 404, "PRODUCT_NOT_FOUND");
  if (products.some(row => row.packagingMode === "per_pack")) throw new AppError("Use Stock In and choose the pack size for products counted per pack", 422, "PURCHASE_ORDER_PER_PACK_UNSUPPORTED");
  const factors = await rateUnitFactorsFor(client, shopId, products);
  const items = data.items.map(input => {
    const product = products.find(row => row.id === input.productId);
    return { productId: product.id, productName: product.name, baseUnit: product.baseUnit, rateUnit: product.rateUnit,
      orderedBaseQty: round2(input.orderedBaseQty), expectedRate: round2(input.expectedRate),
      expectedAmount: multiplyMoney(input.expectedRate, input.orderedBaseQty / factors.get(product.id)) };
  });
  return { locationId: location.id, locationName: location.name, supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? data.supplierName,
    deliveryAddress: data.deliveryAddress || location.address || null, items,
    expectedTotal: round2(items.reduce((sum, row) => sum + row.expectedAmount, 0)) };
}
export async function orderActionPreview(client, shopId, id, action, data = {}, approverUserId = null) {
  const order = await client.purchaseOrder.findFirst({ where: { id, shopId }, include: { location: true, items: { orderBy: { id: "asc" }, include: { product: true } } } });
  if (!order) throw new AppError("Purchase order not found", 404, "PURCHASE_ORDER_NOT_FOUND");
  if (!order.location.active) throw new AppError("The order's store is inactive", 409, "STORE_LOCATION_UNAVAILABLE");
  const allowed = action === "send" ? ["draft"] : action === "receive" ? ["sent", "partially_received"] : ["draft", "sent", "partially_received"];
  if (!allowed.includes(order.status)) throw new AppError("This order cannot perform that action in its current status", 409, "PURCHASE_ORDER_STATUS_CHANGED");
  const preview = { id: order.id, orderNumber: order.orderNumber, supplierName: order.supplierName, locationId: order.locationId, locationName: order.location.name,
    status: order.status, updatedAt: order.updatedAt.toISOString(), expectedTotal: order.expectedTotal,
    items: order.items.map(({ id, productName, baseUnit, rateUnit, orderedBaseQty, receivedBaseQty, expectedRate }) => ({ id, productName, baseUnit, rateUnit, orderedBaseQty, receivedBaseQty, expectedRate })) };
  if (action !== "receive") return preview;
  const factors = await rateUnitFactorsFor(client, shopId, order.items.map(row => ({ id: row.productId, rateUnit: row.rateUnit, baseUnit: row.baseUnit })));
  const lines = data.items.map(input => {
    const item = order.items.find(row => row.id === input.purchaseOrderItemId);
    if (!item) throw new AppError("That line is not on this order", 422, "PURCHASE_ORDER_ITEM_INVALID");
    if (input.quantityBaseQty > round2(item.orderedBaseQty - item.receivedBaseQty) + 0.001) throw new AppError("Received quantity exceeds the remaining order quantity", 409, "PURCHASE_ORDER_OVER_RECEIPT");
    if (item.product.packagingMode === "per_pack") throw new AppError("Receive this product through Stock In with its pack size", 422, "PURCHASE_ORDER_PER_PACK_UNSUPPORTED");
    if (item.product.batchTrackingEnabled && (!input.batchNumber || !input.expiresOn)) throw new AppError("Supply the batch number and expiry date for each batch-tracked item", 422, "PURCHASE_BATCH_REQUIRED");
    const factor = factors.get(item.productId);
    return { ...input, productName: item.productName, baseUnit: item.baseUnit, rateUnit: item.rateUnit,
      lineAmount: multiplyMoney(input.actualRate, input.quantityBaseQty / factor), expectedAmount: multiplyMoney(item.expectedRate, input.quantityBaseQty / factor) };
  });
  const totalAmount = round2(lines.reduce((sum, row) => sum + row.lineAmount, 0));
  if (data.paidAmount > totalAmount) throw new AppError("Paid amount exceeds the receipt total", 422, "PURCHASE_RECEIPT_PAYMENT_INVALID");
  if (data.paidAmount > 0 && !data.paymentMode) throw new AppError("Supply the recorded payment method", 422, "PURCHASE_RECEIPT_PAYMENT_MODE_REQUIRED");
  const reconciliation = calculateReceiptReconciliation({ expectedAmounts: lines.map(row => row.expectedAmount), actualAmounts: lines.map(row => row.lineAmount), ...data, approvedByUserId: approverUserId });
  if (reconciliation.approvalRequired) throw new AppError("Explain the invoice or price variance before approving this receipt", 422, "PURCHASE_VARIANCE_REASON_REQUIRED");
  return { ...preview, lines, totalAmount, paidAmount: data.paidAmount, dueAmount: round2(totalAmount - data.paidAmount) };
}

/** Lock the reviewed order version before any stock/accounting mutation. */
export async function lockOrderApproval(client, shopId, id, action, data, expected, approverUserId = null) {
  if (!expected) return;
  const preview = await orderActionPreview(client, shopId, id, action, data, approverUserId);
  assertApproval(preview, expected);
  const locked = await client.purchaseOrder.updateMany({ where: { id, shopId, updatedAt: new Date(preview.updatedAt), status: preview.status }, data: { updatedAt: new Date(Math.max(Date.now(), new Date(preview.updatedAt).getTime() + 1)) } });
  if (locked.count !== 1) throw new AppError("Purchase order changed. Review a new plan.", 409, "PURCHASE_APPROVAL_CHANGED");
}
