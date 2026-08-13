import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";
import { decrementLocationInventory, resolveOperationalLocation } from "../../modules/stores/location-context.service.js";

const detailInclude = { items: { include: { allocations: true } }, dispatch: true };
const date = (value) => value ? new Date(`${value}T00:00:00.000Z`) : null;

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
  const items = input.items.map((row) => {
    const product = byId.get(row.productId);
    const unit = row.sellingUnitId ? product.sellingUnits.find((candidate) => candidate.id === row.sellingUnitId && candidate.isActive) : null;
    if (row.sellingUnitId && !unit) throw new AppError(`Selected packaging is unavailable for ${product.name}`, 422, "TRADE_ORDER_PACKAGING_INVALID");
    const conversion = Number(unit?.conversionToBase || 1);
    const gross = round2(Number(row.quantity) * Number(row.unitPrice));
    if (Number(row.lineDiscount) > gross) throw new AppError(`Discount exceeds line value for ${product.name}`, 422, "TRADE_ORDER_DISCOUNT_INVALID");
    return { shopId, productId: product.id, sellingUnitId: unit?.id ?? null, sku: unit?.sku ?? product.sku ?? null, buyerProductCode: row.buyerProductCode ?? null, description: product.name, hsn: product.hsn ?? null, quantity: row.quantity, quantityBaseQty: round2(Number(row.quantity) * conversion), unitPrice: row.unitPrice, gstRate: product.gstRate, lineDiscount: row.lineDiscount, lineTotal: round2(gross - Number(row.lineDiscount)) };
  });
  return db.tradeOrder.create({ data: { shopId, locationId: location.id, orderNumber: input.orderNumber, buyerPoNumber: input.buyerPoNumber ?? null, customerId: input.customerId ?? null, customerName: input.customerName, customerGstin: input.customerGstin ?? null, billingAddress: input.billingAddress ?? null, shippingAddress: input.shippingAddress ?? null, orderType: input.orderType, currencyCode: input.currencyCode, exchangeRate: input.exchangeRate, priceBasis: input.priceBasis ?? null, requestedDeliveryDate: date(input.requestedDeliveryDate), iec: input.iec ?? null, lutBondReference: input.lutBondReference ?? null, countryOfDestination: input.countryOfDestination ?? null, countryOfOrigin: input.countryOfOrigin ?? null, portOfLoading: input.portOfLoading ?? null, portOfDischarge: input.portOfDischarge ?? null, incoterm: input.incoterm ?? null, paymentTerms: input.paymentTerms ?? null, notes: input.notes ?? null, items: { create: items } }, include: detailInclude });
}

export async function confirmTradeOrder(shopId, id) {
  const order = await getTradeOrder(shopId, id);
  if (order.status !== "draft") throw new AppError("Only a draft order can be confirmed", 409, "TRADE_ORDER_NOT_DRAFT");
  return db.tradeOrder.update({ where: { id }, data: { status: "confirmed", confirmedAt: new Date() }, include: detailInclude });
}

export async function allocateTradeOrder(shopId, id, input) {
  return db.$transaction(async (tx) => {
    const order = await tx.tradeOrder.findFirst({ where: { id, shopId, status: { in: ["confirmed", "allocated"] } }, include: detailInclude });
    if (!order) throw new AppError("Confirm the order before allocating batches", 409, "TRADE_ORDER_NOT_CONFIRMABLE_FOR_ALLOCATION");
    const itemById = new Map(order.items.map((row) => [row.id, row]));
    const requestedByItem = new Map();
    const next = [];
    for (const allocation of input.allocations) {
      const item = itemById.get(allocation.orderItemId);
      if (!item) throw new AppError("An allocation does not belong to this order", 422, "TRADE_ALLOCATION_ITEM_INVALID");
      const lot = await tx.inventoryLot.findFirst({ where: { id: allocation.inventoryLotId, shopId, locationId: order.locationId, productId: item.productId, status: "active" } });
      if (!lot) throw new AppError(`A selected batch is unavailable for ${item.description}`, 422, "TRADE_ALLOCATION_BATCH_INVALID");
      const reserved = await tx.tradeOrderAllocation.aggregate({ where: { shopId, inventoryLotId: lot.id, orderItem: { order: { status: { in: ["allocated", "packed"] }, id: { not: order.id } } } }, _sum: { quantityBaseQty: true } });
      const available = round2(Number(lot.availableBaseQty) - Number(reserved._sum.quantityBaseQty || 0));
      if (Number(allocation.quantityBaseQty) > available) throw new AppError(`Batch ${lot.batchNumber} has only ${available} unreserved base units`, 409, "TRADE_ALLOCATION_STOCK_SHORT");
      requestedByItem.set(item.id, round2(Number(requestedByItem.get(item.id) || 0) + Number(allocation.quantityBaseQty)));
      next.push({ shopId, orderItemId: item.id, inventoryLotId: lot.id, batchNumber: lot.batchNumber, quantityBaseQty: allocation.quantityBaseQty });
    }
    for (const item of order.items) if (Math.abs(Number(requestedByItem.get(item.id) || 0) - Number(item.quantityBaseQty)) > 0.001) throw new AppError(`Allocate the full ordered quantity for ${item.description}`, 422, "TRADE_ALLOCATION_INCOMPLETE");
    await tx.tradeOrderAllocation.deleteMany({ where: { orderItem: { orderId: order.id } } });
    await tx.tradeOrderAllocation.createMany({ data: next });
    return tx.tradeOrder.update({ where: { id: order.id }, data: { status: "allocated", allocatedAt: new Date() }, include: detailInclude });
  });
}

export async function autoAllocateTradeOrder(shopId, id) {
  const order = await getTradeOrder(shopId, id);
  if (!["confirmed", "allocated"].includes(order.status)) throw new AppError("Confirm the order before allocating batches", 409, "TRADE_ORDER_NOT_CONFIRMABLE_FOR_ALLOCATION");
  const allocations = [];
  for (const item of order.items) {
    let remaining = Number(item.quantityBaseQty);
    const lots = await db.inventoryLot.findMany({
      where: { shopId, locationId: order.locationId, productId: item.productId, status: "active", availableBaseQty: { gt: 0 } },
      orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
    });
    for (const lot of lots) {
      const reserved = await db.tradeOrderAllocation.aggregate({
        where: { shopId, inventoryLotId: lot.id, orderItem: { order: { status: { in: ["allocated", "packed"] }, id: { not: order.id } } } },
        _sum: { quantityBaseQty: true },
      });
      const available = Math.max(0, round2(Number(lot.availableBaseQty) - Number(reserved._sum.quantityBaseQty || 0)));
      const quantityBaseQty = Math.min(remaining, available);
      if (quantityBaseQty > 0) allocations.push({ orderItemId: item.id, inventoryLotId: lot.id, quantityBaseQty });
      remaining = round2(remaining - quantityBaseQty);
      if (remaining <= 0.001) break;
    }
    if (remaining > 0.001) throw new AppError(`Insufficient available batches for ${item.description}; short by ${remaining} base units`, 409, "TRADE_ALLOCATION_STOCK_SHORT");
  }
  return allocateTradeOrder(shopId, id, { allocations });
}

export async function packTradeOrder(shopId, id, input) {
  return db.$transaction(async (tx) => {
    const order = await tx.tradeOrder.findFirst({ where: { id, shopId, status: "allocated" }, include: { items: true } });
    if (!order) throw new AppError("Allocate batches before packing", 409, "TRADE_ORDER_NOT_ALLOCATED");
    const packed = new Map(input.items.map((row) => [row.orderItemId, Number(row.packedQuantity)]));
    for (const item of order.items) {
      if (Math.abs(Number(packed.get(item.id) || 0) - Number(item.quantity)) > 0.001) throw new AppError(`Packed quantity must match the order for ${item.description}`, 422, "TRADE_PACK_QUANTITY_MISMATCH");
      await tx.tradeOrderItem.update({ where: { id: item.id }, data: { packedQuantity: packed.get(item.id) } });
    }
    return tx.tradeOrder.update({ where: { id: order.id }, data: { status: "packed", packedAt: new Date() }, include: detailInclude });
  });
}

export async function dispatchTradeOrder(shopId, id, input) {
  return db.$transaction(async (tx) => {
    const order = await tx.tradeOrder.findFirst({ where: { id, shopId, status: "packed" }, include: detailInclude });
    if (!order) throw new AppError("Pack the order before dispatch", 409, "TRADE_ORDER_NOT_PACKED");
    const location = await resolveOperationalLocation(shopId, order.locationId, tx);
    for (const item of order.items) {
      const product = await tx.product.findFirst({ where: { id: item.productId, shopId, deletedAt: null }, include: { sellingUnits: true } });
      if (!product) throw new AppError(`Product unavailable: ${item.description}`, 409, "TRADE_DISPATCH_PRODUCT_UNAVAILABLE");
      for (const allocation of item.allocations) {
        const lot = await tx.inventoryLot.findFirst({ where: { id: allocation.inventoryLotId, shopId, status: "active" } });
        if (!lot || Number(lot.availableBaseQty) < Number(allocation.quantityBaseQty)) throw new AppError(`Batch stock changed for ${allocation.batchNumber}; allocate again`, 409, "TRADE_DISPATCH_BATCH_STOCK_CHANGED");
        await tx.inventoryLot.update({ where: { id: lot.id }, data: { availableBaseQty: { decrement: allocation.quantityBaseQty }, ...(Math.abs(Number(lot.availableBaseQty) - Number(allocation.quantityBaseQty)) < 0.001 ? { status: "depleted" } : {}) } });
      }
      const unit = item.sellingUnitId ? product.sellingUnits.find((row) => row.id === item.sellingUnitId) : null;
      const packs = unit ? new Map([[unit.id, { sellingUnit: unit, qty: item.quantity }]]) : null;
      const moved = await decrementLocationInventory(tx, { shopId, location, product, quantityBase: item.quantityBaseQty, packs });
      await tx.stockLedger.create({ data: { shopId, locationId: location.id, productId: product.id, productName: product.name, sellingUnitId: unit?.id ?? null, sellingUnitQty: unit ? item.quantity : null, action: "trade_dispatch", changeBaseQty: -item.quantityBaseQty, oldStockBaseQty: moved.oldStock, newStockBaseQty: moved.newStock, sourceType: "trade_order", sourceId: order.id, note: `Dispatch ${input.dispatchNumber} for ${order.orderNumber}` } });
    }
    await tx.tradeDispatch.create({ data: { shopId, orderId: order.id, dispatchNumber: input.dispatchNumber, dispatchDate: date(input.dispatchDate), transporterName: input.transporterName ?? null, transporterGstin: input.transporterGstin ?? null, vehicleNumber: input.vehicleNumber ?? null, lrAwbNumber: input.lrAwbNumber ?? null, ewayBillNumber: input.ewayBillNumber ?? null, shippingBillNumber: input.shippingBillNumber ?? null, shippingBillDate: date(input.shippingBillDate), containerNumber: input.containerNumber ?? null, packageCount: input.packageCount ?? null, netWeight: input.netWeight ?? null, grossWeight: input.grossWeight ?? null, sealNumber: input.sealNumber ?? null, notes: input.notes ?? null } });
    return tx.tradeOrder.update({ where: { id: order.id }, data: { status: "dispatched", dispatchedAt: new Date() }, include: detailInclude });
  });
}

export async function attachTradeBill(shopId, id, billId) {
  const [order, bill] = await Promise.all([getTradeOrder(shopId, id), db.bill.findFirst({ where: { id: billId, shopId, status: "active", deletedAt: null } })]);
  if (order.status !== "dispatched") throw new AppError("Only a dispatched order can be linked to its invoice", 409, "TRADE_ORDER_NOT_DISPATCHED");
  if (!bill) throw new AppError("Invoice not found", 404, "TRADE_ORDER_BILL_NOT_FOUND");
  return db.tradeOrder.update({ where: { id }, data: { billId: bill.id, status: "invoiced" }, include: detailInclude });
}

export async function cancelTradeOrder(shopId, id) {
  const order = await getTradeOrder(shopId, id);
  if (["dispatched", "invoiced", "cancelled"].includes(order.status)) throw new AppError("This order can no longer be cancelled", 409, "TRADE_ORDER_CANNOT_CANCEL");
  return db.tradeOrder.update({ where: { id }, data: { status: "cancelled", cancelledAt: new Date() }, include: detailInclude });
}

export async function tradeDocuments(shopId, id) {
  const order = await getTradeOrder(shopId, id);
  const totals = order.items.reduce((acc, row) => ({ quantity: acc.quantity + Number(row.quantity), subtotal: acc.subtotal + Number(row.lineTotal), gst: acc.gst + (order.orderType === "domestic" ? Number(row.lineTotal) * Number(row.gstRate) / 100 : 0) }), { quantity: 0, subtotal: 0, gst: 0 });
  return { order, packingList: { documentNumber: order.dispatch?.dispatchNumber || order.orderNumber, buyer: order.customerName, shipTo: order.shippingAddress, items: order.items.map((row) => ({ sku: row.sku, buyerProductCode: row.buyerProductCode, description: row.description, quantity: row.packedQuantity || row.quantity, batches: row.allocations.map((allocation) => allocation.batchNumber) })), packageCount: order.dispatch?.packageCount, netWeight: order.dispatch?.netWeight, grossWeight: order.dispatch?.grossWeight }, commercialInvoice: { invoiceReference: order.billId, orderNumber: order.orderNumber, buyerPoNumber: order.buyerPoNumber, currencyCode: order.currencyCode, exchangeRate: order.exchangeRate, incoterm: order.incoterm, destination: order.countryOfDestination, origin: order.countryOfOrigin, iec: order.iec, lutBondReference: order.lutBondReference, portOfLoading: order.portOfLoading, portOfDischarge: order.portOfDischarge, subtotal: round2(totals.subtotal), gst: round2(totals.gst), total: round2(totals.subtotal + totals.gst), paymentTerms: order.paymentTerms } };
}
