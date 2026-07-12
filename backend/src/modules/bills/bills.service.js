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
  // Estimates (kacha bills) are full sales in everything but their number series: they move
  // stock, record tender, track udhar, and count in sales/cash reports — only the separate
  // EST- numbering (and the GST report) keeps them apart from pakka bills. Older app versions
  // sent estimates with no payment data at all; those legacy quote-shaped ops are still
  // accepted (as unpaid, credit-free estimates) so pending offline queues can't get stuck.
  const billPayments = payments;
  const legacyCreditAmount = sumMoney(billPayments.filter((p) => p.mode === "credit").map((p) => p.amount));
  const requestedCreditAmount = inputCreditAmount !== undefined
    ? round2(inputCreditAmount)
    : legacyCreditAmount;
  const legacyQuoteEstimate = isEstimate && billPayments.length === 0 && requestedCreditAmount <= 0;

  if (!legacyQuoteEstimate && billPayments.filter((p) => p.mode !== "credit").length === 0 && requestedCreditAmount <= 0) {
    throw new AppError("At least one real payment or credit amount required", 400);
  }

  // Credit/udhar can arrive either as legacy payment mode "credit" or as the
  // modern separate creditAmount field from offline sync.
  const hasCredit = requestedCreditAmount > 0;
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
    const dbSellingUnits = productIds.length > 0
      ? await tx.productSellingUnit.findMany({ where: { shopId, productId: { in: productIds }, isActive: true } })
      : [];
    const sellingUnitById = new Map(dbSellingUnits.map((unit) => [unit.id, unit]));
    const sellingUnitByCode = new Map(dbSellingUnits.map((unit) => [`${unit.productId}:${unit.unitCode}`, unit]));
    const defaultSellingUnitByProduct = new Map();
    for (const unit of dbSellingUnits) {
      const current = defaultSellingUnitByProduct.get(unit.productId);
      if (!current || unit.isDefault) defaultSellingUnitByProduct.set(unit.productId, unit);
    }

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

      const sellingUnit = product
        ? (item.sellingUnitId ? sellingUnitById.get(item.sellingUnitId) : null)
          ?? (item.sellingUnitCode ? sellingUnitByCode.get(`${product.id}:${item.sellingUnitCode}`) : null)
          ?? defaultSellingUnitByProduct.get(product.id)
          ?? null
        : null;
      if (sellingUnit && sellingUnit.productId !== product?.id) {
        throw new AppError("Selling unit does not belong to the selected product", 400);
      }
      if (product && (item.sellingUnitId || item.sellingUnitCode) && !sellingUnit) {
        throw new AppError(`Selling unit is unavailable for "${product.name}". Refresh product pricing and try again.`, 409);
      }

      // Determine units from product if productId given, else use what's passed
      const baseUnit = product?.baseUnit ?? item.enteredUnit;
      const rateUnit = sellingUnit?.name ?? product?.rateUnit ?? item.enteredUnit;
      const costPerRateUnit = sellingUnit?.costPrice ?? product?.costPerRateUnit ?? 0;

      // Convert entered qty to base qty
      const qtyInBase = sellingUnit
        ? round2(item.quantity * sellingUnit.conversionToBase)
        : product
          ? toBaseQty(item.quantity, item.enteredUnit, product.baseUnit)
        : item.quantity;

      // Overselling is allowed (allowStockShortfall) for the live counter and offline sync alike:
      // kirana stock counts drift, so a real sale must never be blocked for "0 stock" — the
      // frontend warns, the sale goes through, and stock is driven negative to show the exact
      // deficit for reconciliation (see decrementProductStockOrThrow). This hard rejection only
      // fires for internal callers that opt out of shortfall (allowStockShortfall === false).
      if (product && !allowStockShortfall) {
        if (product.stockBaseQty < qtyInBase) {
          throw new AppError(
            `Insufficient stock for "${product.name}". Available: ${product.stockBaseQty} ${product.baseUnit}, needed: ${qtyInBase}`,
            400
          );
        }
      }

      // Line totals must use quantity converted into the product's rate unit.
      // Example: rate ₹46/kg and quantity 500g => qtyInRateUnit 0.5 => lineTotal ₹23.
      const qtyInRateUnit = sellingUnit
        ? item.quantity
        : product
          ? baseQtyToRateQty(qtyInBase, product.rateUnit, product.baseUnit)
        : item.quantity;

      const maximumPrice = Number(sellingUnit?.maximumPrice ?? product?.mrp ?? 0);
      if (maximumPrice > 0 && item.ratePerRateUnit > maximumPrice + 0.005) {
        const error = new AppError(`Price for "${product?.name ?? item.name}" exceeds the configured maximum of Rs ${maximumPrice}`, 400);
        error.code = "PRICE_ABOVE_CONFIGURED_MAXIMUM";
        throw error;
      }
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
        sellingUnitId: sellingUnit?.id ?? null,
        sellingUnitCode: sellingUnit?.unitCode ?? item.sellingUnitCode ?? null,
        sellingUnitLabel: sellingUnit?.name ?? item.sellingUnitLabel ?? item.enteredUnit,
        conversionToBase: sellingUnit?.conversionToBase ?? item.conversionToBase ?? null,
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
        originalUnitPrice: item.originalUnitPrice ?? item.ratePerRateUnit,
        appliedPricingRuleId: item.appliedPricingRuleId ?? null,
        appliedPricingRuleType: item.appliedPricingRuleType ?? null,
        pricingExplanation: item.pricingExplanation ?? null,
        pricingConfidence: item.pricingConfidence ?? null,
        pricingCalculationVersion: item.pricingCalculationVersion ?? null,
        wasPriceOverridden: item.wasPriceOverridden === true,
        priceOverrideReason: item.priceOverrideReason ?? null,
        priceApprovedByUserId: item.wasPriceOverridden ? createdByUserId : null,
        ...moneyShadows({ ratePerRateUnit: item.ratePerRateUnit, costPerRateUnit, lineTotal, lineCost, lineProfit, originalUnitPrice: item.originalUnitPrice ?? item.ratePerRateUnit }),
      });

      if (product) {
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

    const waivedAmount = round2(inputWaivedAmount);

    // Guard: waivedAmount (let-go / write-off) must never exceed the bill total.
    // Allowing waivedAmount > grandTotal would produce negative grossProfit and
    // corrupt P&L reports. Zod already enforces min(0); here we enforce max.
    if (waivedAmount > grandTotal) {
      const err = new AppError(
        `Waived amount (₹${waivedAmount}) cannot exceed bill total (₹${grandTotal})`,
        400
      );
      err.code = "INVALID_WAIVED_AMOUNT";
      throw err;
    }

    const grossProfit = subtractMoney(itemProfit, billDiscount, waivedAmount);
    const paidAmount = sumMoney(billPayments.filter((p) => p.mode !== "credit").map((p) => p.amount));
    const creditAmount = requestedCreditAmount;
    const actualAmount = round2(inputActualAmount ?? grandTotal);
    const buyerPaidAmount = round2(inputBuyerPaidAmount ?? paidAmount);

    if (buyerPaidAmount > grandTotal) {
      throw new AppError(
        `Buyer paid amount (₹${buyerPaidAmount}) cannot exceed bill amount (₹${grandTotal})`,
        400
      );
    }

    const paymentCoverage = addMoney(paidAmount, creditAmount, waivedAmount);
    // legacyQuoteEstimate: old quote-era estimate ops carry no payment data; store them as
    // unpaid rather than rejecting the sync replay.
    if (!legacyQuoteEstimate && !moneyEquals(paymentCoverage, grandTotal)) {
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
    const billNo = await generateBillNo(shopId, tx, { billType });

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

      // Record the actual stock removed so the ledger stays internally consistent
      // (old + change == new), including negative after-stock.
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
          clientLedgerId: actor?.creditLedgerClientId ?? buildChildIdempotencyKey(billIdentity.clientBillId, "udhar:debit"),
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
    // Estimates post too — they are full sales, just under their own number series.
    await postBillCreatedLedger(tx, {
      shopId,
      bill,
      tenderPayments: Array.isArray(bill.payments) ? bill.payments : [],
      creditAmount,
      customerId: customerId ?? null,
    });

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
export async function cancelBill(shopId, billId, { reason, idempotentRaceOk = false }) {
  const bill = await db.bill.findFirst({
    where: { id: billId, shopId },
    include: { items: true, payments: true },
  });

  if (!bill) throw new AppError("Bill not found", 404);
  // Idempotent: a bill can be cancelled then "deleted" (both map to this op), or the same
  // cancel can be replayed by sync. Already-cancelled => return as-is WITHOUT re-reversing
  // stock/udhar (the reversal already happened), instead of throwing a permanent CONFLICT.
  if (bill.status === "cancelled") return bill;

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
      // Lost the race to a concurrent cancel (status changed active->cancelled between our
      // read and this claim). Direct API callers should see a 409; sync replay can opt into
      // idempotent convergence so a lost ack does not stick as a permanent conflict.
      const current = await tx.bill.findFirst({ where: { id: billId, shopId }, include: { items: true, payments: true } });
      if (idempotentRaceOk && current && current.status === "cancelled") return current;
      const err = new AppError("Bill is already cancelled or not active", 409);
      err.code = "BILL_NOT_CANCELLABLE";
      throw err;
    }

    // ── 1. Restore stock for every item ───────────────────────
    // Only bills that actually deducted stock (they have "sale" stock-ledger rows) restore it.
    // Guards legacy quote-era estimates, which never moved stock at creation.
    const saleLedgerRows = await tx.stockLedger.count({
      where: { shopId, billId: bill.id, action: "sale" },
    });
    for (const item of saleLedgerRows > 0 ? bill.items : []) {
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
    // net out. Bills that never posted at creation (legacy quote-era estimates) reverse
    // nothing — reversing an unposted bill would push the ledger negative.
    const creationLedgerRows = await tx.financialLedger.count({
      where: { shopId, billId: bill.id },
    });
    if (creationLedgerRows > 0) {
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
// SALE RETURN — a partial or full return of a sale.
// Modeled as a Bill with billType "sales_return" and NEGATIVE amounts, so every
// report that already sums bills (sales, profit, cash) reverses automatically with
// no report changes. Resellable items are restocked; damaged ones are written off
// as a damage loss. Refund goes out in the chosen mode (cash/upi) or reduces the
// customer's udhar. Reuses the reversal primitives proven in cancelBill; runs in one
// transaction; idempotent on the same bill identity as CREATE_BILL.
// ─────────────────────────────────────────────────────────────
export async function createSaleReturn(shopId, body, actor = {}) {
  const {
    items = [],
    refundMode = "cash",
    gstMode = "inclusive",
    customerId,
    customerName,
    returnOfBillId,
    reason,
  } = body;

  const normalizedRefundMode = ["cash", "upi", "bank", "udhar"].includes(String(refundMode)) ? String(refundMode) : "cash";
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError("A return needs at least one item", 400);
  }
  // "Cash-like" = an immediate tender refund (money goes back out now) vs. reducing udhar.
  const isCashLike = normalizedRefundMode === "cash" || normalizedRefundMode === "upi" || normalizedRefundMode === "bank";
  if (normalizedRefundMode === "udhar" && !customerId) {
    throw new AppError("Customer is required to refund a return to udhar", 400);
  }

  const billIdentity = normalizeBillIdentity(shopId, body, actor);

  let bill;
  try {
    bill = await db.$transaction(async (tx) => {
      const existing = await findExistingBillByIdentity(tx, shopId, billIdentity);
      if (existing) return existing;

      // Optional link to the original sale (bill-linked returns).
      const original = returnOfBillId
        ? await tx.bill.findFirst({ where: { id: returnOfBillId, shopId } })
        : null;

      // A return against an estimate must not post GST: the original kacha bill never entered
      // the GST report, so its reversal can't either — otherwise the report would show negative
      // tax with no positive side. Sales/stock/refund effects still apply in full.
      const effectiveGstMode = original?.billType === "estimate" ? "none" : gstMode;

      const productIds = items.filter((i) => i.productId).map((i) => i.productId);
      const dbProducts = await tx.product.findMany({ where: { id: { in: productIds }, shopId } });
      const productMap = Object.fromEntries(dbProducts.map((p) => [p.id, p]));

      let subtotal = 0;
      let totalGst = 0;
      let itemProfit = 0;
      const billItems = [];
      const restockPlan = []; // { product, qtyInBase, lineCost, damaged }

      for (const item of items) {
        const product = item.productId ? productMap[item.productId] : null;
        if (item.productId && !product) throw new AppError(`Product not found: ${item.productId}`, 404);

        // A return item may arrive without enteredUnit (older clients / quick returns). Fall back
        // to the product's units instead of letting toBaseQty throw "enteredUnit is required",
        // which previously left sale-return sync stuck failing forever.
        const enteredUnit = item.enteredUnit || product?.rateUnit || product?.baseUnit || "piece";
        const baseUnit = product?.baseUnit ?? enteredUnit;
        const rateUnit = product?.rateUnit ?? enteredUnit;
        const costPerRateUnit = product?.costPerRateUnit ?? 0;
        const qtyInBase = product ? toBaseQty(item.quantity, enteredUnit, product.baseUnit) : item.quantity;
        const qtyInRateUnit = product ? baseQtyToRateQty(qtyInBase, rateUnit, baseUnit) : item.quantity;

        const lineTotal = multiplyMoney(item.ratePerRateUnit, qtyInRateUnit);
        const rate = Number(item.gstRate ?? product?.gstRate ?? 0);
        const gstAmount = effectiveGstMode === "exclusive"
          ? multiplyMoney(lineTotal, rate / 100)
          : effectiveGstMode === "none" || rate <= 0
            ? 0
            : subtractMoney(lineTotal, round2(lineTotal / (1 + rate / 100)));
        const lineCost = multiplyMoney(costPerRateUnit, qtyInRateUnit);
        const lineProfit = subtractMoney(lineTotal, lineCost);
        const damaged = item.damaged === true;

        subtotal = addMoney(subtotal, lineTotal);
        totalGst = addMoney(totalGst, gstAmount);
        itemProfit = addMoney(itemProfit, lineProfit);

        // Stored NEGATIVE on the return bill so reports net the original sale down.
        billItems.push({
          productId: item.productId ?? null,
          name: product?.name ?? item.name ?? "Item",
          quantity: -Math.abs(item.quantity),
          enteredUnit,
          baseUnit,
          quantityInBaseUnit: -Math.abs(qtyInBase),
          rateUnit,
          ratePerRateUnit: item.ratePerRateUnit,
          costPerRateUnit,
          gstRate: rate,
          lineTotal: -lineTotal,
          lineCost: -lineCost,
          lineProfit: -lineProfit,
          ...moneyShadows({ ratePerRateUnit: item.ratePerRateUnit, costPerRateUnit, lineTotal: -lineTotal, lineCost: -lineCost, lineProfit: -lineProfit }),
        });

        if (product) restockPlan.push({ product, qtyInBase: round2(qtyInBase), lineCost, damaged });
      }

      const grandTotalMagnitude = effectiveGstMode === "exclusive" ? addMoney(subtotal, totalGst) : subtotal;
      const refundAmount = round2(grandTotalMagnitude);
      const resolvedCustomerId = customerId ?? original?.customerId ?? null;

      const billNo = await generateBillNo(shopId, tx);
      const paymentRows = isCashLike
        ? [{
            shopId,
            mode: normalizedRefundMode,
            amount: -refundAmount,
            idempotencyKey: buildChildIdempotencyKey(billIdentity.idempotencyKey, `refund:${normalizedRefundMode}`),
            sourceDeviceId: billIdentity.sourceDeviceId,
            ...moneyShadows({ amount: -refundAmount }),
          }]
        : [];

      const negativeMoney = {
        subtotal: -subtotal,
        discount: 0,
        gst: -totalGst,
        grandTotal: -grandTotalMagnitude,
        actualAmount: -grandTotalMagnitude,
        buyerPaidAmount: isCashLike ? -refundAmount : 0,
        waivedAmount: 0,
        grossProfit: -itemProfit,
        paidAmount: isCashLike ? -refundAmount : 0,
        creditAmount: normalizedRefundMode === "udhar" ? -refundAmount : 0,
      };

      const returnBill = await tx.bill.create({
        data: {
          shopId,
          billNo,
          billType: "sales_return",
          status: "active",
          customerId: resolvedCustomerId,
          customerName: customerName ?? original?.customerName ?? "Walk-in",
          gstMode: effectiveGstMode,
          ...negativeMoney,
          ...moneyShadows(negativeMoney),
          createdByUserId: actor?.userId ?? null,
          deviceId: actor?.deviceId ?? null,
          clientBillId: billIdentity.clientBillId,
          idempotencyKey: billIdentity.idempotencyKey,
          sourceDeviceId: billIdentity.sourceDeviceId,
          returnOfBillId: returnOfBillId ?? null,
          items: { create: billItems },
          payments: { create: paymentRows },
        },
        include: { items: true, payments: true },
      });

      // Restock resellable items; write off damaged ones (no restock, records the cost loss).
      for (const { product, qtyInBase, lineCost, damaged } of restockPlan) {
        if (damaged) {
          await tx.stockLedger.create({
            data: {
              shopId,
              productId: product.id,
              productName: product.name,
              action: "damage",
              changeBaseQty: 0,
              oldStockBaseQty: product.stockBaseQty,
              newStockBaseQty: product.stockBaseQty,
              damageLossValue: lineCost,
              billId: returnBill.id,
              clientMovementId: buildChildIdempotencyKey(billIdentity.clientBillId, `damage:${product.id}`),
              idempotencyKey: buildChildIdempotencyKey(billIdentity.idempotencyKey, `damage:${product.id}`),
              sourceDeviceId: billIdentity.sourceDeviceId,
              sourceType: "bill",
              sourceId: returnBill.id,
              note: `Damaged sale return: ${reason ?? returnBill.billNo}`,
            },
          });
          continue;
        }
        const updated = await tx.product.updateMany({
          where: { id: product.id, shopId },
          data: { stockBaseQty: { increment: qtyInBase } },
        });
        if (updated.count !== 1) continue;
        const fresh = await tx.product.findFirst({ where: { id: product.id, shopId } });
        const newStock = fresh?.stockBaseQty ?? round2(product.stockBaseQty + qtyInBase);
        await tx.stockLedger.create({
          data: {
            shopId,
            productId: product.id,
            productName: product.name,
            action: "return",
            changeBaseQty: qtyInBase,
            oldStockBaseQty: round2(newStock - qtyInBase),
            newStockBaseQty: newStock,
            billId: returnBill.id,
            clientMovementId: buildChildIdempotencyKey(billIdentity.clientBillId, `return:${product.id}`),
            idempotencyKey: buildChildIdempotencyKey(billIdentity.idempotencyKey, `return:${product.id}`),
            sourceDeviceId: billIdentity.sourceDeviceId,
            sourceType: "bill",
            sourceId: returnBill.id,
            note: `Sale return: ${reason ?? returnBill.billNo}`,
          },
        });
      }

      // Refund to udhar: reduce the customer's outstanding balance (mirrors cancelBill).
      if (normalizedRefundMode === "udhar" && resolvedCustomerId) {
        const customer = await tx.customer.findFirst({ where: { id: resolvedCustomerId, shopId, deletedAt: null } });
        if (!customer) throw new AppError("Customer not found", 404);
        await tx.udharLedger.create({
          data: {
            shopId,
            customerId: resolvedCustomerId,
            customerName: customer.name,
            type: "payment",
            amount: refundAmount,
            ...moneyShadows({ amount: refundAmount }),
            mode: "return",
            billId: returnBill.id,
            billNo: returnBill.billNo,
            clientLedgerId: buildChildIdempotencyKey(billIdentity.clientBillId, "udhar:return"),
            idempotencyKey: buildChildIdempotencyKey(billIdentity.idempotencyKey, "udhar:return"),
            sourceDeviceId: billIdentity.sourceDeviceId,
            sourceType: "bill",
            sourceId: returnBill.id,
            note: `Sale return refunded to udhar: ${returnBill.billNo}`,
          },
        });
        await syncCustomerUdharBalance(tx, shopId, resolvedCustomerId, {
          repairNegative: true,
          repairNote: `System repair after sale return ${returnBill.billNo}: udhar balance went negative`,
        });
      }

      // NOTE: FinancialLedger is intentionally not posted for returns. It is append-only
      // and not read by any report/dashboard — all user-facing KPIs derive from
      // bill / udharLedger / stockLedger, which this return already reverses. Revisit
      // if the FinancialLedger is ever wired into reporting.

      return returnBill;
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

  return bill;
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

    // Re-deduct only stock the cancellation actually restored ("cancel_reversal" rows exist);
    // legacy quote-era estimates never moved stock in either direction.
    const cancelReversalRows = await tx.stockLedger.count({
      where: { shopId, billId: bill.id, action: "cancel_reversal" },
    });
    for (const item of cancelReversalRows > 0 ? bill.items : []) {
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

    // FinancialLedger: re-apply the bill's money effect, dated to the restore. Bills that
    // never posted at creation (legacy quote-era estimates) have no rows to re-apply.
    const ledgerRows = await tx.financialLedger.count({
      where: { shopId, billId: bill.id },
    });
    if (ledgerRows > 0) {
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
    // Offline/current-counter sale already happened: record the real negative
    // balance so the shopkeeper can reconcile it with the next stock-in.
    const fresh = await tx.product.findFirst({
      where: { id: product.id, shopId },
      select: { stockBaseQty: true },
    });
    const available = round2(fresh?.stockBaseQty ?? product.stockBaseQty ?? 0);
    const newStock = round2(available - qtyInBase);
    const shortfallBaseQty = round2(Math.max(0, -newStock));
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
