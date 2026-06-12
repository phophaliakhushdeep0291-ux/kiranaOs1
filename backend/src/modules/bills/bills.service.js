import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { addMoney, moneyEquals, moneyShadows, multiplyMoney, round2, subtractMoney, sumMoney, toPaiseBigInt } from "../../utils/money.js";
import { toBaseQty, baseQtyToRateQty } from "../../utils/units.js";
import { generateBillNo } from "../../utils/billNumber.js";

// ─────────────────────────────────────────────────────────────
// LIST BILLS
// ─────────────────────────────────────────────────────────────
export async function listBills(shopId, { from, to, status, customerId, page, limit }) {
  const where = {
    shopId,
    ...(status !== "all" && { status }),
    ...(customerId && { customerId }),
    ...(from && to && {
      createdAt: { gte: new Date(from), lte: new Date(to) },
    }),
  };

  const [bills, total] = await Promise.all([
    db.bill.findMany({
      where,
      include: { items: true, payments: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.bill.count({ where }),
  ]);

  return { bills, total, page, limit };
}

// ─────────────────────────────────────────────────────────────
// GET SINGLE BILL
// ─────────────────────────────────────────────────────────────
export async function getBill(shopId, id) {
  const bill = await db.bill.findFirst({
    where: { id, shopId },
    include: { items: true, payments: true, customer: true },
  });
  if (!bill) throw new AppError("Bill not found", 404);
  return bill;
}

// ─────────────────────────────────────────────────────────────
// CONFIRM BILL — the big one
// Everything runs in a single DB transaction.
// If anything fails, everything rolls back.
// ─────────────────────────────────────────────────────────────
export async function confirmBill(shopId, body, actor = {}) {
  const {
    billType,
    customerId,
    customerName,
    items,
    discount,
    gstMode = "inclusive",
    payments = [],
    creditAmount: inputCreditAmount,
    actualAmount: inputActualAmount,
    buyerPaidAmount: inputBuyerPaidAmount,
    waivedAmount: inputWaivedAmount = 0,
  } = body;

  const isEstimate = billType === "estimate";
  // Phase 12: cashier attribution is taken only from authenticated server context,
  // never from frontend/offline payload attribution fields.
  const createdByUserId = actor?.userId ?? null;
  const deviceId = actor?.deviceId ?? null;
  const billPayments = isEstimate ? [] : payments;
  const legacyCreditAmount = sumMoney(billPayments.filter((p) => p.mode === "credit").map((p) => p.amount));
  const requestedCreditAmount = inputCreditAmount !== undefined
    ? round2(inputCreditAmount)
    : legacyCreditAmount;

  if (!isEstimate && billPayments.filter((p) => p.mode !== "credit").length === 0 && requestedCreditAmount <= 0) {
    throw new AppError("At least one real payment or credit amount required", 400);
  }

  // Credit/udhar can arrive either as legacy payment mode "credit" or as the
  // modern separate creditAmount field from offline sync.
  const hasCredit = !isEstimate && requestedCreditAmount > 0;
  if (hasCredit && !customerId) {
    throw new AppError("Customer is required for credit/udhar bills", 400);
  }

  const bill = await db.$transaction(async (tx) => {
    // ── 1. Load and validate all products ─────────────────────
    const productIds = items.filter((i) => i.productId).map((i) => i.productId);
    const dbProducts = await tx.product.findMany({
      where: { id: { in: productIds }, shopId, deletedAt: null },
    });
    const productMap = Object.fromEntries(dbProducts.map((p) => [p.id, p]));

    // ── 2. Build bill items + validate stock ──────────────────
    let subtotal = 0;
    let totalGst = 0;
    let itemProfit = 0;
    const billItems = [];
    const stockUpdates = []; // collect stock changes to apply after

    for (const item of items) {
      const product = item.productId ? productMap[item.productId] : null;

      if (item.productId && !product) {
        throw new AppError(`Product not found: ${item.productId}`, 404);
      }

      // Determine units from product if productId given, else use what's passed
      const baseUnit = product?.baseUnit ?? item.enteredUnit;
      const rateUnit = product?.rateUnit ?? item.enteredUnit;
      const costPerRateUnit = product?.costPerRateUnit ?? 0;

      // Convert entered qty to base qty
      const qtyInBase = product
        ? toBaseQty(item.quantity, item.enteredUnit, product.baseUnit)
        : item.quantity;

      // Stock check only applies to real sale bills. Estimates are quotes, not stock movements.
      if (product && !isEstimate) {
        if (product.stockBaseQty < qtyInBase) {
          throw new AppError(
            `Insufficient stock for "${product.name}". Available: ${product.stockBaseQty} ${product.baseUnit}, needed: ${qtyInBase}`,
            400
          );
        }
      }

      // Line totals must use quantity converted into the product's rate unit.
      // Example: rate ₹46/kg and quantity 500g => qtyInRateUnit 0.5 => lineTotal ₹23.
      const qtyInRateUnit = product
        ? baseQtyToRateQty(qtyInBase, product.rateUnit, product.baseUnit)
        : item.quantity;
      const lineTotal = multiplyMoney(item.ratePerRateUnit, qtyInRateUnit);
      // GST: exclusive adds tax on top of the entered price; inclusive (kirana
      // MRP default) extracts the tax already inside it; none disables GST.
      const gstAmount = gstMode === "exclusive"
        ? multiplyMoney(lineTotal, item.gstRate / 100)
        : gstMode === "none" || item.gstRate <= 0
          ? 0
          : subtractMoney(lineTotal, round2(lineTotal / (1 + item.gstRate / 100)));

      const lineCost = multiplyMoney(costPerRateUnit, qtyInRateUnit);
      const lineProfit = subtractMoney(lineTotal, lineCost);

      subtotal = addMoney(subtotal, lineTotal);
      totalGst = addMoney(totalGst, gstAmount);
      itemProfit = addMoney(itemProfit, lineProfit);

      billItems.push({
        productId: item.productId ?? null,
        name: product?.name ?? item.name,
        quantity: item.quantity,
        enteredUnit: item.enteredUnit,
        baseUnit,
        quantityInBaseUnit: qtyInBase,
        rateUnit,
        ratePerRateUnit: item.ratePerRateUnit,
        costPerRateUnit,
        gstRate: item.gstRate,
        lineTotal,
        lineCost,
        lineProfit,
        ...moneyShadows({ ratePerRateUnit: item.ratePerRateUnit, costPerRateUnit, lineTotal, lineCost, lineProfit }),
      });

      if (product && !isEstimate) {
        stockUpdates.push({
          product,
          qtyInBase,
          lineProfit,
        });
      }
    }

    subtotal = round2(subtotal);
    totalGst = round2(totalGst);
    itemProfit = round2(itemProfit);
    const billDiscount = round2(discount);
    // Inclusive: tax already lives inside subtotal, so the payable is simply
    // subtotal − discount (matches what the counter UI shows and collects).
    // Exclusive: tax is added on top before the discount.
    const grandTotal = gstMode === "exclusive"
      ? addMoney(subtractMoney(subtotal, billDiscount), totalGst)
      : subtractMoney(subtotal, billDiscount);

    // Estimates are saved as quotes only. They should not create payments, udhar, or P&L profit.
    const waivedAmount = isEstimate ? 0 : round2(inputWaivedAmount);

    // Guard: waivedAmount (let-go / write-off) must never exceed the bill total.
    // Allowing waivedAmount > grandTotal would produce negative grossProfit and
    // corrupt P&L reports. Zod already enforces min(0); here we enforce max.
    if (!isEstimate && waivedAmount > grandTotal) {
      const err = new AppError(
        `Waived amount (₹${waivedAmount}) cannot exceed bill total (₹${grandTotal})`,
        400
      );
      err.code = "INVALID_WAIVED_AMOUNT";
      throw err;
    }

    const grossProfit = isEstimate ? 0 : subtractMoney(itemProfit, billDiscount, waivedAmount);
    const paidAmount = isEstimate
      ? 0
      : sumMoney(billPayments.filter((p) => p.mode !== "credit").map((p) => p.amount));
    const creditAmount = isEstimate
      ? 0
      : requestedCreditAmount;
    const actualAmount = round2(inputActualAmount ?? grandTotal);
    const buyerPaidAmount = isEstimate ? 0 : round2(inputBuyerPaidAmount ?? paidAmount);

    if (!isEstimate && buyerPaidAmount > grandTotal) {
      throw new AppError(
        `Buyer paid amount (₹${buyerPaidAmount}) cannot exceed bill amount (₹${grandTotal})`,
        400
      );
    }

    const paymentCoverage = addMoney(paidAmount, creditAmount, waivedAmount);
    if (!isEstimate && !moneyEquals(paymentCoverage, grandTotal)) {
      throw new AppError(
        `Payment total plus waived amount (₹${paymentCoverage}) does not match grand total (₹${grandTotal})`,
        400
      );
    }

    const stockUpdatesByProduct = aggregateStockUpdates(stockUpdates);
    for (const { product, qtyInBase } of stockUpdatesByProduct.values()) {
      if (product.stockBaseQty < qtyInBase) {
        const err = new AppError(
          `Insufficient stock for "${product.name}". Available: ${product.stockBaseQty} ${product.baseUnit}, needed: ${qtyInBase}`,
          400
        );
        err.code = "INSUFFICIENT_STOCK";
        throw err;
      }
    }

    const paymentRows = billPayments
      .filter((payment) => payment.mode !== "credit")
      .map((payment) => ({
        ...payment,
        ...moneyShadows({ amount: payment.amount }),
      }));

    // ── 3. Generate bill number ───────────────────────────────
    const billNo = await generateBillNo(shopId, tx);

    // ── 4. Create bill ────────────────────────────────────────
    const bill = await tx.bill.create({
      data: {
        shopId,
        billNo,
        billType,
        customerId: customerId ?? null,
        customerName,
        subtotal,
        discount: billDiscount,
        gst: totalGst,
        gstMode,
        grandTotal,
        actualAmount,
        buyerPaidAmount,
        waivedAmount,
        grossProfit,
        paidAmount,
        creditAmount,
        ...moneyShadows({ subtotal, discount: billDiscount, gst: totalGst, grandTotal, actualAmount, buyerPaidAmount, waivedAmount, grossProfit, paidAmount, creditAmount }),
        createdByUserId,
        deviceId,
        items: { create: billItems },
        payments: { create: paymentRows },
      },
      include: { items: true, payments: true },
    });

    // ── 5. Deduct stock + create stock ledger entries ─────────
    for (const { product, qtyInBase } of stockUpdatesByProduct.values()) {
      const stockResult = await decrementProductStockOrThrow(tx, {
        shopId,
        product,
        qtyInBase,
        statusCode: 409,
        code: "INSUFFICIENT_STOCK_CONCURRENT_MODIFICATION",
        message: `Insufficient stock for "${product.name}". Another bill may have used this stock first.`,
      });

      await tx.stockLedger.create({
        data: {
          shopId,
          productId: product.id,
          productName: product.name,
          action: "sale",
          changeBaseQty: -qtyInBase,
          oldStockBaseQty: stockResult.oldStock,
          newStockBaseQty: stockResult.newStock,
          billId: bill.id,
        },
      });
    }

    // ── 6. Udhar: create ledger entry + update customer balance ─
    if (creditAmount > 0 && customerId) {
      const customer = await tx.customer.findFirst({ where: { id: customerId, shopId, deletedAt: null } });
      if (!customer) throw new AppError("Customer not found", 404);

      const udharLedgerEntry = await tx.udharLedger.create({
        data: {
          shopId,
          customerId,
          customerName: customer.name,
          type: "debit",
          amount: creditAmount,
          ...moneyShadows({ amount: creditAmount }),
          mode: "credit",
          billId: bill.id,
          billNo: bill.billNo,
          note: `Bill ${bill.billNo}`,
        },
      });
      void udharLedgerEntry;

      await tx.customer.updateMany({
        where: { id: customerId, shopId, deletedAt: null },
        data: { udharAmount: { increment: creditAmount }, type: "udhar" },
      });
      await syncCustomerUdharPaise(tx, shopId, customerId);
    }

    return bill;
  });

  return {
    ...bill,
    payments: bill.payments.filter((payment) => payment.mode !== "credit"),
  };
}

// ─────────────────────────────────────────────────────────────
// CANCEL BILL — reverses everything
// ─────────────────────────────────────────────────────────────
export async function cancelBill(shopId, billId, { reason }) {
  const bill = await db.bill.findFirst({
    where: { id: billId, shopId },
    include: { items: true, payments: true },
  });

  if (!bill) throw new AppError("Bill not found", 404);
  if (bill.status === "cancelled") throw new AppError("Bill is already cancelled", 400);

  return db.$transaction(async (tx) => {
    // ── 1. Restore stock for every item ───────────────────────
    for (const item of bill.items) {
      if (!item.productId) continue;

      const updated = await tx.product.updateMany({
        where: { id: item.productId, shopId },
        data: { stockBaseQty: { increment: item.quantityInBaseUnit } },
      });
      if (updated.count !== 1) continue;

      const product = await tx.product.findFirst({ where: { id: item.productId, shopId } });
      if (!product) continue;

      const newStock = product.stockBaseQty;
      const oldStock = round2(newStock - item.quantityInBaseUnit);

      await tx.stockLedger.create({
        data: {
          shopId,
          productId: item.productId,
          productName: item.name,
          action: "cancel_reversal",
          changeBaseQty: item.quantityInBaseUnit,
          oldStockBaseQty: oldStock,
          newStockBaseQty: newStock,
          billId: bill.id,
          note: `Reversal: ${reason}`,
        },
      });
    }

    // ── 2. Reverse udhar if applicable ────────────────────────
    if (bill.creditAmount > 0 && bill.customerId) {
      const customer = await tx.customer.findFirst({ where: { id: bill.customerId, shopId, deletedAt: null } });
      if (customer) {
        await tx.udharLedger.create({
          data: {
            shopId,
            customerId: bill.customerId,
            customerName: customer.name,
            type: "payment",
            amount: bill.creditAmount,
            ...moneyShadows({ amount: bill.creditAmount }),
            mode: "reversal",
            billId: bill.id,
            billNo: bill.billNo,
            note: `Bill cancelled: ${reason}`,
          },
        });

        const decremented = await tx.customer.updateMany({
          where: { id: bill.customerId, shopId, udharAmount: { gte: bill.creditAmount } },
          data: { udharAmount: { decrement: bill.creditAmount } },
        });
        await syncCustomerUdharPaise(tx, shopId, bill.customerId);
        if (decremented.count !== 1) {
          await tx.customer.updateMany({
            where: { id: bill.customerId, shopId },
            data: { udharAmount: 0, udharAmountPaise: 0n },
          });
        }
      }
    }

    // ── 3. Mark bill as cancelled ─────────────────────────────
    return tx.bill.update({
      where: { id: billId },
      data: {
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledReason: reason,
      },
    });
  });
}


// ─────────────────────────────────────────────────────────────
// RESTORE CANCELLED BILL — reapplies sale effects safely
// Used by offline sync RESTORE_BILL events.
// ─────────────────────────────────────────────────────────────
export async function restoreCancelledBill(shopId, billId, { reason = "Offline bill restore sync" } = {}) {
  const bill = await db.bill.findFirst({
    where: { id: billId, shopId },
    include: { items: true, payments: true },
  });

  if (!bill) throw new AppError("Bill not found", 404);
  if (bill.status !== "cancelled") throw new AppError("Bill is already restored or not cancelled", 409);

  const isEstimate = bill.billType === "estimate";

  return db.$transaction(async (tx) => {
    if (!isEstimate) {
      // Re-deduct stock that was restored during cancellation.
      for (const item of bill.items) {
        if (!item.productId) continue;

        const product = await tx.product.findFirst({
          where: { id: item.productId, shopId, deletedAt: null },
        });
        if (!product) {
          throw new AppError(`Cannot restore bill because product is deleted or missing: ${item.name}`, 409);
        }

        const stockResult = await decrementProductStockOrThrow(tx, {
          shopId,
          product,
          qtyInBase: item.quantityInBaseUnit,
          statusCode: 409,
          code: "RESTORE_INSUFFICIENT_STOCK_CONCURRENT_MODIFICATION",
          message: `Insufficient stock to restore bill for "${item.name}". Available stock may have changed.`,
        });

        await tx.stockLedger.create({
          data: {
            shopId,
            productId: product.id,
            productName: item.name,
            action: "restore_reversal",
            changeBaseQty: -item.quantityInBaseUnit,
            oldStockBaseQty: stockResult.oldStock,
            newStockBaseQty: stockResult.newStock,
            billId: bill.id,
            note: `Restore cancelled bill: ${reason}`,
          },
        });
      }

      // Re-apply udhar if the cancelled bill had credit amount.
      if (bill.creditAmount > 0 && bill.customerId) {
        const customer = await tx.customer.findFirst({
          where: { id: bill.customerId, shopId, deletedAt: null },
        });
        if (!customer) {
          throw new AppError("Cannot restore credit bill because customer is deleted or missing", 409);
        }

        await tx.udharLedger.create({
          data: {
            shopId,
            customerId: bill.customerId,
            customerName: customer.name,
            type: "debit",
            amount: bill.creditAmount,
            ...moneyShadows({ amount: bill.creditAmount }),
            mode: "credit",
            billId: bill.id,
            billNo: bill.billNo,
            note: `Bill restored: ${reason}`,
          },
        });

        await tx.customer.updateMany({
          where: { id: bill.customerId, shopId, deletedAt: null },
          data: { udharAmount: { increment: bill.creditAmount }, type: "udhar" },
        });
        await syncCustomerUdharPaise(tx, shopId, bill.customerId);
      }
    }

    return tx.bill.update({
      where: { id: billId },
      data: {
        status: "active",
        cancelledAt: null,
        cancelledReason: null,
      },
      include: { items: true, payments: true },
    });
  });
}


function aggregateStockUpdates(stockUpdates) {
  const byProduct = new Map();
  for (const update of stockUpdates) {
    const existing = byProduct.get(update.product.id);
    if (existing) {
      existing.qtyInBase = round2(existing.qtyInBase + update.qtyInBase);
    } else {
      byProduct.set(update.product.id, { ...update });
    }
  }
  return byProduct;
}

async function decrementProductStockOrThrow(tx, { shopId, product, qtyInBase, statusCode = 409, code = "INSUFFICIENT_STOCK_CONCURRENT_MODIFICATION", message }) {
  const updated = await tx.product.updateMany({
    where: {
      id: product.id,
      shopId,
      deletedAt: null,
      stockBaseQty: { gte: qtyInBase },
    },
    data: { stockBaseQty: { decrement: qtyInBase } },
  });

  if (updated.count !== 1) {
    const err = new AppError(message || `Insufficient stock for "${product.name}"`, statusCode);
    err.code = code;
    throw err;
  }

  const freshProduct = await tx.product.findFirst({
    where: { id: product.id, shopId },
    select: { stockBaseQty: true },
  });
  const newStock = round2(freshProduct?.stockBaseQty ?? product.stockBaseQty - qtyInBase);
  const oldStock = round2(newStock + qtyInBase);
  return { oldStock, newStock };
}


async function syncCustomerUdharPaise(tx, shopId, customerId) {
  const fresh = await tx.customer.findFirst({
    where: { id: customerId, shopId },
    select: { id: true, udharAmount: true },
  });
  if (!fresh) return;
  await tx.customer.update({
    where: { id: fresh.id },
    data: { udharAmountPaise: toPaiseBigInt(fresh.udharAmount) },
  });
}
