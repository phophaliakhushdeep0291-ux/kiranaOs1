import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { addMoney, moneyEquals, moneyShadows, multiplyMoney, round2, subtractMoney, sumMoney } from "../../utils/money.js";
import { toBaseQty, baseQtyToRateQty } from "../../utils/units.js";
import { generateBillNo } from "../../utils/billNumber.js";
import { ensureLegacyUdharOpeningLedger, syncCustomerUdharBalance } from "../udhar/udharBalance.service.js";
import { postBillCancelledLedger, postBillCreatedLedger, postBillRestoredLedger } from "../finance/financial-ledger.service.js";

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
  const billIdentity = normalizeBillIdentity(shopId, body, actor);

  const isEstimate = billType === "estimate";
  // Phase 12: cashier attribution is taken only from authenticated server context,
  // never from frontend/offline payload attribution fields.
  const createdByUserId = actor?.userId ?? null;
  const deviceId = actor?.deviceId ?? null;
  // Offline-origin bills (replayed from a device's sync queue) represent sales that
  // already physically happened, so they must never be dropped for being stock-short.
  // The online counter path leaves this false and still rejects overselling live.
  const allowStockShortfall = actor?.allowStockShortfall === true;
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

  let bill;
  try {
    bill = await db.$transaction(async (tx) => {
    const existingBill = await findExistingBillByIdentity(tx, shopId, billIdentity);
    if (existingBill) return existingBill;

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
      // Offline-origin bills skip the rejection (the sale already happened) and instead
      // reconcile the shortfall at decrement time.
      if (product && !isEstimate && !allowStockShortfall) {
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
    // A discount can never exceed the subtotal it applies to. Without this guard the
    // bill total goes negative, and the only symptom is a confusing downstream
    // "payment total does not match grand total" error instead of a clear cause.
    if (billDiscount > subtotal) {
      const err = new AppError(
        `Discount (₹${billDiscount}) cannot exceed the bill subtotal (₹${subtotal})`,
        400
      );
      err.code = "DISCOUNT_EXCEEDS_SUBTOTAL";
      throw err;
    }

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
    if (!allowStockShortfall) {
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
    }

    const paymentRows = billPayments
      .filter((payment) => payment.mode !== "credit")
      .map((payment, index) => ({
        shopId,
        mode: payment.mode,
        amount: payment.amount,
        clientPaymentId: pickString(payment.clientPaymentId, payment.client_payment_id),
        idempotencyKey: buildChildIdempotencyKey(billIdentity.idempotencyKey, `payment:${index}:${payment.mode}`),
        sourceDeviceId: billIdentity.sourceDeviceId,
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
        clientBillId: billIdentity.clientBillId,
        idempotencyKey: billIdentity.idempotencyKey,
        sourceDeviceId: billIdentity.sourceDeviceId,
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
        allowShortfall: allowStockShortfall,
      });

      // Record the actual stock removed (= qtyInBase normally; less on a floored shortfall),
      // so the ledger entry stays internally consistent (old + change == new).
      const removedBaseQty = round2(stockResult.oldStock - stockResult.newStock);
      await tx.stockLedger.create({
        data: {
          shopId,
          productId: product.id,
          productName: product.name,
          action: "sale",
          changeBaseQty: -removedBaseQty,
          oldStockBaseQty: stockResult.oldStock,
          newStockBaseQty: stockResult.newStock,
          billId: bill.id,
          clientMovementId: buildChildIdempotencyKey(billIdentity.clientBillId, `stock:${product.id}`),
          idempotencyKey: buildChildIdempotencyKey(billIdentity.idempotencyKey, `stock:${product.id}`),
          sourceDeviceId: billIdentity.sourceDeviceId,
          sourceType: "bill",
          sourceId: bill.id,
          note: stockResult.shortfallBaseQty > 0
            ? `Offline sale recorded with ${stockResult.shortfallBaseQty} ${product.baseUnit} stock shortfall — reconcile inventory`
            : undefined,
        },
      });
    }

    // ── 6. Udhar: create ledger entry + update customer balance ─
    if (creditAmount > 0 && customerId) {
      const customer = await tx.customer.findFirst({ where: { id: customerId, shopId, deletedAt: null } });
      if (!customer) throw new AppError("Customer not found", 404);

      await ensureLegacyUdharOpeningLedger(tx, shopId, customerId);
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
          clientLedgerId: buildChildIdempotencyKey(billIdentity.clientBillId, "udhar:debit"),
          idempotencyKey: buildChildIdempotencyKey(billIdentity.idempotencyKey, "udhar:debit"),
          sourceDeviceId: billIdentity.sourceDeviceId,
          sourceType: "bill",
          sourceId: bill.id,
          note: `Bill ${bill.billNo}`,
        },
      });
      void udharLedgerEntry;

      await syncCustomerUdharBalance(tx, shopId, customerId, {
        repairNegative: true,
        repairNote: `System repair after bill ${bill.billNo}: previous udhar balance was negative`,
      });
    }

    // ── 7. FinancialLedger: append-only accounting source of truth ─
    // Posted inside the same transaction so the ledger can never disagree with the bill.
    // Estimates are quotes, so they record no money movement.
    if (!isEstimate) {
      await postBillCreatedLedger(tx, {
        shopId,
        bill,
        tenderPayments: Array.isArray(bill.payments) ? bill.payments : [],
        creditAmount,
        customerId: customerId ?? null,
      });
    }

    return bill;
  });
  } catch (error) {
    if (isUniqueConstraintError(error) && hasBillIdentity(billIdentity)) {
      const existingBill = await findExistingBillByIdentity(db, shopId, billIdentity);
      if (!existingBill) throw error;
      bill = existingBill;
    } else {
      throw error;
    }
  }

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
    // Atomic claim: only one concurrent request can transition active -> cancelled, so two
    // simultaneous cancels can't both restore stock / reverse udhar. The conditional update
    // locks the row until commit; a read-then-act status check (the outer guard above) does not.
    const cancelledAt = new Date();
    const claimed = await tx.bill.updateMany({
      where: { id: billId, shopId, status: "active" },
      data: { status: "cancelled", cancelledAt, cancelledReason: reason },
    });
    if (claimed.count !== 1) {
      const err = new AppError("Bill is already cancelled or not active", 409);
      err.code = "BILL_NOT_CANCELLABLE";
      throw err;
    }

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

        await syncCustomerUdharBalance(tx, shopId, bill.customerId, {
          repairNegative: true,
          repairNote: `System repair after cancelling bill ${bill.billNo}: udhar balance went negative`,
        });
      }
    }

    // ── 3. FinancialLedger: reverse the bill's money effect ───
    // Same entryTypes, negated amounts, dated to the cancellation, so dashboard KPIs
    // net out. Estimates posted nothing on creation, so they reverse nothing.
    if (bill.billType !== "estimate") {
      await postBillCancelledLedger(tx, {
        shopId,
        bill,
        tenderPayments: Array.isArray(bill.payments) ? bill.payments : [],
        creditAmount: Number(bill.creditAmount ?? 0),
        customerId: bill.customerId ?? null,
        reversalAt: cancelledAt,
      });
    }

    return tx.bill.findFirst({ where: { id: billId, shopId } });
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
    // Atomic claim: cancelled -> active, so only one concurrent restore wins (mirrors cancel).
    const restoredAt = new Date();
    const claimed = await tx.bill.updateMany({
      where: { id: billId, shopId, status: "cancelled" },
      data: { status: "active", cancelledAt: null, cancelledReason: null },
    });
    if (claimed.count !== 1) {
      const err = new AppError("Bill is already restored or not cancelled", 409);
      err.code = "BILL_NOT_RESTORABLE";
      throw err;
    }

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

        await syncCustomerUdharBalance(tx, shopId, bill.customerId, {
          repairNegative: true,
          repairNote: `System repair after restoring bill ${bill.billNo}: previous udhar balance was negative`,
        });
      }
    }

    // FinancialLedger: re-apply the bill's money effect, dated to the restore.
    if (!isEstimate) {
      await postBillRestoredLedger(tx, {
        shopId,
        bill,
        tenderPayments: Array.isArray(bill.payments) ? bill.payments : [],
        creditAmount: Number(bill.creditAmount ?? 0),
        customerId: bill.customerId ?? null,
        restoreAt: restoredAt,
      });
    }

    return tx.bill.findFirst({ where: { id: billId, shopId }, include: { items: true, payments: true } });
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

function normalizeBillIdentity(shopId, body, actor) {
  const sourceDeviceId = pickString(actor?.deviceId, body?.sourceDeviceId, body?.source_device_id);
  const clientBillId = pickString(
    body?.clientBillId,
    body?.client_bill_id,
    body?.localBillId,
    body?.local_bill_id,
    body?.localId,
    body?.local_id
  );
  const explicitKey = pickString(body?.idempotencyKey, body?.idempotency_key);
  const derivedKey = !explicitKey && sourceDeviceId && clientBillId
    ? `create-bill:${shopId}:${sourceDeviceId}:${clientBillId}`
    : null;

  return {
    clientBillId,
    idempotencyKey: explicitKey ?? derivedKey,
    sourceDeviceId,
  };
}

function hasBillIdentity(identity) {
  return Boolean(identity?.idempotencyKey || (identity?.sourceDeviceId && identity?.clientBillId));
}

async function findExistingBillByIdentity(client, shopId, identity) {
  if (!hasBillIdentity(identity)) return null;
  const include = { items: true, payments: true };
  if (identity.idempotencyKey) {
    const byKey = await client.bill.findFirst({
      where: { shopId, idempotencyKey: identity.idempotencyKey },
      include,
    });
    if (byKey) return byKey;
  }
  if (identity.sourceDeviceId && identity.clientBillId) {
    return client.bill.findFirst({
      where: {
        shopId,
        sourceDeviceId: identity.sourceDeviceId,
        clientBillId: identity.clientBillId,
      },
      include,
    });
  }
  return null;
}

function buildChildIdempotencyKey(parentKey, suffix) {
  if (!parentKey) return null;
  return `${parentKey}:${suffix}`;
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function isUniqueConstraintError(error) {
  return error?.code === "P2002";
}

async function decrementProductStockOrThrow(tx, { shopId, product, qtyInBase, statusCode = 409, code = "INSUFFICIENT_STOCK_CONCURRENT_MODIFICATION", message, allowShortfall = false }) {
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
    if (!allowShortfall) {
      const err = new AppError(message || `Insufficient stock for "${product.name}"`, statusCode);
      err.code = code;
      throw err;
    }
    // Offline-origin sale already happened: remove what stock is available and floor at
    // zero (never negative) so the sale is recorded, not dropped. The caller flags the
    // shortfall on the stock-ledger entry for the shopkeeper to reconcile.
    const fresh = await tx.product.findFirst({
      where: { id: product.id, shopId },
      select: { stockBaseQty: true },
    });
    const available = round2(Math.max(0, fresh?.stockBaseQty ?? 0));
    const newStock = round2(Math.max(0, available - qtyInBase));
    const shortfallBaseQty = round2(Math.max(0, qtyInBase - available));
    await tx.product.updateMany({ where: { id: product.id, shopId }, data: { stockBaseQty: newStock } });
    return { oldStock: available, newStock, shortfallBaseQty };
  }

  const freshProduct = await tx.product.findFirst({
    where: { id: product.id, shopId },
    select: { stockBaseQty: true },
  });
  const newStock = round2(freshProduct?.stockBaseQty ?? product.stockBaseQty - qtyInBase);
  const oldStock = round2(newStock + qtyInBase);
  return { oldStock, newStock, shortfallBaseQty: 0 };
}
