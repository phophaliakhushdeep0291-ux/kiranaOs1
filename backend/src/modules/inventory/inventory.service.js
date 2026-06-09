import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { moneyShadows, multiplyMoney, round2, subtractMoney, weightedAvgCost } from "../../utils/money.js";
import { toBaseQty, rateUnitToBase } from "../../utils/units.js";

export async function getInventory(shopId) {
  const products = await db.product.findMany({
    where: { shopId, deletedAt: null },
    orderBy: { name: "asc" },
  });
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    stockBaseQty: p.stockBaseQty,
    baseUnit: p.baseUnit,
    displayUnit: p.displayUnit,
    costPerRateUnit: p.costPerRateUnit,
    defaultPricePerRateUnit: p.defaultPricePerRateUnit,
    lowStockThreshold: p.lowStockThreshold,
    isLowStock: p.lowStockThreshold > 0 && p.stockBaseQty <= p.lowStockThreshold,
  }));
}

export async function getLowStock(shopId) {
  const all = await getInventory(shopId);
  return all.filter((p) => p.isLowStock);
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizePaymentMode(mode, paidAmount) {
  if (paidAmount <= 0) return null;
  const normalized = String(mode || "cash").toLowerCase();
  return normalized === "bank" ? "upi" : normalized;
}

function parsePurchaseDueDate(value, dueAmount) {
  if (dueAmount <= 0 || !value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizePurchasePayment(data) {
  const invoiceNumber = firstText(data.invoiceNumber, data.purchaseBillNo, data.supplierBillNo);
  const explicitPaid = data.purchasePaidAmount;
  const explicitDue = data.purchaseDueAmount;
  const status = data.purchasePaymentStatus ||
    (explicitDue > 0 ? (explicitPaid > 0 ? "partial" : "due") : "paid");
  const purchasePaidAmount = round2(explicitPaid ?? (
    status === "due" ? 0 :
      explicitDue !== undefined ? Math.max(0, data.billAmount - explicitDue) :
        data.billAmount
  ));
  const purchaseDueAmount = round2(explicitDue ?? Math.max(0, data.billAmount - purchasePaidAmount));
  const purchasePaymentStatus = purchaseDueAmount <= 0 ? "paid" : purchasePaidAmount > 0 ? "partial" : "due";
  const purchasePaymentMode = normalizePaymentMode(data.purchasePaymentMode, purchasePaidAmount);
  const purchaseDueDate = parsePurchaseDueDate(data.purchaseDueDate, purchaseDueAmount);

  return {
    invoiceNumber,
    purchasePaymentStatus,
    purchasePaymentMode,
    purchasePaidAmount,
    purchaseDueAmount,
    purchaseDueDate,
  };
}

export async function recordPurchase(shopId, data) {
  const {
    productId, supplierId, supplierName,
    quantity, enteredUnit, billAmount,
    note, updateCost, updateMinPrice,
  } = data;

  return db.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: productId, shopId, deletedAt: null },
    });
    if (!product) throw new AppError("Product not found", 404);

    const qtyInBase = toBaseQty(quantity, enteredUnit, product.baseUnit);
    const factor = rateUnitToBase(product.rateUnit, product.baseUnit);
    const qtyInRateUnit = qtyInBase / factor;
    const pricePerRateUnit = round2(billAmount / qtyInRateUnit);
    const totalCost = multiplyMoney(pricePerRateUnit, qtyInRateUnit);
    const purchasePayment = normalizePurchasePayment(data);
    const purchasePaymentShadows = moneyShadows({
      purchasePaidAmount: purchasePayment.purchasePaidAmount,
      purchaseDueAmount: purchasePayment.purchaseDueAmount,
    });
    const newCost = weightedAvgCost(
      product.stockBaseQty, product.costPerRateUnit,
      qtyInBase, pricePerRateUnit
    );

    const oldStock = product.stockBaseQty;
    const newStock = round2(oldStock + qtyInBase);

    const updated = await tx.product.updateMany({
      where: { id: productId, shopId, deletedAt: null, stockBaseQty: oldStock },
      data: {
        stockBaseQty: { increment: qtyInBase },
        ...(updateCost && { costPerRateUnit: newCost, ...moneyShadows({ costPerRateUnit: newCost }) }),
        ...(updateMinPrice && { minPricePerRateUnit: pricePerRateUnit, ...moneyShadows({ minPricePerRateUnit: pricePerRateUnit }) }),
      },
    });
    if (updated.count !== 1) {
      const err = new AppError("Stock changed while recording purchase. Please retry.", 409);
      err.code = "CONCURRENT_STOCK_MODIFICATION_RETRY";
      throw err;
    }

    const stockLedger = await tx.stockLedger.create({
      data: {
        shopId, productId,
        productName: product.name,
        action: "purchase",
        changeBaseQty: qtyInBase,
        oldStockBaseQty: oldStock,
        newStockBaseQty: newStock,
        purchaseBillAmount: billAmount,
        calculatedBuyRate: pricePerRateUnit,
        ...purchasePayment,
        ...moneyShadows({ purchaseBillAmount: billAmount, calculatedBuyRate: pricePerRateUnit }),
        ...purchasePaymentShadows,
        supplierName,
        note: note ?? "",
      },
    });

    const purchaseHistory = await tx.purchaseHistory.create({
      data: {
        shopId, productId,
        supplierId: supplierId ?? null,
        supplierName,
        qtyBase: qtyInBase,
        pricePerRateUnit,
        totalCost,
        billAmount,
        ...purchasePayment,
        ...moneyShadows({ pricePerRateUnit, totalCost, billAmount }),
        ...purchasePaymentShadows,
        note: note ?? "",
      },
    });

    return {
      productId,
      qtyAdded: qtyInBase,
      newStock,
      newCost,
      pricePerRateUnit,
      stockLedgerId: stockLedger.id,
      purchaseHistoryId: purchaseHistory.id,
      invoiceNumber: purchasePayment.invoiceNumber,
      purchaseBillNo: purchasePayment.invoiceNumber,
      supplierBillNo: purchasePayment.invoiceNumber,
      purchasePaymentStatus: purchasePayment.purchasePaymentStatus,
      purchasePaymentMode: purchasePayment.purchasePaymentMode,
      purchasePaidAmount: purchasePayment.purchasePaidAmount,
      purchaseDueAmount: purchasePayment.purchaseDueAmount,
      purchaseDueDate: purchasePayment.purchaseDueDate?.toISOString?.().slice(0, 10) ?? null,
    };
  });
}

export async function recordDamage(shopId, { productId, quantity, enteredUnit, note }) {
  return db.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: productId, shopId, deletedAt: null },
    });
    if (!product) throw new AppError("Product not found", 404);

    const qtyInBase = toBaseQty(quantity, enteredUnit, product.baseUnit);
    const factor = rateUnitToBase(product.rateUnit, product.baseUnit);
    const qtyInRateUnit = qtyInBase / factor;
    const damageLossValue = multiplyMoney(product.costPerRateUnit, qtyInRateUnit);

    const updated = await tx.product.updateMany({
      where: { id: productId, shopId, deletedAt: null, stockBaseQty: { gte: qtyInBase } },
      data: { stockBaseQty: { decrement: qtyInBase } },
    });
    if (updated.count !== 1) {
      const err = new AppError("Damage quantity exceeds current stock", 409);
      err.code = "INSUFFICIENT_STOCK_CONCURRENT_MODIFICATION";
      throw err;
    }

    const freshProduct = await tx.product.findFirst({ where: { id: productId, shopId } });
    const newStock = round2(freshProduct?.stockBaseQty ?? product.stockBaseQty - qtyInBase);
    const oldStock = round2(newStock + qtyInBase);

    await tx.stockLedger.create({
      data: {
        shopId, productId,
        productName: product.name,
        action: "damage",
        changeBaseQty: -qtyInBase,
        oldStockBaseQty: oldStock,
        newStockBaseQty: newStock,
        damageLossValue,
        ...moneyShadows({ damageLossValue }),
        note: note ?? "Damage/loss",
      },
    });

    return {
      productId,
      productName: product.name,
      quantity,
      enteredUnit,
      qtyRemoved: qtyInBase,
      changeBaseQty: -qtyInBase,
      oldStock,
      newStock,
      oldStockBaseQty: oldStock,
      newStockBaseQty: newStock,
      damageLossValue,
      note: note ?? "Damage/loss",
    };
  });
}

export async function correctStock(shopId, { productId, newStockBaseQty, note }) {
  return db.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: productId, shopId, deletedAt: null },
    });
    if (!product) throw new AppError("Product not found", 404);

    const diff = subtractMoney(newStockBaseQty, product.stockBaseQty);

    const updated = await tx.product.updateMany({
      where: { id: productId, shopId, deletedAt: null, stockBaseQty: product.stockBaseQty },
      data: { stockBaseQty: newStockBaseQty },
    });
    if (updated.count !== 1) {
      const err = new AppError("Stock changed while applying correction. Please retry.", 409);
      err.code = "CONCURRENT_STOCK_MODIFICATION_RETRY";
      throw err;
    }

    await tx.stockLedger.create({
      data: {
        shopId, productId,
        productName: product.name,
        action: "correction",
        changeBaseQty: diff,
        oldStockBaseQty: product.stockBaseQty,
        newStockBaseQty,
        note: note ?? "Manual stock correction",
      },
    });

    return {
      productId,
      productName: product.name,
      oldStock: product.stockBaseQty,
      newStock: newStockBaseQty,
      oldStockBaseQty: product.stockBaseQty,
      newStockBaseQty,
      changeBaseQty: diff,
      diff,
      note: note ?? "Manual stock correction",
    };
  });
}

export async function getLedger(shopId, { productId, action, from, to, page, limit }) {
  const where = {
    shopId,
    ...(productId && { productId }),
    ...(action && { action }),
    ...(from && to && {
      createdAt: { gte: new Date(from), lte: new Date(to) },
    }),
  };

  const [entries, total] = await Promise.all([
    db.stockLedger.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.stockLedger.count({ where }),
  ]);

  return { entries, total, page, limit };
}
