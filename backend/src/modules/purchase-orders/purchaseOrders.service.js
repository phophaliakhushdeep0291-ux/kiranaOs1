import crypto from "crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { moneyShadows, multiplyMoney, round2, weightedAvgCost } from "../../utils/money.js";
import { rateUnitToBase } from "../../utils/units.js";
import { getLocationQuantity, incrementLocationInventory, resolveOperationalLocation } from "../stores/location-context.service.js";
import { recordReceiptLot } from "../inventory-lots/inventoryLots.service.js";
import {
  calculateReorderRecommendation,
  REORDER_SALES_WINDOW_DAYS,
} from "./reorderRecommendation.js";
import {
  calculateReceiptReconciliation,
  summarizePurchaseOrderReconciliation,
} from "./procurementReconciliation.js";

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
  items: { orderBy: { productName: "asc" }, include: { product: { select: { batchTrackingEnabled: true } } } },
  receipts: { orderBy: { createdAt: "desc" }, include: { items: true } },
};
const receiptReplayInclude = {
  items: { include: { inventoryLots: true } },
  purchaseOrder: { include: detailInclude },
};

function replayMismatch(existing, purchaseOrderId, data) {
  if (existing.purchaseOrderId !== purchaseOrderId) return true;
  // Invoice evidence is deliberately mutable after a GRN because goods often
  // arrive before the supplier invoice. Receive idempotency therefore compares
  // only stock/payment-affecting inputs; later reconciliation must not turn a
  // safe retry of the original receipt into an idempotency conflict.
  const expectedPaid = round2(data.paidAmount ?? existing.totalAmount);
  if (round2(existing.paidAmount) !== expectedPaid) return true;
  if ((existing.paymentMode || null) !== (expectedPaid > 0 ? data.paymentMode || null : null)) return true;
  if (existing.items.length !== data.items.length) return true;
  const stored = new Map(existing.items.map((item) => [item.purchaseOrderItemId, item]));
  return data.items.some((input) => {
    const item = stored.get(input.purchaseOrderItemId);
    if (!item || round2(item.quantityBaseQty) !== round2(input.quantityBaseQty) || round2(item.actualRate) !== round2(input.actualRate)) return true;
    const lot = item.inventoryLots[0];
    if ((input.batchNumber || null) !== (lot?.batchNumber || null)) return true;
    if ((input.manufacturedOn || null) !== (lot?.manufacturedOn?.toISOString().slice(0, 10) || null)) return true;
    return (input.expiresOn || null) !== (lot?.expiresOn?.toISOString().slice(0, 10) || null);
  });
}

function assertCompatibleReplay(existing, purchaseOrderId, data) {
  if (replayMismatch(existing, purchaseOrderId, data)) {
    throw new AppError("Idempotency key was already used for a different purchase receipt", 409, "IDEMPOTENCY_KEY_REUSED");
  }
  return { receipt: existing, purchaseOrder: withReconciliation(existing.purchaseOrder), idempotentReplay: true };
}

function withReconciliation(order) {
  return order ? { ...order, reconciliation: summarizePurchaseOrderReconciliation(order) } : order;
}

export async function listPurchaseOrders(shopId, { status = "all", locationId, limit = 50 } = {}) {
  const orders = await db.purchaseOrder.findMany({
    where: { shopId, ...(locationId && { locationId }), ...(status !== "all" && { status }) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 50, 1), 100),
    include: detailInclude,
  });
  return orders.map(withReconciliation);
}

export async function getPurchaseOrder(shopId, id, client = db) {
  const order = await client.purchaseOrder.findFirst({ where: { id, shopId }, include: detailInclude });
  if (!order) throw new AppError("Purchase order not found", 404, "PURCHASE_ORDER_NOT_FOUND");
  return withReconciliation(order);
}

export async function getReorderSuggestions(shopId, requestedLocationId = null) {
  const location = await resolveOperationalLocation(shopId, requestedLocationId);
  const products = await db.product.findMany({ where: { shopId, deletedAt: null }, orderBy: { name: "asc" } });
  if (products.length === 0) return [];
  const productIds = products.map((product) => product.id);
  const salesWindowStart = new Date(Date.now() - (REORDER_SALES_WINDOW_DAYS * 24 * 60 * 60 * 1000));
  const [history, locationStocks, salesRows, openOrderRows] = await Promise.all([
    db.purchaseHistory.findMany({
      where: { shopId, productId: { in: productIds } },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(productIds.length * 5, 1000), 5000),
    }),
    db.locationStock.findMany({
      where: { shopId, productId: { in: productIds } },
      select: { locationId: true, productId: true, stockBaseQty: true },
    }),
    db.billItem.groupBy({
      by: ["productId"],
      where: {
        productId: { in: productIds },
        bill: {
          shopId,
          locationId: location.id,
          status: "active",
          billType: { in: ["normal_sale", "gst_invoice", "udhar_entry", "sales_return"] },
          createdAt: { gte: salesWindowStart },
        },
      },
      _sum: { quantityInBaseUnit: true },
      _count: { _all: true },
    }),
    db.purchaseOrderItem.groupBy({
      by: ["productId"],
      where: {
        productId: { in: productIds },
        purchaseOrder: {
          shopId,
          locationId: location.id,
          status: { in: ["draft", "sent", "partially_received"] },
        },
      },
      _sum: { orderedBaseQty: true, receivedBaseQty: true },
    }),
  ]);
  const latestByProduct = new Map();
  for (const row of history) if (!latestByProduct.has(row.productId)) latestByProduct.set(row.productId, row);
  const salesByProduct = new Map(salesRows.map((row) => [row.productId, row]));
  const openOrdersByProduct = new Map(openOrderRows.map((row) => [
    row.productId,
    round2(Math.max(0, Number(row._sum.orderedBaseQty || 0) - Number(row._sum.receivedBaseQty || 0))),
  ]));
  const locationStockByProduct = new Map();
  const secondaryAllocatedByProduct = new Map();
  for (const row of locationStocks) {
    secondaryAllocatedByProduct.set(row.productId, round2((secondaryAllocatedByProduct.get(row.productId) || 0) + Number(row.stockBaseQty || 0)));
    if (row.locationId === location.id) locationStockByProduct.set(row.productId, round2(Number(row.stockBaseQty || 0)));
  }

  const rows = products.map((product) => {
    const stockBaseQty = location.isPrimary
      ? round2(Number(product.stockBaseQty || 0) - Number(secondaryAllocatedByProduct.get(product.id) || 0))
      : Number(locationStockByProduct.get(product.id) || 0);
    const threshold = Number(product.lowStockThreshold || 0);
    const latest = latestByProduct.get(product.id);
    const sales = salesByProduct.get(product.id);
    const recommendation = calculateReorderRecommendation({
      stockBaseQty,
      lowStockThreshold: threshold,
      manualReorderBaseQty: product.reorderLevel,
      openOrderBaseQty: openOrdersByProduct.get(product.id) || 0,
      netSalesBaseQty: sales?._sum.quantityInBaseUnit || 0,
      salesLineCount: sales?._count._all || 0,
      baseUnit: product.baseUnit,
    });
    if (!recommendation) return null;
    return {
      productId: product.id,
      productName: product.name,
      baseUnit: product.baseUnit,
      rateUnit: product.rateUnit,
      stockBaseQty,
      lowStockThreshold: threshold,
      ...recommendation,
      expectedRate: round2(latest?.pricePerRateUnit ?? product.costPerRateUnit ?? 0),
      supplierId: latest?.supplierId ?? null,
      supplierName: latest?.supplierName ?? null,
      locationId: location.id,
      locationName: location.name,
    };
  });
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
    const order = await tx.purchaseOrder.create({
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
    return withReconciliation(order);
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
    const existing = await db.purchaseReceipt.findFirst({ where: { shopId, idempotencyKey: data.idempotencyKey }, include: receiptReplayInclude });
    if (existing) return assertCompatibleReplay(existing, id, data);
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
        return {
          input,
          item,
          lineAmount: multiplyMoney(input.actualRate, input.quantityBaseQty / factor),
          expectedLineAmount: multiplyMoney(item.expectedRate, input.quantityBaseQty / factor),
        };
      });
      const totalAmount = round2(lines.reduce((sum, line) => sum + line.lineAmount, 0));
      const reconciliation = calculateReceiptReconciliation({
        expectedAmounts: lines.map((line) => line.expectedLineAmount),
        actualAmounts: lines.map((line) => line.lineAmount),
        supplierInvoiceNumber: data.supplierInvoiceNumber,
        supplierInvoiceAmount: data.supplierInvoiceAmount,
        varianceReason: data.varianceReason,
        approvedByUserId: userId,
      });
      if (reconciliation.approvalRequired) {
        const error = new AppError("Explain the supplier invoice or PO-rate variance before approving this receipt", 422, "PURCHASE_VARIANCE_REASON_REQUIRED");
        error.publicData = {
          expectedGoodsAmount: reconciliation.expectedGoodsAmount,
          goodsReceivedAmount: reconciliation.goodsReceivedAmount,
          supplierInvoiceAmount: reconciliation.supplierInvoiceAmount,
          priceVarianceAmount: reconciliation.priceVarianceAmount,
          invoiceVarianceAmount: reconciliation.invoiceVarianceAmount,
        };
        throw error;
      }
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
          supplierInvoiceAmount: reconciliation.supplierInvoiceAmount,
          expectedGoodsAmount: reconciliation.expectedGoodsAmount,
          priceVarianceAmount: reconciliation.priceVarianceAmount,
          invoiceVarianceAmount: reconciliation.invoiceVarianceAmount,
          ...moneyShadows({
            supplierInvoiceAmount: reconciliation.supplierInvoiceAmount,
            expectedGoodsAmount: reconciliation.expectedGoodsAmount,
            priceVarianceAmount: reconciliation.priceVarianceAmount,
            invoiceVarianceAmount: reconciliation.invoiceVarianceAmount,
          }),
          matchStatus: reconciliation.matchStatus,
          varianceReason: reconciliation.hasVariance && data.varianceReason ? data.varianceReason.trim() : null,
          varianceApprovedByUserId: reconciliation.hasVariance ? userId || null : null,
          varianceApprovedAt: reconciliation.hasVariance ? new Date() : null,
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
        const receiptItem = await tx.purchaseReceiptItem.create({
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
        await recordReceiptLot(tx, {
          shopId,
          locationId: order.locationId,
          product,
          receiptItemId: receiptItem.id,
          quantityBaseQty: input.quantityBaseQty,
          actualRate: input.actualRate,
          batchNumber: input.batchNumber,
          manufacturedOn: input.manufacturedOn,
          expiresOn: input.expiresOn,
          note: data.note,
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
      return { receipt: fullReceipt, purchaseOrder: withReconciliation(purchaseOrder), idempotentReplay: false, remainingLineCount: remaining };
    });
  } catch (error) {
    if (error?.code === "P2002" && data.idempotencyKey) {
      const existing = await db.purchaseReceipt.findFirst({ where: { shopId, idempotencyKey: data.idempotencyKey }, include: receiptReplayInclude });
      if (existing) return assertCompatibleReplay(existing, id, data);
    }
    throw error;
  }
}

export async function reconcilePurchaseReceipt(shopId, purchaseOrderId, receiptId, data, userId) {
  await db.$transaction(async (tx) => {
    const receipt = await tx.purchaseReceipt.findFirst({
      where: { id: receiptId, shopId, purchaseOrderId },
      include: { items: { include: { purchaseOrderItem: true } } },
    });
    if (!receipt) throw new AppError("Purchase receipt not found", 404, "PURCHASE_RECEIPT_NOT_FOUND");
    const expectedAmounts = receipt.items.map((item) => {
      const factor = rateUnitToBase(item.purchaseOrderItem.rateUnit, item.purchaseOrderItem.baseUnit);
      return multiplyMoney(item.purchaseOrderItem.expectedRate, item.quantityBaseQty / factor);
    });
    const reconciliation = calculateReceiptReconciliation({
      expectedAmounts,
      actualAmounts: receipt.items.map((item) => item.lineAmount),
      supplierInvoiceNumber: data.supplierInvoiceNumber,
      supplierInvoiceAmount: data.supplierInvoiceAmount,
      varianceReason: data.varianceReason,
      approvedByUserId: userId,
    });
    if (!reconciliation.invoiceEvidenceComplete) {
      throw new AppError("Supplier invoice number and total are both required to reconcile this receipt", 422, "PURCHASE_INVOICE_EVIDENCE_REQUIRED");
    }
    if (reconciliation.approvalRequired) {
      const error = new AppError("Explain the supplier invoice or PO-rate variance before approving this receipt", 422, "PURCHASE_VARIANCE_REASON_REQUIRED");
      error.publicData = {
        expectedGoodsAmount: reconciliation.expectedGoodsAmount,
        goodsReceivedAmount: reconciliation.goodsReceivedAmount,
        supplierInvoiceAmount: reconciliation.supplierInvoiceAmount,
        priceVarianceAmount: reconciliation.priceVarianceAmount,
        invoiceVarianceAmount: reconciliation.invoiceVarianceAmount,
      };
      throw error;
    }
    await tx.purchaseReceipt.update({
      where: { id: receipt.id },
      data: {
        supplierInvoiceNumber: data.supplierInvoiceNumber.trim(),
        supplierInvoiceAmount: reconciliation.supplierInvoiceAmount,
        expectedGoodsAmount: reconciliation.expectedGoodsAmount,
        priceVarianceAmount: reconciliation.priceVarianceAmount,
        invoiceVarianceAmount: reconciliation.invoiceVarianceAmount,
        ...moneyShadows({
          supplierInvoiceAmount: reconciliation.supplierInvoiceAmount,
          expectedGoodsAmount: reconciliation.expectedGoodsAmount,
          priceVarianceAmount: reconciliation.priceVarianceAmount,
          invoiceVarianceAmount: reconciliation.invoiceVarianceAmount,
        }),
        matchStatus: reconciliation.matchStatus,
        varianceReason: reconciliation.hasVariance ? data.varianceReason.trim() : null,
        varianceApprovedByUserId: reconciliation.hasVariance ? userId || null : null,
        varianceApprovedAt: reconciliation.hasVariance ? new Date() : null,
      },
    });
  });
  return getPurchaseOrder(shopId, purchaseOrderId);
}

export async function cancelPurchaseOrder(shopId, id, reason) {
  const order = await getPurchaseOrder(shopId, id);
  if (["received", "cancelled"].includes(order.status)) throw new AppError("A completed or cancelled purchase order cannot be cancelled", 409, "PURCHASE_ORDER_NOT_CANCELLABLE");
  await db.purchaseOrder.update({ where: { id: order.id }, data: { status: "cancelled", cancelledAt: new Date(), note: [order.note, `Cancelled: ${reason}`].filter(Boolean).join("\n") } });
  return getPurchaseOrder(shopId, id);
}
