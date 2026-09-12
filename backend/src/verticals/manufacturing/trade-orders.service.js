import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";
import { decrementLocationInventory, resolveOperationalLocation, getVariantLocationQuantity } from "../../modules/stores/location-context.service.js";
import { createSaleReturn, getBill } from "../../modules/bills/bills.service.js";
import { stockLedgerProvenance } from "../../modules/inventory/stock-ledger-provenance.js";
import { formatDateInTimeZone } from "../../utils/dates.js";
import { exportTaxTreatment, tradeReturnFulfilment } from "./trade-invoices.service.js";

const detailInclude = { items: { include: { allocations: true } }, dispatches: { orderBy: { dispatchDate: "asc" } } };
/** Statuses whose open reservations still hold stock away from other orders. */
const RESERVING_STATUSES = ["allocated", "packed", "partially_dispatched"];
/** Base units of a line already shipped — an allocation tied to a consignment. */
const shippedBaseQty = (item) => round2((item.allocations || []).filter((row) => row.dispatchId).reduce((sum, row) => sum + Number(row.quantityBaseQty), 0));
/** What the buyer is still owed on a line once every consignment is counted. */
const outstandingBaseQty = (item) => round2(Number(item.quantityBaseQty) - shippedBaseQty(item));
/** Base units reserved for the consignment being prepared now. */
const openBaseQty = (item) => round2((item.allocations || []).filter((row) => !row.dispatchId).reduce((sum, row) => sum + Number(row.quantityBaseQty), 0));
const date = (value) => value ? new Date(`${value}T00:00:00.000Z`) : null;
const today = () => date(formatDateInTimeZone(new Date()));
function orderLocation(order, actor = {}) {
  if (actor.locationId && actor.locationId !== order.locationId) throw new AppError("Switch to this order's location before updating its stock", 403, "TRADE_ORDER_LOCATION_MISMATCH");
}

export function listTradeOrders(shopId, query = {}) {
  return db.tradeOrder.findMany({ where: { shopId, ...(query.status && query.status !== "all" ? { status: query.status } : {}) }, orderBy: { createdAt: "desc" }, take: query.limit || 100, include: detailInclude });
}

export async function getTradeOrder(shopId, id) {
  const row = await db.tradeOrder.findFirst({ where: { id, shopId }, include: detailInclude });
  if (!row) throw new AppError("Trade order not found", 404, "TRADE_ORDER_NOT_FOUND");
  return row;
}

export async function createTradeOrder(shopId, input) {
  const location = await resolveOperationalLocation(shopId, input.locationId);
  const ids = [...new Set(input.items.map((row) => row.productId))];
  const products = await db.product.findMany({ where: { shopId, id: { in: ids }, deletedAt: null }, include: { sellingUnits: true } });
  const byId = new Map(products.map((row) => [row.id, row]));
  if (products.length !== ids.length) throw new AppError("One or more order products are unavailable", 422, "TRADE_ORDER_PRODUCT_UNAVAILABLE");
  // Allocation, dispatch, invoicing and returns all move stock by batch. An
  // untracked product was accepted here and confirmed, then allocation reported
  // "insufficient batches" with the shelf full, and the order sat stuck.
  const untracked = products.find((row) => !row.batchTrackingEnabled);
  if (untracked) throw new AppError(`Turn on batch tracking for ${untracked.name} before adding it to a wholesale order. Orders reserve and dispatch stock by batch.`, 422, "TRADE_ORDER_BATCH_TRACKING_REQUIRED");
  const items = input.items.map((row) => {
    const product = byId.get(row.productId);
    const unit = row.sellingUnitId ? product.sellingUnits.find((candidate) => candidate.id === row.sellingUnitId && candidate.isActive) : null;
    if (row.sellingUnitId && !unit) throw new AppError(`Selected packaging is unavailable for ${product.name}`, 422, "TRADE_ORDER_PACKAGING_INVALID");
    if (product.packagingMode === "per_pack" && !unit) throw new AppError(`Select the packaging for ${product.name}`, 422, "TRADE_ORDER_PACKAGING_REQUIRED");
    const conversion = Number(unit?.conversionToBase || 1);
    const quantityBaseQty = round2(Number(row.quantity) * conversion);
    if (!Number.isFinite(quantityBaseQty) || quantityBaseQty < 0.01 || quantityBaseQty > 1e9 || (unit && !(Number(unit.conversionToBase) > 0))) throw new AppError(`Invalid stock quantity for ${product.name}`, 422, "TRADE_ORDER_QUANTITY_INVALID");
    const gross = round2(Number(row.quantity) * Number(row.unitPrice));
    if (Number(row.lineDiscount) > gross) throw new AppError(`Discount exceeds line value for ${product.name}`, 422, "TRADE_ORDER_DISCOUNT_INVALID");
    return { shopId, productId: product.id, sellingUnitId: unit?.id ?? null, sku: unit?.sku ?? product.sku ?? null, buyerProductCode: row.buyerProductCode ?? null, description: product.name, hsn: product.hsn ?? null, quantity: row.quantity, quantityBaseQty, unitPrice: row.unitPrice, gstRate: product.gstRate, lineDiscount: row.lineDiscount, lineTotal: round2(gross - Number(row.lineDiscount)) };
  });
  return db.tradeOrder.create({ data: { shopId, locationId: location.id, orderNumber: input.orderNumber, buyerPoNumber: input.buyerPoNumber ?? null, customerId: input.customerId ?? null, customerName: input.customerName, customerGstin: input.customerGstin ?? null, billingAddress: input.billingAddress ?? null, shippingAddress: input.shippingAddress ?? null, orderType: input.orderType, currencyCode: input.currencyCode, exchangeRate: input.exchangeRate, priceBasis: input.priceBasis ?? null, requestedDeliveryDate: date(input.requestedDeliveryDate), iec: input.iec ?? null, lutBondReference: input.lutBondReference ?? null, countryOfDestination: input.countryOfDestination ?? null, countryOfOrigin: input.countryOfOrigin ?? null, portOfLoading: input.portOfLoading ?? null, portOfDischarge: input.portOfDischarge ?? null, incoterm: input.incoterm ?? null, paymentTerms: input.paymentTerms ?? null, notes: input.notes ?? null, items: { create: items } }, include: detailInclude });
}

export async function confirmTradeOrder(shopId, id) {
  const changed = await db.tradeOrder.updateMany({ where: { id, shopId, status: "draft" }, data: { status: "confirmed", confirmedAt: new Date() } });
  if (changed.count !== 1) throw new AppError("Only a draft order can be confirmed", 409, "TRADE_ORDER_NOT_DRAFT");
  return getTradeOrder(shopId, id);
}

export async function allocateTradeOrder(shopId, id, input, actor = {}) {
  return db.$transaction(async (tx) => {
    // A partially dispatched order is still open: the rest of it is a back-order
    // waiting for stock, and allocating again prepares the next consignment.
    const allocatable = ["confirmed", "allocated", "partially_dispatched"];
    const order = await tx.tradeOrder.findFirst({ where: { id, shopId, status: { in: allocatable } }, include: detailInclude });
    if (!order) throw new AppError("Confirm the order before allocating batches", 409, "TRADE_ORDER_NOT_CONFIRMABLE_FOR_ALLOCATION");
    orderLocation(order, actor);
    const claimed = await tx.tradeOrder.updateMany({ where: { id, shopId, status: { in: allocatable } }, data: { status: "allocating" } });
    if (claimed.count !== 1) throw new AppError("This order changed. Refresh before allocating", 409, "TRADE_ORDER_NOT_CONFIRMABLE_FOR_ALLOCATION");
    // Serialize reservations sharing a batch, without changing its quantity.
    // Deterministic lock order also avoids opposite-order batch lock cycles.
    for (const lotId of [...new Set(input.allocations.map((row) => row.inventoryLotId))].sort()) {
      await tx.inventoryLot.updateMany({ where: { id: lotId, shopId, locationId: order.locationId }, data: { updatedAt: new Date() } });
    }
    const itemById = new Map(order.items.map((row) => [row.id, row]));
    const requestedByItem = new Map();
    const requestedByLot = new Map();
    const sourceKeys = new Set();
    const next = [];
    for (const allocation of input.allocations) {
      const item = itemById.get(allocation.orderItemId);
      if (!item) throw new AppError("An allocation does not belong to this order", 422, "TRADE_ALLOCATION_ITEM_INVALID");
      const sourceKey = JSON.stringify([item.id, allocation.inventoryLotId]);
      if (sourceKeys.has(sourceKey)) throw new AppError("Combine duplicate allocations for the same order line and batch", 422, "TRADE_ALLOCATION_DUPLICATE");
      sourceKeys.add(sourceKey);
      const lot = await tx.inventoryLot.findFirst({ where: { id: allocation.inventoryLotId, shopId, locationId: order.locationId, productId: item.productId, status: "active", expiresOn: { gte: today() } } });
      if (!lot) throw new AppError(`A selected batch is unavailable for ${item.description}`, 422, "TRADE_ALLOCATION_BATCH_INVALID");
      if (lot.sellingUnitId && lot.sellingUnitId !== item.sellingUnitId) throw new AppError(`The selected batch uses different packaging for ${item.description}`, 422, "TRADE_ALLOCATION_PACKAGING_MISMATCH");
      // Only OPEN reservations hold stock back. A shipped allocation already
      // decremented the lot, so counting it again would hide real availability.
      const reserved = await tx.tradeOrderAllocation.aggregate({ where: { shopId, inventoryLotId: lot.id, dispatchId: null, orderItem: { order: { status: { in: RESERVING_STATUSES }, id: { not: order.id } } } }, _sum: { quantityBaseQty: true } });
      const available = round2(Number(lot.availableBaseQty) - Number(reserved._sum.quantityBaseQty || 0));
      const requested = round2((requestedByLot.get(lot.id) || 0) + Number(allocation.quantityBaseQty));
      if (requested > available) throw new AppError(`Batch ${lot.batchNumber} has only ${available} unreserved base units`, 409, "TRADE_ALLOCATION_STOCK_SHORT");
      requestedByLot.set(lot.id, requested);
      requestedByItem.set(item.id, round2(Number(requestedByItem.get(item.id) || 0) + Number(allocation.quantityBaseQty)));
      next.push({ shopId, orderItemId: item.id, inventoryLotId: lot.id, batchNumber: lot.batchNumber, quantityBaseQty: allocation.quantityBaseQty });
    }
    // A line may be reserved short — that is the whole point of a back-order —
    // but never beyond what is still owed after earlier consignments.
    for (const item of order.items) {
      const requested = Number(requestedByItem.get(item.id) || 0);
      const outstanding = outstandingBaseQty(item);
      if (requested - outstanding > 0.001) throw new AppError(`Only ${outstanding} base units are still outstanding for ${item.description}`, 422, "TRADE_ALLOCATION_EXCEEDS_OUTSTANDING");
    }
    if (![...requestedByItem.values()].some((value) => Number(value) > 0.001)) throw new AppError("Allocate at least one batch before saving", 422, "TRADE_ALLOCATION_EMPTY");
    // Only the open reservation is replaced; what has already shipped is history.
    await tx.tradeOrderAllocation.deleteMany({ where: { orderItem: { orderId: order.id }, dispatchId: null } });
    await tx.tradeOrderAllocation.createMany({ data: next });
    return tx.tradeOrder.update({ where: { id: order.id }, data: { status: "allocated", allocatedAt: new Date() }, include: detailInclude });
  });
}

export async function autoAllocateTradeOrder(shopId, id, actor = {}) {
  const order = await getTradeOrder(shopId, id);
  orderLocation(order, actor);
  if (!["confirmed", "allocated", "partially_dispatched"].includes(order.status)) throw new AppError("Confirm the order before allocating batches", 409, "TRADE_ORDER_NOT_CONFIRMABLE_FOR_ALLOCATION");
  const allocations = [];
  const usedByLot = new Map();
  for (const item of order.items) {
    let remaining = outstandingBaseQty(item);
    if (remaining <= 0.001) continue;
    const lots = await db.inventoryLot.findMany({
      where: { shopId, locationId: order.locationId, productId: item.productId, status: "active", availableBaseQty: { gt: 0 }, expiresOn: { gte: today() }, OR: [{ sellingUnitId: null }, { sellingUnitId: item.sellingUnitId ?? null }] },
      orderBy: [{ expiresOn: "asc" }, { createdAt: "asc" }],
    });
    for (const lot of lots) {
      const reserved = await db.tradeOrderAllocation.aggregate({
        where: { shopId, inventoryLotId: lot.id, dispatchId: null, orderItem: { order: { status: { in: RESERVING_STATUSES }, id: { not: order.id } } } },
        _sum: { quantityBaseQty: true },
      });
      const available = Math.max(0, round2(Number(lot.availableBaseQty) - Number(reserved._sum.quantityBaseQty || 0) - (usedByLot.get(lot.id) || 0)));
      const quantityBaseQty = Math.min(remaining, available);
      if (quantityBaseQty > 0) {
        allocations.push({ orderItemId: item.id, inventoryLotId: lot.id, quantityBaseQty });
        usedByLot.set(lot.id, round2((usedByLot.get(lot.id) || 0) + quantityBaseQty));
      }
      remaining = round2(remaining - quantityBaseQty);
      if (remaining <= 0.001) break;
    }
  }
  // Reserving less than the buyer ordered is normal now — the rest stays on the
  // order as a back-order. Only a run that could reserve nothing at all is an
  // error worth stopping for.
  if (allocations.length === 0) throw new AppError("No available batches for any line on this order", 409, "TRADE_ALLOCATION_STOCK_SHORT");
  return allocateTradeOrder(shopId, id, { allocations }, actor);
}

export async function packTradeOrder(shopId, id, input) {
  return db.$transaction(async (tx) => {
    const order = await tx.tradeOrder.findFirst({ where: { id, shopId, status: "allocated" }, include: { items: { include: { allocations: true } } } });
    if (!order) throw new AppError("Allocate batches before packing", 409, "TRADE_ORDER_NOT_ALLOCATED");
    const claimed = await tx.tradeOrder.updateMany({ where: { id, shopId, status: "allocated" }, data: { status: "packing" } });
    if (claimed.count !== 1) throw new AppError("This order changed. Refresh before packing", 409, "TRADE_ORDER_NOT_ALLOCATED");
    // Only the lines in this consignment are packed. A line reserved short is
    // packed short; a line with nothing reserved is not in this shipment at all.
    const reserved = new Map(order.items.map((item) => [item.id, openBaseQty(item)]));
    const inConsignment = order.items.filter((item) => reserved.get(item.id) > 0.001);
    if (inConsignment.length === 0) throw new AppError("Allocate batches before packing", 409, "TRADE_ORDER_NOT_ALLOCATED");
    if (new Set(input.items.map((row) => row.orderItemId)).size !== input.items.length) throw new AppError("Record each order line exactly once", 422, "TRADE_PACK_QUANTITY_MISMATCH");
    const packed = new Map(input.items.map((row) => [row.orderItemId, Number(row.packedQuantity)]));
    for (const row of input.items) if (!reserved.has(row.orderItemId) || reserved.get(row.orderItemId) <= 0.001) throw new AppError("A packed line is not part of this consignment", 422, "TRADE_PACK_QUANTITY_MISMATCH");
    for (const item of inConsignment) {
      // packedQuantity is in the line's own selling unit; the reservation is in
      // base units, so compare on the base scale both sides share.
      const perUnit = Number(item.quantityBaseQty) / Number(item.quantity);
      const expected = round2(reserved.get(item.id) / perUnit);
      if (Math.abs(Number(packed.get(item.id) ?? NaN) - expected) > 0.001) throw new AppError(`Packed quantity must match the batches reserved for ${item.description}`, 422, "TRADE_PACK_QUANTITY_MISMATCH");
      await tx.tradeOrderItem.update({ where: { id: item.id }, data: { packedQuantity: packed.get(item.id) } });
    }
    return tx.tradeOrder.update({ where: { id: order.id }, data: { status: "packed", packedAt: new Date() }, include: detailInclude });
  });
}

export async function dispatchTradeOrder(shopId, id, input, actor = {}) {
  return db.$transaction(async (tx) => {
    const order = await tx.tradeOrder.findFirst({ where: { id, shopId, status: "packed" }, include: detailInclude });
    if (!order) throw new AppError("Pack the order before dispatch", 409, "TRADE_ORDER_NOT_PACKED");
    orderLocation(order, actor);
    const claimed = await tx.tradeOrder.updateMany({ where: { id, shopId, status: "packed" }, data: { status: "dispatching" } });
    if (claimed.count !== 1) throw new AppError("This order changed. Refresh before dispatch", 409, "TRADE_ORDER_NOT_PACKED");
    const location = await resolveOperationalLocation(shopId, order.locationId, tx);
    const dispatch = await tx.tradeDispatch.create({ data: { shopId, orderId: order.id, dispatchNumber: input.dispatchNumber, dispatchDate: date(input.dispatchDate), transporterName: input.transporterName ?? null, transporterGstin: input.transporterGstin ?? null, vehicleNumber: input.vehicleNumber ?? null, lrAwbNumber: input.lrAwbNumber ?? null, ewayBillNumber: input.ewayBillNumber ?? null, shippingBillNumber: input.shippingBillNumber ?? null, shippingBillDate: date(input.shippingBillDate), containerNumber: input.containerNumber ?? null, packageCount: input.packageCount ?? null, netWeight: input.netWeight ?? null, grossWeight: input.grossWeight ?? null, sealNumber: input.sealNumber ?? null, notes: input.notes ?? null } });
    // Only the lines reserved for this consignment ship; the rest stay owed.
    const consignment = order.items.filter((item) => openBaseQty(item) > 0.001);
    if (consignment.length === 0) throw new AppError("Allocate batches before dispatch", 409, "TRADE_ORDER_NOT_ALLOCATED");
    for (const item of consignment) {
      const product = await tx.product.findFirst({ where: { id: item.productId, shopId, deletedAt: null }, include: { sellingUnits: true } });
      if (!product) throw new AppError(`Product unavailable: ${item.description}`, 409, "TRADE_DISPATCH_PRODUCT_UNAVAILABLE");
      const unit = item.sellingUnitId ? product.sellingUnits.find((row) => row.id === item.sellingUnitId && row.isActive) : null;
      if ((item.sellingUnitId && !unit) || (product.packagingMode === "per_pack" && !unit) || Math.abs(round2(Number(item.quantity) * Number(unit?.conversionToBase || 1)) - item.quantityBaseQty) > 0.001) throw new AppError(`Packaging changed for ${item.description}; review the order`, 409, "TRADE_DISPATCH_PACKAGING_CHANGED");
      const shipping = item.allocations.filter((row) => !row.dispatchId);
      const shippingBase = round2(shipping.reduce((sum, row) => sum + Number(row.quantityBaseQty), 0));
      if (shippingBase - outstandingBaseQty(item) > 0.001) throw new AppError(`More is reserved than is outstanding for ${item.description}`, 409, "TRADE_ALLOCATION_EXCEEDS_OUTSTANDING");
      for (const allocation of shipping) {
        const lot = await tx.inventoryLot.findFirst({ where: { id: allocation.inventoryLotId, shopId, locationId: location.id, productId: item.productId, status: "active", expiresOn: { gte: today() } } });
        if (!lot || Number(lot.availableBaseQty) < Number(allocation.quantityBaseQty)) throw new AppError(`Batch stock changed for ${allocation.batchNumber}; allocate again`, 409, "TRADE_DISPATCH_BATCH_STOCK_CHANGED");
        if (lot.sellingUnitId && lot.sellingUnitId !== item.sellingUnitId) throw new AppError(`Batch packaging changed for ${item.description}`, 409, "TRADE_ALLOCATION_PACKAGING_MISMATCH");
        const movedLot = await tx.inventoryLot.updateMany({ where: { id: lot.id, status: "active", availableBaseQty: { gte: allocation.quantityBaseQty }, expiresOn: { gte: today() } }, data: { availableBaseQty: { decrement: allocation.quantityBaseQty } } });
        if (movedLot.count !== 1) throw new AppError(`Batch stock changed for ${allocation.batchNumber}; allocate again`, 409, "TRADE_DISPATCH_BATCH_STOCK_CHANGED");
        await tx.inventoryLot.updateMany({ where: { id: lot.id, availableBaseQty: 0 }, data: { status: "depleted" } });
      }
      // The shipped quantity is this consignment's, not the whole line's.
      const perUnit = Number(item.quantityBaseQty) / Number(item.quantity);
      const shippingQty = round2(shippingBase / perUnit);
      const packs = unit ? new Map([[unit.id, { sellingUnit: unit, qty: shippingQty }]]) : null;
      const moved = await decrementLocationInventory(tx, { shopId, location, product, quantityBase: shippingBase, packs });
      if (unit && product.packagingMode === "per_pack" && await getVariantLocationQuantity(tx, shopId, location, product, unit.id) < 0) throw new AppError(`Insufficient selected packaging stock for ${item.description}`, 409, "TRADE_DISPATCH_PACK_STOCK_SHORT");
      // Scoped to the consignment, so an order shipped twice keeps two separate
      // stock records and neither invoice can bill the other's goods.
      await tx.stockLedger.create({ data: { shopId, locationId: location.id, productId: product.id, productName: product.name, ...stockLedgerProvenance(actor), sellingUnitId: unit?.id ?? null, sellingUnitQty: unit ? shippingQty : null, action: "trade_dispatch", changeBaseQty: -shippingBase, oldStockBaseQty: moved.oldStock, newStockBaseQty: moved.newStock, sourceType: "trade_dispatch", sourceId: dispatch.id, note: `Dispatch ${input.dispatchNumber} for ${order.orderNumber}` } });
      await tx.tradeOrderAllocation.updateMany({ where: { id: { in: shipping.map((row) => row.id) } }, data: { dispatchId: dispatch.id } });
    }
    // Anything still owed keeps the order open for a later consignment.
    const remaining = order.items.reduce((sum, item) => sum + (consignment.includes(item) ? round2(outstandingBaseQty(item) - openBaseQty(item)) : outstandingBaseQty(item)), 0);
    const status = remaining > 0.001 ? "partially_dispatched" : "dispatched";
    return tx.tradeOrder.update({ where: { id: order.id }, data: { status, dispatchedAt: new Date() }, include: detailInclude });
  });
}

export async function cancelTradeOrder(shopId, id) {
  const changed = await db.tradeOrder.updateMany({ where: { id, shopId, status: { in: ["draft", "confirmed", "allocated", "packed"] } }, data: { status: "cancelled", cancelledAt: new Date() } });
  if (changed.count !== 1) throw new AppError("This order can no longer be cancelled", 409, "TRADE_ORDER_CANNOT_CANCEL");
  return getTradeOrder(shopId, id);
}

export async function returnTradeOrder(shopId, id, input, actor = {}) {
  const order = await getTradeOrder(shopId, id);
  orderLocation(order, actor);
  if (order.status === "returned") {
    const creditNote = await db.bill.findFirst({ where: { shopId, returnOfBillId: order.billId, clientBillId: `trade-return:${order.id}`, status: "active" }, include: { items: true, payments: true } });
    if (creditNote) return { order, creditNote };
  }
  if (!order.billId || order.status !== "invoiced") throw new AppError("Create the dispatched invoice before creating a credit note", 409, "TRADE_ORDER_INVOICE_REQUIRED");
  const bill = await getBill(shopId, order.billId);
  if (bill.status !== "active" || bill.billType === "sales_return") throw new AppError("The linked invoice cannot be returned", 409, "TRADE_ORDER_BILL_NOT_RETURNABLE");
  if (Number(bill.creditAmount) > 0 && Number(bill.paidAmount) > 0) throw new AppError("This invoice has mixed settlement; reconcile its credit and tender before a full return", 409, "TRADE_RETURN_MIXED_SETTLEMENT");
  const refundMode = Number(bill.creditAmount) > 0 ? "udhar" : input.refundMode;
  if (refundMode === "udhar" && !(Number(bill.creditAmount) > 0)) throw new AppError("Choose a refund method for this paid invoice", 422, "TRADE_RETURN_REFUND_MODE_INVALID");
  const creditNote = await createSaleReturn(shopId, {
    locationId: order.locationId, refundMode, gstMode: bill.gstMode,
    customerId: bill.customerId || undefined, customerName: bill.customerName, returnOfBillId: bill.id, reason: input.reason,
    clientBillId: `trade-return:${order.id}`, idempotencyKey: `trade-return:${order.id}`,
    items: bill.items.map((line) => ({ originalBillItemId: line.id, productId: line.productId || undefined, name: line.name, quantity: Math.abs(Number(line.quantity)), enteredUnit: line.enteredUnit, ratePerRateUnit: Math.abs(Number(line.ratePerRateUnit)), lineDiscount: Math.abs(Number(line.lineDiscount || 0)), gstRate: Number(line.gstRate || 0), damaged: false })),
  }, { ...actor, locationId: order.locationId }, tradeReturnFulfilment(shopId, order, actor));
  return { order: await getTradeOrder(shopId, order.id), creditNote };
}

export async function tradeDocuments(shopId, id) {
  const order = await getTradeOrder(shopId, id);
  const latestDispatch = order.dispatches?.at(-1);
  const treatment = order.orderType === "export" ? exportTaxTreatment(order) : null;
  // Zero only under an LUT. An export without one carries IGST at the item rate,
  // which the exporter reclaims as a refund afterwards.
  const taxRate = (row) => (treatment?.underLut ? 0 : Number(row.gstRate));
  const totals = order.items.reduce((acc, row) => ({ quantity: acc.quantity + Number(row.quantity), subtotal: acc.subtotal + Number(row.lineTotal), gst: acc.gst + Number(row.lineTotal) * taxRate(row) / 100 }), { quantity: 0, subtotal: 0, gst: 0 });
  return { order, packingList: { documentNumber: latestDispatch?.dispatchNumber || order.orderNumber, buyer: order.customerName, shipTo: order.shippingAddress, items: order.items.map((row) => ({ sku: row.sku, buyerProductCode: row.buyerProductCode, description: row.description, quantity: row.packedQuantity || row.quantity, batches: row.allocations.map((allocation) => allocation.batchNumber) })), packageCount: latestDispatch?.packageCount, netWeight: latestDispatch?.netWeight, grossWeight: latestDispatch?.grossWeight }, commercialInvoice: { invoiceReference: order.billId, orderNumber: order.orderNumber, buyerPoNumber: order.buyerPoNumber, currencyCode: order.currencyCode, exchangeRate: order.exchangeRate, incoterm: order.incoterm, destination: order.countryOfDestination, origin: order.countryOfOrigin, iec: order.iec, lutBondReference: order.lutBondReference, underLut: treatment?.underLut ?? false, declaration: treatment?.declaration ?? null, portOfLoading: order.portOfLoading, portOfDischarge: order.portOfDischarge, subtotal: round2(totals.subtotal), gst: round2(totals.gst), total: round2(totals.subtotal + totals.gst), paymentTerms: order.paymentTerms } };
}
