import crypto from "crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { moneyShadows, multiplyMoney, round2 } from "../../utils/money.js";
import { rateUnitToBase } from "../../utils/units.js";
import { decrementLocationInventory } from "../stores/location-context.service.js";

const include = { location: true, supplier: true, purchaseReceipt: true, items: { include: { product: true, purchaseReceiptItem: true } } };
const ref = () => `PR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

export async function listPurchaseReturns(shopId, { locationId, limit = 100 } = {}) {
  return db.purchaseReturn.findMany({ where: { shopId, ...(locationId && { locationId }) }, include, orderBy: { createdAt: "desc" }, take: Math.min(Number(limit) || 100, 200) });
}

async function removeReturnedLots(tx, { shopId, locationId, product, receiptItemId, quantity }) {
  if (!product.batchTrackingEnabled) return [];
  const lots = await tx.inventoryLot.findMany({ where: { shopId, locationId, productId: product.id, availableBaseQty: { gt: 0 } }, orderBy: [{ purchaseReceiptItemId: "asc" }, { expiresOn: "asc" }, { createdAt: "asc" }] });
  const preferred = [...lots.filter((lot) => lot.purchaseReceiptItemId === receiptItemId), ...lots.filter((lot) => lot.purchaseReceiptItemId !== receiptItemId)];
  const available = round2(preferred.reduce((sum, lot) => sum + lot.availableBaseQty, 0));
  if (available + 0.000001 < quantity) throw new AppError(`${product.name} has insufficient batch stock to return`, 409, "PURCHASE_RETURN_BATCH_STOCK_INSUFFICIENT");
  const allocations = []; let remaining = quantity;
  for (const lot of preferred) {
    if (remaining <= 0.000001) break;
    const taken = round2(Math.min(remaining, lot.availableBaseQty));
    const changed = await tx.inventoryLot.updateMany({ where: { id: lot.id, availableBaseQty: { gte: taken } }, data: { availableBaseQty: { decrement: taken } } });
    if (changed.count !== 1) throw new AppError("Batch stock changed while returning; retry", 409, "CONCURRENT_BATCH_STOCK_CHANGE");
    const updated = await tx.inventoryLot.findUnique({ where: { id: lot.id } });
    if (updated.availableBaseQty <= 0.000001) await tx.inventoryLot.update({ where: { id: lot.id }, data: { availableBaseQty: 0, status: "depleted" } });
    allocations.push({ inventoryLotId: lot.id, batchNumber: lot.batchNumber, quantityBaseQty: taken }); remaining = round2(remaining - taken);
  }
  return allocations;
}

export async function createPurchaseReturn(shopId, data, userId) {
  return db.$transaction(async (tx) => {
    const receipt = await tx.purchaseReceipt.findFirst({ where: { id: data.purchaseReceiptId, shopId }, include: { location: true, supplier: true, items: { include: { product: true, purchaseOrderItem: true, returnItems: true } } } });
    if (!receipt) throw new AppError("Purchase receipt not found", 404, "PURCHASE_RECEIPT_NOT_FOUND");
    if (!receipt.location.active) throw new AppError("Receipt branch is inactive", 409, "STORE_LOCATION_UNAVAILABLE");
    const byId = new Map(receipt.items.map((item) => [item.id, item]));
    const lines = data.items.map((input) => {
      const item = byId.get(input.purchaseReceiptItemId);
      if (!item) throw new AppError("Return line is not part of this receipt", 422, "PURCHASE_RETURN_ITEM_INVALID");
      const alreadyReturned = round2(item.returnItems.reduce((sum, row) => sum + row.quantityBaseQty, 0));
      const remaining = round2(item.quantityBaseQty - alreadyReturned);
      if (input.quantityBaseQty > remaining + 0.000001) throw new AppError(`${item.product.name} has only ${remaining} ${item.product.baseUnit} returnable`, 409, "PURCHASE_RETURN_EXCEEDS_RECEIPT");
      const factor = rateUnitToBase(item.purchaseOrderItem.rateUnit, item.purchaseOrderItem.baseUnit);
      return { input, item, lineAmount: multiplyMoney(item.actualRate, input.quantityBaseQty / factor) };
    });
    const totalAmount = round2(lines.reduce((sum, line) => sum + line.lineAmount, 0));
    const supplierCreditAmount = round2(Math.min(Number(receipt.dueAmount || 0), totalAmount));
    const refundAmount = round2(totalAmount - supplierCreditAmount);
    const purchaseReturn = await tx.purchaseReturn.create({
      data: { shopId, locationId: receipt.locationId, supplierId: receipt.supplierId, purchaseReceiptId: receipt.id, returnNumber: ref(), refundMode: data.refundMode, totalAmount, supplierCreditAmount, refundAmount, ...moneyShadows({ totalAmount, supplierCreditAmount, refundAmount }), reason: data.reason, supplierReference: data.supplierReference || null, createdByUserId: userId || null },
    });
    for (const line of lines) {
      const quantity = round2(line.input.quantityBaseQty);
      const stock = await decrementLocationInventory(tx, { shopId, location: receipt.location, product: line.item.product, quantityBase: quantity, allowShortfall: false });
      const lotAllocations = await removeReturnedLots(tx, { shopId, locationId: receipt.locationId, product: line.item.product, receiptItemId: line.item.id, quantity });
      await tx.stockLedger.create({ data: { shopId, locationId: receipt.locationId, productId: line.item.productId, productName: line.item.product.name, action: "purchase_return", changeBaseQty: -quantity, oldStockBaseQty: stock.oldStock, newStockBaseQty: stock.newStock, purchaseBillAmount: -line.lineAmount, ...moneyShadows({ purchaseBillAmount: -line.lineAmount }), invoiceNumber: receipt.supplierInvoiceNumber || receipt.receiptNumber, supplierName: receipt.supplier?.name || null, sourceType: "purchase_return", sourceId: purchaseReturn.id, note: `Purchase return ${purchaseReturn.returnNumber}: ${data.reason}` } });
      await tx.purchaseReturnItem.create({ data: { purchaseReturnId: purchaseReturn.id, purchaseReceiptItemId: line.item.id, productId: line.item.productId, quantityBaseQty: quantity, actualRate: line.item.actualRate, lineAmount: line.lineAmount, ...moneyShadows({ actualRate: line.item.actualRate, lineAmount: line.lineAmount }), lotAllocationsJson: JSON.stringify(lotAllocations) } });
    }
    const dueAmount = round2(Math.max(0, Number(receipt.dueAmount || 0) - supplierCreditAmount));
    await tx.purchaseReceipt.update({ where: { id: receipt.id }, data: { dueAmount, ...moneyShadows({ dueAmount }) } });
    return tx.purchaseReturn.findUnique({ where: { id: purchaseReturn.id }, include });
  });
}
