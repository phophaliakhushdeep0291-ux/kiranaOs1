import crypto from "crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { moneyShadows, multiplyMoney, round2, weightedAvgCost } from "../../utils/money.js";
import { rateUnitToBase } from "../../utils/units.js";
import { getLocationQuantity, incrementLocationInventory, resolveOperationalLocation } from "../stores/location-context.service.js";

function reference(prefix) {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${day}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

const detailInclude = {
  location: true,
  supplier: true,
  items: { orderBy: { productName: "asc" } },
  receipts: { orderBy: { createdAt: "desc" }, include: { items: true } },
};

export async function listPurchaseOrders(shopId, { status = "all", locationId, limit = 50 } = {}) {
  return db.purchaseOrder.findMany({
    where: { shopId, ...(locationId && { locationId }), ...(status !== "all" && { status }) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 50, 1), 100),
    include: detailInclude,
  });
}

export async function getPurchaseOrder(shopId, id, client = db) {
  const order = await client.purchaseOrder.findFirst({ where: { id, shopId }, include: detailInclude });
  if (!order) throw new AppError("Purchase order not found", 404, "PURCHASE_ORDER_NOT_FOUND");
  return order;
}

export async function getReorderSuggestions(shopId, requestedLocationId = null) {
  const location = await resolveOperationalLocation(shopId, requestedLocationId);
  const [products, history] = await Promise.all([
    db.product.findMany({ where: { shopId, deletedAt: null }, orderBy: { name: "asc" } }),
    db.purchaseHistory.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 1000 }),
  ]);
  const latestByProduct = new Map();
  for (const row of history) if (!latestByProduct.has(row.productId)) latestByProduct.set(row.productId, row);
  const rows = await Promise.all(products.map(async (product) => {
    const stockBaseQty = await getLocationQuantity(db, shopId, location, product);
    const threshold = Number(product.lowStockThreshold || 0);
    if (threshold <= 0 || stockBaseQty > threshold) return null;
    const latest = latestByProduct.get(product.id);
    const recommendedOrderBaseQty = round2(Number(product.reorderLevel || 0) > 0
      ? Number(product.reorderLevel)
      : Math.max((threshold * 2) - stockBaseQty, 1));
    return {
      productId: product.id,
      productName: product.name,
      baseUnit: product.baseUnit,
      rateUnit: product.rateUnit,
      stockBaseQty,
      lowStockThreshold: threshold,
      recommendedOrderBaseQty,
      expectedRate: round2(latest?.pricePerRateUnit ?? product.costPerRateUnit ?? 0),
      supplierId: latest?.supplierId ?? null,
      supplierName: latest?.supplierName ?? null,
      locationId: location.id,
      locationName: location.name,
    };
  }));
  return rows.filter(Boolean);
}

export async function createPurchaseOrder(shopId, data, userId) {
  return db.$transaction(async (tx) => {
    const location = await resolveOperationalLocation(shopId, data.locationId, tx);
    const supplier = data.supplierId
      ? await tx.supplier.findFirst({ where: { id: data.supplierId, shopId, deletedAt: null } })
      : null;
    if (data.supplierId && !supplier) throw new AppError("Supplier not found", 404, "SUPPLIER_NOT_FOUND");
    const productIds = data.items.map((item) => item.productId);
    const products = await tx.product.findMany({ where: { shopId, id: { in: productIds }, deletedAt: null } });
    if (products.length !== productIds.length) throw new AppError("A purchase-order product was not found", 404, "PRODUCT_NOT_FOUND");
    const byId = new Map(products.map((product) => [product.id, product]));
    const items = data.items.map((item) => {
      const product = byId.get(item.productId);
      const factor = rateUnitToBase(product.rateUnit, product.baseUnit);
      const expectedAmount = multiplyMoney(item.expectedRate, item.orderedBaseQty / factor);
      return {
        productId: product.id,
        productName: product.name,
        baseUnit: product.baseUnit,
        rateUnit: product.rateUnit,
        orderedBaseQty: round2(item.orderedBaseQty),
        expectedRate: round2(item.expectedRate),
        expectedAmount,
        ...moneyShadows({ expectedRate: item.expectedRate, expectedAmount }),
      };
    });
    const expectedTotal = round2(items.reduce((sum, item) => sum + item.expectedAmount, 0));
    return tx.purchaseOrder.create({
      data: {
        shopId,
        locationId: location.id,
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? data.supplierName,
        orderNumber: reference("PO"),
        expectedOn: parseDate(data.expectedOn),
        expectedTotal,
        ...moneyShadows({ expectedTotal }),
        vendorReference: data.vendorReference || null,
        paymentTerms: data.paymentTerms || null,
        deliveryAddress: data.deliveryAddress || location.address || null,
        termsAndConditions: data.termsAndConditions || null,
        note: data.note || null,
        createdByUserId: userId || null,
        items: { create: items },
      },
      include: detailInclude,
    });
  });
}

export async function sendPurchaseOrder(shopId, id) {
  const changed = await db.purchaseOrder.updateMany({
    where: { id, shopId, status: "draft" },
    data: { status: "sent", sentAt: new Date() },
  });
  if (changed.count !== 1) {
    const order = await getPurchaseOrder(shopId, id);
    if (order.status === "sent") return order;
    throw new AppError("Only a draft purchase order can be sent", 409, "PURCHASE_ORDER_NOT_DRAFT");
  }
  return getPurchaseOrder(shopId, id);
}

function paymentAllocation(total, paid, lines) {
  let allocatedPaid = 0;
  return lines.map((line, index) => {
    const linePaid = index === lines.length - 1
      ? round2(paid - allocatedPaid)
      : round2(total > 0 ? paid * (line.lineAmount / total) : 0);
    allocatedPaid = round2(allocatedPaid + linePaid);
    return { ...line, linePaid, lineDue: round2(line.lineAmount - linePaid) };
  });
}

export async function receivePurchaseOrder(shopId, id, data, userId) {
  if (data.idempotencyKey) {
    const existing = await db.purchaseReceipt.findFirst({ where: { shopId, idempotencyKey: data.idempotencyKey }, include: { items: true, purchaseOrder: { include: detailInclude } } });
    if (existing) return { receipt: existing, purchaseOrder: existing.purchaseOrder, idempotentReplay: true };
  }
  try {
    return await db.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findFirst({
        where: { id, shopId },
        include: { location: true, items: { include: { product: true } } },
      });
      if (!order) throw new AppError("Purchase order not found", 404, "PURCHASE_ORDER_NOT_FOUND");
      if (!["sent", "partially_received"].includes(order.status)) throw new AppError("Only a sent purchase order can receive stock", 409, "PURCHASE_ORDER_NOT_RECEIVABLE");
      if (!order.location.active) throw new AppError("The purchase-order location is inactive", 409, "STORE_LOCATION_UNAVAILABLE");
      const byId = new Map(order.items.map((item) => [item.id, item]));
      const lines = data.items.map((input) => {
        const item = byId.get(input.purchaseOrderItemId);
        if (!item) throw new AppError("A receipt line is not part of this purchase order", 422, "PURCHASE_ORDER_ITEM_INVALID");
        const remaining = round2(item.orderedBaseQty - item.receivedBaseQty);
        if (input.quantityBaseQty > remaining + 0.001) {
          const error = new AppError(`${item.productName} has only ${remaining} ${item.baseUnit} remaining on the order`, 409, "PURCHASE_ORDER_OVER_RECEIPT");
          error.publicData = { purchaseOrderItemId: item.id, remainingBaseQty: remaining };
          throw error;
        }
        const factor = rateUnitToBase(item.rateUnit, item.baseUnit);
        return { input, item, lineAmount: multiplyMoney(input.actualRate, input.quantityBaseQty / factor) };
      });
      const totalAmount = round2(lines.reduce((sum, line) => sum + line.lineAmount, 0));
      const paidAmount = round2(data.paidAmount ?? totalAmount);
      if (paidAmount < 0 || paidAmount > totalAmount) throw new AppError("Paid amount cannot exceed the receipt total", 422, "PURCHASE_RECEIPT_PAYMENT_INVALID");
      const dueAmount = round2(totalAmount - paidAmount);
      if (paidAmount > 0 && !data.paymentMode) throw new AppError("Payment mode is required when an amount is paid", 422, "PURCHASE_RECEIPT_PAYMENT_MODE_REQUIRED");
      const allocated = paymentAllocation(totalAmount, paidAmount, lines);
      const receipt = await tx.purchaseReceipt.create({
        data: {
          shopId,
          locationId: order.locationId,
          purchaseOrderId: order.id,
          supplierId: order.supplierId,
          receiptNumber: reference("GRN"),
          supplierInvoiceNumber: data.supplierInvoiceNumber || null,
          idempotencyKey: data.idempotencyKey || null,
          totalAmount,
          paidAmount,
          dueAmount,
          ...moneyShadows({ totalAmount, paidAmount, dueAmount }),
          paymentMode: paidAmount > 0 ? data.paymentMode : null,
          dueDate: dueAmount > 0 ? parseDate(data.dueDate) : null,
          note: data.note || null,
          receivedByUserId: userId || null,
        },
      });

      for (const line of allocated) {
        const { item, input, lineAmount, linePaid, lineDue } = line;
        const product = item.product;
        const newCost = weightedAvgCost(product.stockBaseQty, product.costPerRateUnit, input.quantityBaseQty, input.actualRate);
        const stockResult = await incrementLocationInventory(tx, {
          shopId,
          location: order.location,
          product,
          quantityBase: input.quantityBaseQty,
          expectedGlobalStockBaseQty: product.stockBaseQty,
          productData: data.updateCost ? { costPerRateUnit: newCost, ...moneyShadows({ costPerRateUnit: newCost }) } : {},
        });
        const paymentStatus = lineDue <= 0 ? "paid" : linePaid > 0 ? "partial" : "due";
        const stockLedger = await tx.stockLedger.create({
          data: {
            shopId,
            locationId: order.locationId,
            productId: product.id,
            productName: product.name,
            action: "purchase",
            changeBaseQty: input.quantityBaseQty,
            oldStockBaseQty: stockResult.oldStock,
            newStockBaseQty: stockResult.newStock,
            purchaseBillAmount: lineAmount,
            calculatedBuyRate: input.actualRate,
            ...moneyShadows({ purchaseBillAmount: lineAmount, calculatedBuyRate: input.actualRate, purchasePaidAmount: linePaid, purchaseDueAmount: lineDue }),
            invoiceNumber: data.supplierInvoiceNumber || receipt.receiptNumber,
            purchasePaymentStatus: paymentStatus,
            purchasePaymentMode: linePaid > 0 ? data.paymentMode : null,
            purchasePaidAmount: linePaid,
            purchaseDueAmount: lineDue,
            purchaseDueDate: lineDue > 0 ? parseDate(data.dueDate) : null,
            supplierName: order.supplierName,
            note: data.note || `Received against ${order.orderNumber}`,
            sourceType: "purchase_order_receipt",
            sourceId: receipt.id,
          },
        });
        const history = await tx.purchaseHistory.create({
          data: {
            shopId,
            locationId: order.locationId,
            productId: product.id,
            supplierId: order.supplierId,
            purchaseOrderId: order.id,
            purchaseOrderItemId: item.id,
            purchaseReceiptId: receipt.id,
            supplierName: order.supplierName,
            qtyBase: input.quantityBaseQty,
            pricePerRateUnit: input.actualRate,
            totalCost: lineAmount,
            billAmount: lineAmount,
            invoiceNumber: data.supplierInvoiceNumber || receipt.receiptNumber,
            purchasePaymentStatus: paymentStatus,
            purchasePaymentMode: linePaid > 0 ? data.paymentMode : null,
            purchasePaidAmount: linePaid,
            purchaseDueAmount: lineDue,
            purchaseDueDate: lineDue > 0 ? parseDate(data.dueDate) : null,
            ...moneyShadows({ pricePerRateUnit: input.actualRate, totalCost: lineAmount, billAmount: lineAmount, purchasePaidAmount: linePaid, purchaseDueAmount: lineDue }),
            note: data.note || `Received against ${order.orderNumber}`,
          },
        });
        await tx.purchaseReceiptItem.create({
          data: {
            receiptId: receipt.id,
            purchaseOrderItemId: item.id,
            productId: product.id,
            quantityBaseQty: input.quantityBaseQty,
            actualRate: input.actualRate,
            lineAmount,
            ...moneyShadows({ actualRate: input.actualRate, lineAmount }),
            stockLedgerId: stockLedger.id,
            purchaseHistoryId: history.id,
          },
        });
        const updated = await tx.purchaseOrderItem.updateMany({
          where: { id: item.id, receivedBaseQty: item.receivedBaseQty },
          data: { receivedBaseQty: { increment: input.quantityBaseQty } },
        });
        if (updated.count !== 1) throw new AppError("Purchase order changed while receiving; retry", 409, "CONCURRENT_PURCHASE_ORDER_CHANGE");
      }

      const refreshed = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: order.id } });
      const completed = refreshed.every((item) => item.receivedBaseQty + 0.001 >= item.orderedBaseQty);
      const remaining = refreshed.filter((item) => item.receivedBaseQty + 0.001 < item.orderedBaseQty).length;
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status: completed ? "received" : "partially_received", ...(completed && { receivedAt: new Date() }) },
      });
      const fullReceipt = await tx.purchaseReceipt.findUnique({ where: { id: receipt.id }, include: { items: true } });
      const purchaseOrder = await tx.purchaseOrder.findUnique({ where: { id: order.id }, include: detailInclude });
      return { receipt: fullReceipt, purchaseOrder, idempotentReplay: false, remainingLineCount: remaining };
    });
  } catch (error) {
    if (error?.code === "P2002" && data.idempotencyKey) {
      const existing = await db.purchaseReceipt.findFirst({ where: { shopId, idempotencyKey: data.idempotencyKey }, include: { items: true, purchaseOrder: { include: detailInclude } } });
      if (existing) return { receipt: existing, purchaseOrder: existing.purchaseOrder, idempotentReplay: true };
    }
    throw error;
  }
}

export async function cancelPurchaseOrder(shopId, id, reason) {
  const order = await getPurchaseOrder(shopId, id);
  if (["received", "cancelled"].includes(order.status)) throw new AppError("A completed or cancelled purchase order cannot be cancelled", 409, "PURCHASE_ORDER_NOT_CANCELLABLE");
  await db.purchaseOrder.update({ where: { id: order.id }, data: { status: "cancelled", cancelledAt: new Date(), note: [order.note, `Cancelled: ${reason}`].filter(Boolean).join("\n") } });
  return getPurchaseOrder(shopId, id);
}
