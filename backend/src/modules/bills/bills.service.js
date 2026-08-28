import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { addMoney, moneyEquals, moneyShadows, multiplyMoney, round2, subtractMoney, sumMoney } from "../../utils/money.js";
import { toBaseQty, baseQtyToRateQty } from "../../utils/units.js";
import { generateBillNo } from "../../utils/billNumber.js";
import { rangeEndInclusive, rangeStart } from "../../utils/dateRange.js";
import { billSellerIdentity, locationSellerIdentity } from "../../utils/gstIdentity.js";
import { allocateAmountByWeights, allocateInvoiceDiscount, calculateInvoiceGst } from "../../utils/gst.js";
import { ensureLegacyUdharOpeningLedger, syncCustomerUdharBalance } from "../udhar/udharBalance.service.js";
import { postBillCancelledLedger, postBillCreatedLedger, postBillDeletedLedger, postBillRestoredLedger, postBillUndeletedLedger, postSaleReturnLedger } from "../finance/financial-ledger.service.js";
import {
  decrementLocationInventory,
  getLocationQuantity,
  incrementLocationInventory,
  resolveOperationalLocation,
} from "../stores/location-context.service.js";
import { sellingUnitCostPrice, sellingUnitMaxPrice } from "../products/selling-unit-pricing.js";
import { consumeRetailPaymentIntents, resolveRetailPaymentIntents } from "../payment-provider/retailPayment.service.js";
import { reapplyBillLoyaltyInTransaction, recordBillLoyaltyInTransaction, recordBillLoyaltyRedemption, reserveBillLoyaltyRedemption, reverseBillLoyaltyInTransaction } from "../loyalty/loyalty.service.js";
import { issueReturnCreditInTransaction, reapplyGiftCardRedemptions, recordGiftCardRedemptions, reserveGiftCardPayments, reverseGiftCardRedemptions } from "../gift-cards/giftCards.service.js";
import { evaluateSaleGuards } from "../../shared/sale-guards.js";
import { allocateLotsForBill, batchMrpCeilings, reapplyBillLotAllocations, restoreBillLotAllocations, restoreLotsForSaleReturn } from "../inventory-lots/inventoryLots.service.js";
import { reapplyBillOfferRedemption, redeemOfferInTransaction, reverseBillOfferRedemption, validateOfferForBill } from "../offers/offers.service.js";
import { sendTransactionalEmail } from "../../lib/authEmail.js";
import { createAuditLog } from "../audit/audit.service.js";
import { dispatchIntegrationDeliveries, stageIntegrationEvent } from "../integrations/integrations.service.js";
import { assertSensitiveBillReason, deriveSensitiveBillActions } from "./bill-sensitive-approval.js";
import { stockLedgerProvenance } from "../inventory/stock-ledger-provenance.js";

const OFFLINE_BILL_MAX_AGE_MS = 366 * 24 * 60 * 60 * 1000;
const OFFLINE_BILL_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const BILL_ITEMS_WITH_OPTIONS = { include: { addons: true } };

async function writeRequiredBillAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Bill action was not saved because its audit record could not be stored",
      503,
      "BILL_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}

function resolveBillBusinessDate(actor = {}) {
  const receivedAt = new Date();
  if (actor?.isOfflineReplay !== true) return receivedAt;

  const candidate = actor?.businessDate instanceof Date
    ? new Date(actor.businessDate.getTime())
    : new Date(actor?.businessDate);
  const timestamp = candidate.getTime();
  if (!Number.isFinite(timestamp)) {
    const error = new AppError("Offline bill transaction time is invalid", 400);
    error.code = "OFFLINE_BILL_DATE_INVALID";
    throw error;
  }
  if (timestamp > receivedAt.getTime() + OFFLINE_BILL_FUTURE_TOLERANCE_MS) {
    const error = new AppError("Offline bill transaction time is too far in the future", 409);
    error.code = "OFFLINE_BILL_DATE_IN_FUTURE";
    throw error;
  }
  if (timestamp < receivedAt.getTime() - OFFLINE_BILL_MAX_AGE_MS) {
    const error = new AppError("Offline bill is older than the supported recovery window", 409);
    error.code = "OFFLINE_BILL_DATE_TOO_OLD";
    throw error;
  }
  return candidate;
}

// ─────────────────────────────────────────────────────────────
// LIST BILLS
// ─────────────────────────────────────────────────────────────
export async function listBills(shopId, { from, to, status, customerId, locationId, page, limit }) {
  const where = {
    shopId,
    deletedAt: null,
    ...(status !== "all" && { status }),
    ...(customerId && { customerId }),
    ...(locationId && { locationId }),
    ...(from && to && {
      businessDate: { gte: rangeStart(from), lte: rangeEndInclusive(to) },
    }),
  };

  const [bills, total] = await Promise.all([
    db.bill.findMany({
      where,
      include: { items: BILL_ITEMS_WITH_OPTIONS, payments: true, location: true, giftCardTransactions: true },
      orderBy: { businessDate: "desc" },
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
    where: { id, shopId, deletedAt: null },
    include: { items: BILL_ITEMS_WITH_OPTIONS, payments: true, customer: true, location: true, giftCardTransactions: true },
  });
  if (!bill) throw new AppError("Bill not found", 404);
  return bill;
}

function receiptEscape(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function receiptMoney(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function emailBillReceipt(shopId, billId, email) {
  const [shop, bill] = await Promise.all([
    db.shop.findUnique({ where: { id: shopId }, select: { name: true, address: true, city: true, phone: true, gstNumber: true } }),
    db.bill.findFirst({ where: { id: billId, shopId, deletedAt: null }, include: { items: true, payments: true } }),
  ]);
  if (!bill || !shop) throw new AppError("Bill not found", 404, "BILL_NOT_FOUND");
  const itemLines = bill.items.map((item) => `${item.name} × ${item.quantity} ${item.enteredUnit} — ${receiptMoney(item.lineTotal)}`);
  const text = [
    shop.name,
    [shop.address, shop.city].filter(Boolean).join(", "),
    shop.gstNumber ? `GSTIN: ${shop.gstNumber}` : "",
    "",
    `Receipt ${bill.billNo}`,
    `Date: ${bill.businessDate.toISOString()}`,
    `Customer: ${bill.customerName || "Walk-in"}`,
    "",
    ...itemLines,
    "",
    `Subtotal: ${receiptMoney(bill.subtotal)}`,
    Number(bill.discount) ? `Discount: -${receiptMoney(bill.discount)}` : "",
    Number(bill.gst) ? `GST: ${receiptMoney(bill.gst)}` : "",
    `Total: ${receiptMoney(bill.grandTotal)}`,
    `Paid: ${receiptMoney(bill.paidAmount)}`,
    Number(bill.creditAmount) ? `Udhar: ${receiptMoney(bill.creditAmount)}` : "",
    "",
    "Thank you for shopping with us.",
  ].filter(Boolean).join("\n");
  const rows = bill.items.map((item) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0">${receiptEscape(item.name)}<br><small>${receiptEscape(`${item.quantity} ${item.enteredUnit}`)}</small></td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;text-align:right">${receiptEscape(receiptMoney(item.lineTotal))}</td></tr>`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:560px;margin:0 auto;padding:24px 12px"><div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px"><h1 style="margin:0;font-size:22px">${receiptEscape(shop.name)}</h1><p style="margin:6px 0 20px;color:#64748b">${receiptEscape([shop.address, shop.city].filter(Boolean).join(", "))}</p><h2 style="font-size:16px">Receipt ${receiptEscape(bill.billNo)}</h2><p style="color:#64748b;font-size:13px">${receiptEscape(bill.businessDate.toLocaleString("en-IN"))} · ${receiptEscape(bill.customerName || "Walk-in")}</p><table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table><p style="font-size:18px;font-weight:700;text-align:right">Total ${receiptEscape(receiptMoney(bill.grandTotal))}</p>${Number(bill.creditAmount) ? `<p style="text-align:right;color:#b45309">Udhar ${receiptEscape(receiptMoney(bill.creditAmount))}</p>` : ""}<p style="margin-top:24px;color:#64748b;font-size:13px">Thank you for shopping with us.</p></div></div></body></html>`;
  const delivery = await sendTransactionalEmail({ to: email, subject: `${shop.name} receipt ${bill.billNo}`, text, html });
  if (!delivery.delivered) throw new AppError("Email delivery provider is not configured", 503, "EMAIL_PROVIDER_NOT_READY");
  return { delivered: true, provider: delivery.provider, email, billId: bill.id, billNo: bill.billNo };
}

export async function softDeleteBill(shopId, billId, { reason } = {}, actor = {}) {
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({ where: { id: billId, shopId }, include: { items: true, payments: true } });
    if (!bill) throw new AppError("Bill not found", 404);
    // Idempotent under offline replay: a re-delivered DELETE_BILL event stops here, so the
    // ledger below is posted exactly once per actual trip to the recycle bin. The unique
    // (shopId, idempotencyKey) index is the backstop if two ever raced.
    if (bill.deletedAt) return bill;
    const deletedAt = new Date();
    const deleted = await tx.bill.update({
      where: { id: bill.id },
      data: { deletedAt, deletedReason: reason },
    });

    // FinancialLedger: take the bill off the journal the same way every report just dropped it,
    // in this same transaction. Only an ACTIVE bill still has a reporting effect to reverse — a
    // cancelled one was already reversed by cancelBill, and reversing it twice would push the
    // journal negative. Bills that never posted at creation (legacy quote-era estimates) reverse
    // nothing. The udhar and gift-card value deliberately stays posted: a delete does not touch
    // the customer's khata, so the journal must not drop it either.
    if (bill.status === "active") {
      const creationLedgerRows = await tx.financialLedger.count({
        where: { shopId, billId: bill.id },
      });
      if (creationLedgerRows > 0) {
        await postBillDeletedLedger(tx, {
          shopId,
          bill,
          tenderPayments: Array.isArray(bill.payments) ? bill.payments : [],
          creditAmount: Number(bill.creditAmount ?? 0),
          waivedAmount: Number(bill.waivedAmount ?? 0),
          customerId: bill.customerId ?? null,
          deletedAt,
        });
      }
    }

    await writeRequiredBillAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? null,
      action: "BILL_MOVED_TO_RECYCLE_BIN",
      entityType: "Bill",
      entityId: bill.id,
      before: { deletedAt: bill.deletedAt, deletedReason: bill.deletedReason },
      after: { deletedAt: deleted.deletedAt, deletedReason: deleted.deletedReason },
      metadata: { reason: reason ?? null, billNo: bill.billNo, offlineSyncEventId: actor.syncEventId ?? null },
      req: actor.req ?? null,
    }, tx);
    return deleted;
  });
}

export async function restoreDeletedBill(shopId, billId, actor = {}) {
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({ where: { id: billId, shopId }, include: { items: true, payments: true } });
    if (!bill) throw new AppError("Bill not found", 404);
    // Same replay guard as softDeleteBill, from the other side.
    if (!bill.deletedAt) return bill;
    const restoredAt = new Date();
    const restored = await tx.bill.update({
      where: { id: bill.id },
      data: { deletedAt: null, deletedReason: null },
    });

    // Mirror image of the delete: the reports start counting this bill again, so the journal
    // re-posts the reporting effect it reversed. A cancelled bill has nothing to re-post — it
    // leaves the bin still cancelled.
    if (bill.status === "active") {
      const ledgerRows = await tx.financialLedger.count({
        where: { shopId, billId: bill.id },
      });
      if (ledgerRows > 0) {
        await postBillUndeletedLedger(tx, {
          shopId,
          bill,
          tenderPayments: Array.isArray(bill.payments) ? bill.payments : [],
          creditAmount: Number(bill.creditAmount ?? 0),
          waivedAmount: Number(bill.waivedAmount ?? 0),
          customerId: bill.customerId ?? null,
          restoredAt,
        });
      }
    }

    await writeRequiredBillAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? null,
      action: "BILL_RESTORED_FROM_RECYCLE_BIN",
      entityType: "Bill",
      entityId: bill.id,
      before: { deletedAt: bill.deletedAt, deletedReason: bill.deletedReason },
      after: { deletedAt: restored.deletedAt, deletedReason: restored.deletedReason },
      metadata: { reason: actor.reason ?? null, billNo: bill.billNo, offlineSyncEventId: actor.syncEventId ?? null },
      req: actor.req ?? null,
    }, tx);
    return restored;
  });
}

// ─────────────────────────────────────────────────────────────
// CONFIRM BILL — the big one
// Everything runs in a single DB transaction.
// If anything fails, everything rolls back.
// ─────────────────────────────────────────────────────────────
export async function confirmBill(shopId, body, actor = {}) {
  const sensitiveActions = Array.isArray(actor.sensitiveBillActions)
    ? [...new Set(actor.sensitiveBillActions)]
    : await deriveSensitiveBillActions(shopId, body);
  assertSensitiveBillReason(sensitiveActions, body.reason);
  if (sensitiveActions.length > 0 && actor.ownerPinVerified !== true) {
    throw new AppError("Owner PIN required for this sensitive bill action", 403, "OWNER_PIN_REQUIRED");
  }
  body = { ...body, sensitiveActions };
  const {
    billType,
    customerId,
    customerName,
    items,
    discount,
    offerId,
    offerCode,
    offerDiscount: claimedOfferDiscount = 0,
    gstMode = "inclusive",
    payments = [],
    creditAmount: inputCreditAmount,
    actualAmount: inputActualAmount,
    buyerPaidAmount: inputBuyerPaidAmount,
    waivedAmount: inputWaivedAmount = 0,
    roundOff: roundOffEnabled = false,
  } = body;
  const billIdentity = normalizeBillIdentity(shopId, body, actor);
  const requestedLocationId = body.locationId ?? body.location_id ?? actor?.locationId ?? null;

  const isEstimate = billType === "estimate";
  // Keep the invariant at the service boundary too. HTTP and sync requests are
  // schema-validated, but jobs/tests can call confirmBill directly; none of those
  // paths may persist a tax document whose declared tax mode disables GST.
  if (billType === "gst_invoice" && gstMode === "none") {
    throw new AppError("GST invoice requires inclusive or exclusive GST mode", 400, "GST_MODE_REQUIRED");
  }
  // Phase 12: cashier attribution is taken only from authenticated server context,
  // never from frontend/offline payload attribution fields.
  const createdByUserId = actor?.userId ?? null;
  const deviceId = actor?.deviceId ?? null;
  const businessDate = resolveBillBusinessDate(actor);
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

  // Create/resolve the primary location before opening the sale transaction.
  // Recovering from a concurrent unique-key race inside a PostgreSQL transaction
  // leaves that transaction aborted, and SQLite cannot safely run both creates.
  const operationalLocation = await resolveOperationalLocation(shopId, requestedLocationId);

  let bill;
  let integrationDeliveries = [];
  try {
    const transactionResult = await db.$transaction(async (tx) => {
    const existingBill = await findExistingBillByIdentity(tx, shopId, billIdentity);
    if (existingBill) return { bill: existingBill, deliveries: [] };
    const location = await resolveOperationalLocation(shopId, operationalLocation.id, tx);
    const shop = await tx.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
    const sellerIdentity = locationSellerIdentity(location, shop);
    const sourceOrder = body.sourceOrderId
      ? await tx.customerOrder.findFirst({ where: { id: body.sourceOrderId, shopId } })
      : null;
    if (body.sourceOrderId && !sourceOrder) {
      throw new AppError("Customer order not found", 404, "SOURCE_ORDER_NOT_FOUND");
    }
    if (sourceOrder?.fulfillmentType === "dine_in") {
      throw new AppError("Dine-in orders must be settled from their protected table bill", 409, "DINE_IN_TABLE_BILL_REQUIRED");
    }
    if (sourceOrder && !["accepted", "ready"].includes(sourceOrder.status)) {
      throw new AppError("Customer order is not ready for billing", 409, "SOURCE_ORDER_NOT_ACCEPTED");
    }
    if (sourceOrder?.billId) {
      throw new AppError("Customer order is already billed", 409, "SOURCE_ORDER_ALREADY_BILLED");
    }
    if (sourceOrder?.locationId && sourceOrder.locationId !== location.id) {
      throw new AppError("Customer order belongs to another store", 409, "SOURCE_ORDER_LOCATION_MISMATCH");
    }
    if (billType === "gst_invoice" && !sellerIdentity.registrationValid) {
      throw new AppError("This location needs a valid GSTIN before issuing a GST invoice", 422, "SELLER_GSTIN_REQUIRED");
    }

    const invoiceCustomer = customerId
      ? await tx.customer.findFirst({ where: { id: customerId, shopId, deletedAt: null } })
      : null;
    if (customerId && !invoiceCustomer) throw new AppError("Customer not found", 404);
    const loyaltyRedemption = await reserveBillLoyaltyRedemption(tx, {
      shopId,
      customerId,
      points: body.loyaltyPointsToRedeem,
      isEstimate,
    });

    // ── 1. Load and validate all products ─────────────────────
    const productIds = items.filter((i) => i.productId).map((i) => i.productId);
    const dbProducts = await tx.product.findMany({
      where: { id: { in: productIds }, shopId, deletedAt: null },
    });
    const productMap = Object.fromEntries(dbProducts.map((p) => [p.id, p]));

    // A trade may refuse this sale on its own terms — a pharmacy will not let a
    // Schedule H medicine leave without a doctor's slip. Billing never names a
    // trade; verticals register guards and this asks the registry. No guards
    // registered is one array-length check.
    const { refusal: saleRefusal, onConfirmed: saleGuardHooks, decorateBillItem: saleItemDecorators } = await evaluateSaleGuards({
      shopId, tx, body, items, productMap, isEstimate, location,
    });
    if (saleRefusal) {
      const error = new AppError(saleRefusal.message, saleRefusal.status ?? 409, saleRefusal.code);
      if (saleRefusal.publicData) error.publicData = saleRefusal.publicData;
      throw error;
    }

    const locationStockByProduct = new Map(await Promise.all(dbProducts.map(async (product) => [
      product.id,
      await getLocationQuantity(tx, shopId, location, product),
    ])));
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

    // Which packaging a line sells in, and therefore how much base stock it moves.
    // Shared with the item loop below so the batch ceiling is resolved against the
    // same quantity that will actually be allocated — a pack line converts by
    // conversionToBase, a loose line by its entered unit, and reading one with the
    // other's rule walks the wrong batches.
    const resolveSellingUnit = (item, product) => (product
      ? (item.sellingUnitId ? sellingUnitById.get(item.sellingUnitId) : null)
        ?? (item.sellingUnitCode ? sellingUnitByCode.get(`${product.id}:${item.sellingUnitCode}`) : null)
        ?? defaultSellingUnitByProduct.get(product.id)
        ?? null
      : null);
    const baseQtyForItem = (item, product) => {
      const unit = resolveSellingUnit(item, product);
      if (unit) return round2(item.quantity * unit.conversionToBase);
      return product ? toBaseQty(item.quantity, item.enteredUnit, product.baseUnit) : item.quantity;
    };

    // The price ceiling has to come from the batch actually being dispensed, not
    // from the product record: a manufacturer revises the printed MRP between
    // batches, so the strip in hand and Product.mrp routinely disagree. Resolved
    // here, before pricing, and from the same FEFO order allocateLotsForBill will
    // walk below — otherwise the ceiling could belong to a different batch than
    // the one that leaves the shelf. Empty for every shop without batch tracking.
    const batchTrackedIds = new Set(dbProducts.filter((product) => product.batchTrackingEnabled).map((product) => product.id));
    const chosenLotByProduct = new Map();
    const batchQtyByProduct = new Map();
    for (const item of items) {
      if (!item.productId || !batchTrackedIds.has(item.productId)) continue;
      if (item.inventoryLotId) chosenLotByProduct.set(item.productId, item.inventoryLotId);
      const baseQty = Math.abs(Number(baseQtyForItem(item, productMap[item.productId]) || 0));
      batchQtyByProduct.set(item.productId, (batchQtyByProduct.get(item.productId) ?? 0) + baseQty);
    }
    const batchCeilingByProduct = batchTrackedIds.size > 0
      ? await batchMrpCeilings(tx, {
        shopId,
        locationId: location.id,
        requests: [...batchTrackedIds].map((productId) => ({
          productId,
          inventoryLotId: chosenLotByProduct.get(productId) ?? null,
          quantityBaseQty: round2(batchQtyByProduct.get(productId) ?? 0),
        })),
      })
      : new Map();

    // ── 2. Build bill items + validate stock ──────────────────
    let subtotal = 0;
    let totalGst = 0;
    let itemProfit = 0;
    const billItems = [];
    const stockUpdates = []; // collect stock changes to apply after

    for (const [itemIndex, item] of items.entries()) {
      const product = item.productId ? productMap[item.productId] : null;

      if (item.productId && !product) {
        throw new AppError(`Product not found: ${item.productId}`, 404);
      }

      const sellingUnit = resolveSellingUnit(item, product);
      if (sellingUnit && sellingUnit.productId !== product?.id) {
        throw new AppError("Selling unit does not belong to the selected product", 400);
      }
      if (product && (item.sellingUnitId || item.sellingUnitCode) && !sellingUnit) {
        throw new AppError(`Selling unit is unavailable for "${product.name}". Refresh product pricing and try again.`, 409);
      }

      // Determine units from product if productId given, else use what's passed
      const baseUnit = product?.baseUnit ?? item.enteredUnit;
      const rateUnit = sellingUnit?.name ?? product?.rateUnit ?? item.enteredUnit;
      const costPerRateUnit = sellingUnitCostPrice(sellingUnit, product, defaultSellingUnitByProduct.get(product?.id));

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
        const availableAtLocation = locationStockByProduct.get(product.id) ?? 0;
        if (availableAtLocation < qtyInBase) {
          throw new AppError(
            `Insufficient stock for "${product.name}" at ${location.name}. Available: ${availableAtLocation} ${product.baseUnit}, needed: ${qtyInBase}`,
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

      // Each packaging is measured against ITS OWN ceiling: the pack's MRP when it
      // has one, otherwise the product MRP scaled to this pack's size. Comparing a
      // 5 kg bag against the 500 g packet's MRP rejected every legitimate price.
      // A batch-tracked line is capped by the price printed on the batch being
      // dispensed instead, which is the only lawful ceiling for a medicine.
      const batchMrp = product ? batchCeilingByProduct.get(product.id) : 0;
      const maximumPrice = product
        ? sellingUnitMaxPrice(sellingUnit, product, defaultSellingUnitByProduct.get(product.id), batchMrp)
        : 0;
      const baseRateForCeiling = item.baseRatePerRateUnit ?? item.ratePerRateUnit;
      if (maximumPrice > 0 && baseRateForCeiling > maximumPrice + 0.005) {
        const error = new AppError(
          batchMrp > 0
            ? `Price for "${product?.name ?? item.name}" exceeds the MRP printed on the batch being dispensed (Rs ${maximumPrice})`
            : `Price for "${product?.name ?? item.name}" exceeds the configured maximum of Rs ${maximumPrice}`,
          400,
        );
        error.code = "PRICE_ABOVE_CONFIGURED_MAXIMUM";
        throw error;
      }
      const grossLineTotal = multiplyMoney(item.ratePerRateUnit, qtyInRateUnit);
      // A line discount can never exceed its own line; clamping (rather than
      // rejecting) keeps offline bills replayable even if a stale client sent
      // a discount computed against a different quantity.
      const lineDiscount = Math.min(round2(Math.max(0, Number(item.lineDiscount ?? 0))), grossLineTotal);
      const lineTotal = subtractMoney(grossLineTotal, lineDiscount);
      const lineCost = multiplyMoney(costPerRateUnit, qtyInRateUnit);
      const lineProfit = subtractMoney(lineTotal, lineCost);

      subtotal = addMoney(subtotal, lineTotal);
      itemProfit = addMoney(itemProfit, lineProfit);

      const billItem = {
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
        hsn: product?.hsn ?? item.hsn ?? null,
        note: item.note || null,
        lineDiscount,
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
        ...moneyShadows({ ratePerRateUnit: item.ratePerRateUnit, costPerRateUnit, lineDiscount, lineTotal, lineCost, lineProfit, originalUnitPrice: item.originalUnitPrice ?? item.ratePerRateUnit }),
      };
      for (const decorate of saleItemDecorators) {
        const decoration = await decorate({ item, itemIndex, product, billItem });
        if (decoration && typeof decoration === "object") Object.assign(billItem, decoration);
      }
      billItems.push(billItem);

      if (product) {
        stockUpdates.push({
          product,
          qtyInBase,
          lineProfit,
          // Which pack this line sold and how many of it. Base-unit accounting stays
          // authoritative for every existing report; this rides alongside so a
          // per_pack product can also decrement the specific pack the counter chose.
          sellingUnit: sellingUnit ?? null,
          sellingUnitQty: sellingUnit ? item.quantity : 0,
        });
      }
    }

    subtotal = round2(subtotal);
    itemProfit = round2(itemProfit);
    const validatedOffer = await validateOfferForBill(tx, shopId, {
      offerId,
      code: offerCode,
      subtotal,
    });
    const computedOfferDiscount = round2(validatedOffer?.discount ?? 0);
    const normalizedClaimedOfferDiscount = round2(claimedOfferDiscount);
    if (offerId && !moneyEquals(normalizedClaimedOfferDiscount, computedOfferDiscount)) {
      throw new AppError("Coupon value changed. Reapply the coupon before saving the bill.", 409, "OFFER_DISCOUNT_CHANGED");
    }
    if (!offerId && normalizedClaimedOfferDiscount > 0) {
      throw new AppError("Coupon discount requires an offer reference", 422, "OFFER_REFERENCE_REQUIRED");
    }
    if (computedOfferDiscount > round2(discount)) {
      throw new AppError("Bill discount is lower than the validated coupon value", 422, "OFFER_DISCOUNT_MISMATCH");
    }
    const loyaltyDiscount = round2((loyaltyRedemption?.discountValuePaise ?? 0) / 100);
    const billDiscount = addMoney(discount, loyaltyDiscount);
    // Inclusive: tax already lives inside subtotal, so the payable is simply
    // subtotal − discount (matches what the counter UI shows and collects).
    // Exclusive: allocate the discount first, then add tax on the reduced base.
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

    // Section 15(3) excludes invoice-recorded discounts from taxable value.
    // Allocate the combined manual/coupon/loyalty discount across every rate
    // bucket first, then calculate GST. This same paise-exact algorithm runs in
    // the counter and offline save path.
    totalGst = calculateInvoiceGst(
      billItems.map((item) => ({ lineTotal: item.lineTotal, gstRate: item.gstRate })),
      billDiscount,
      gstMode,
    ).gst;

    const rawGrandTotal = gstMode === "exclusive"
      ? addMoney(subtractMoney(subtotal, billDiscount), totalGst)
      : subtractMoney(subtotal, billDiscount);
    // Nearest-rupee round-off (shop's Taxes → "Round off" setting, carried on the bill).
    // Rounding the authoritative total here — before every paid/credit/coverage check
    // below — is what lets the counter collect a whole rupee without tripping
    // "paid exceeds bill" or "payment total does not match grand total". The client
    // rounds by the same rule (Math.round on the paise-reconciled total), so a synced
    // offline bill reconciles identically on replay. The delta is derivable
    // (grandTotal − (subtotal − discount [+gst])), so nothing new is stored.
    const grandTotal = roundOffEnabled ? round2(Math.round(rawGrandTotal)) : rawGrandTotal;

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
    const giftCardAmount = sumMoney(billPayments.filter((p) => p.mode === "gift_card").map((p) => p.amount));
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
        const availableAtLocation = locationStockByProduct.get(product.id) ?? 0;
        if (availableAtLocation < qtyInBase) {
          const err = new AppError(
            `Insufficient stock for "${product.name}" at ${location.name}. Available: ${availableAtLocation} ${product.baseUnit}, needed: ${qtyInBase}`,
            400
          );
          err.code = "INSUFFICIENT_STOCK";
          throw err;
        }
      }
    }

    const giftCardReservations = await reserveGiftCardPayments(tx, { shopId, payments: billPayments });
    const retailIntents = await resolveRetailPaymentIntents(tx, { shopId, locationId: location.id, payments: billPayments });
    const paymentRows = billPayments
      .filter((payment) => payment.mode !== "credit")
      .map((payment, index) => {
        const intentId = payment.retailPaymentIntentId ?? payment.retail_payment_intent_id ?? null;
        const intent = intentId ? retailIntents.get(intentId) : null;
        return {
        shopId,
        mode: payment.mode,
        amount: payment.amount,
        clientPaymentId: pickString(payment.clientPaymentId, payment.client_payment_id),
        idempotencyKey: buildChildIdempotencyKey(billIdentity.idempotencyKey, `payment:${index}:${payment.mode}`),
        sourceDeviceId: billIdentity.sourceDeviceId,
        status: "confirmed",
        provider: payment.mode === "gift_card" ? "gift_card_ledger" : intent?.provider ?? "manual",
        providerReference: intent?.providerPaymentId ?? null,
        confirmationSource: intent?.confirmationSource ?? "manual",
        confirmedAt: intent?.confirmedAt ?? new Date(),
        retailPaymentIntentId: intent?.id ?? null,
        ...moneyShadows({ amount: payment.amount }),
        };
      });

    // ── 3. Generate bill number ───────────────────────────────
    const billNo = await generateBillNo(shopId, tx, { billType, businessDate });

    // ── 4. Create bill ────────────────────────────────────────
    const bill = await tx.bill.create({
      data: {
        shopId,
        locationId: location.id,
        billNo,
        billType,
        customerId: customerId ?? null,
        customerName,
        buyerGstin: invoiceCustomer?.gstNumber ?? null,
        buyerStateCode: invoiceCustomer?.stateCode ?? null,
        buyerAddress: invoiceCustomer?.address ?? null,
        sellerGstin: sellerIdentity.sellerGstin,
        sellerStateCode: sellerIdentity.sellerStateCode,
        sellerLegalName: sellerIdentity.sellerLegalName,
        sellerTradeName: sellerIdentity.sellerTradeName,
        sellerAddress: sellerIdentity.sellerAddress,
        sellerCity: sellerIdentity.sellerCity,
        subtotal,
        discount: billDiscount,
        discountReason: body.discountReason || null,
        offerId: validatedOffer?.offer.id ?? null,
        offerCode: validatedOffer?.offer.code ?? null,
        offerDiscount: computedOfferDiscount,
        loyaltyPointsRedeemed: loyaltyRedemption?.points ?? 0,
        loyaltyDiscount,
        giftCardAmount,
        gst: totalGst,
        gstMode,
        grandTotal,
        actualAmount,
        buyerPaidAmount,
        waivedAmount,
        grossProfit,
        paidAmount,
        creditAmount,
        ...moneyShadows({ subtotal, discount: billDiscount, offerDiscount: computedOfferDiscount, loyaltyDiscount, giftCardAmount, gst: totalGst, grandTotal, actualAmount, buyerPaidAmount, waivedAmount, grossProfit, paidAmount, creditAmount }),
        createdByUserId,
        deviceId,
        clientBillId: billIdentity.clientBillId,
        idempotencyKey: billIdentity.idempotencyKey,
        sourceDeviceId: billIdentity.sourceDeviceId,
        businessDate,
        items: { create: billItems },
        payments: { create: paymentRows },
      },
      include: { items: BILL_ITEMS_WITH_OPTIONS, payments: true, loyaltyTransactions: true },
    });
    await redeemOfferInTransaction(tx, shopId, validatedOffer, { isEstimate });
    await allocateLotsForBill(tx, { shopId, locationId: location.id, bill, chosenLotByProduct });

    // Whatever a guard needs to record about the sale it permitted — the pharmacy
    // closes its register entry against this bill here.
    for (const hook of saleGuardHooks) await hook({ tx, bill, billNo, location, actor });

    let sourceOrderDeliveries = [];
    if (sourceOrder) {
      const paymentStatus = Number(bill.creditAmount) > 0
        ? (Number(bill.paidAmount) > 0 ? "partially_paid" : "unpaid")
        : "paid";
      const fulfilledAt = new Date();
      const linked = await tx.customerOrder.updateMany({
        where: {
          id: sourceOrder.id,
          shopId,
          billId: null,
          status: { in: ["accepted", "ready"] },
        },
        data: {
          billId: bill.id,
          status: "fulfilled",
          fulfillmentStatus: "fulfilled",
          paymentStatus,
          fulfilledAt,
        },
      });
      if (linked.count !== 1) {
        throw new AppError("Customer order changed before billing. Refresh and retry.", 409, "SOURCE_ORDER_CHANGED");
      }
      await writeRequiredBillAudit({
        shopId,
        userId: createdByUserId,
        deviceId: deviceId ?? billIdentity.sourceDeviceId ?? null,
        action: "CUSTOMER_ORDER_BILLED",
        entityType: "CustomerOrder",
        entityId: sourceOrder.id,
        before: { status: sourceOrder.status, paymentStatus: sourceOrder.paymentStatus, billId: sourceOrder.billId },
        after: { status: "fulfilled", paymentStatus, billId: bill.id },
        metadata: { billNo: bill.billNo, locationId: bill.locationId },
        req: actor.req ?? null,
      }, tx);
      sourceOrderDeliveries = await stageIntegrationEvent(shopId, "customer_order.updated", {
        id: sourceOrder.id,
        locationId: sourceOrder.locationId,
        fulfillmentType: sourceOrder.fulfillmentType,
        status: "fulfilled",
        fulfillmentStatus: "fulfilled",
        paymentStatus,
        sourceChannel: sourceOrder.sourceChannel,
        billId: bill.id,
        updatedAt: fulfilledAt,
      }, { client: tx });
    }

    await recordBillLoyaltyRedemption(tx, {
      shopId,
      billId: bill.id,
      billNo: bill.billNo,
      locationId: location.id,
      redemption: loyaltyRedemption,
    });
    await recordBillLoyaltyInTransaction(tx, shopId, bill);
    await recordGiftCardRedemptions(tx, { shopId, bill, locationId: location.id, reservations: giftCardReservations, userId: createdByUserId });
    await consumeRetailPaymentIntents(tx, retailIntents);

    // ── 5. Deduct stock + create stock ledger entries ─────────
    for (const { product, qtyInBase, sellingUnitQtyById } of stockUpdatesByProduct.values()) {
      const stockResult = await decrementLocationInventory(tx, {
        shopId,
        location,
        product,
        quantityBase: qtyInBase,
        allowShortfall: allowStockShortfall,
        packs: sellingUnitQtyById,
      });

      // Record the actual stock removed so the ledger stays internally consistent
      // (old + change == new), including negative after-stock.
      const removedBaseQty = round2(stockResult.oldStock - stockResult.newStock);
      await tx.stockLedger.create({
        data: {
          shopId,
          locationId: location.id,
          productId: product.id,
          productName: product.name,
          ...stockLedgerProvenance(actor),
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
          locationId: location.id,
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
          businessDate: bill.businessDate,
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
    // Estimates/rough bills are quotations, not economic events; the ledger service
    // deliberately ignores them. Final sales post atomically with the bill.
    await postBillCreatedLedger(tx, {
      shopId,
      bill,
      tenderPayments: Array.isArray(bill.payments) ? bill.payments : [],
      creditAmount,
      waivedAmount,
      customerId: customerId ?? null,
    });

    await writeRequiredBillAudit({
      shopId,
      userId: createdByUserId,
      deviceId: deviceId ?? billIdentity.sourceDeviceId ?? null,
      action: "BILL_CREATED",
      entityType: "Bill",
      entityId: bill.id,
      after: {
        billNo: bill.billNo,
        billType: bill.billType,
        status: bill.status,
        grandTotal: bill.grandTotal,
        paidAmount: bill.paidAmount,
        creditAmount: bill.creditAmount,
      },
      metadata: {
        customerId: bill.customerId ?? null,
        locationId: bill.locationId,
        idempotencyKey: bill.idempotencyKey ?? null,
        offlineSyncEventId: actor.syncEventId ?? null,
      },
      req: actor.req ?? null,
    }, tx);
    const sensitiveAuditActions = {
      large_discount: "BILL_LARGE_DISCOUNT_APPROVED",
      selling_below_minimum_price: "BILL_BELOW_MINIMUM_PRICE_APPROVED",
      loyalty_redemption: "BILL_LOYALTY_REDEMPTION_APPROVED",
    };
    for (const sensitiveAction of sensitiveActions) {
      await writeRequiredBillAudit({
        shopId,
        userId: createdByUserId,
        deviceId: deviceId ?? billIdentity.sourceDeviceId ?? null,
        action: sensitiveAuditActions[sensitiveAction] ?? "BILL_SENSITIVE_ACTION_APPROVED",
        entityType: "Bill",
        entityId: bill.id,
        after: {
          billNo: bill.billNo,
          sensitiveAction,
          discount: bill.discount,
          grandTotal: bill.grandTotal,
        },
        metadata: {
          billNo: bill.billNo,
          locationId: bill.locationId,
          reason: body.reason.trim(),
          offlineSyncEventId: actor.syncEventId ?? null,
        },
        req: actor.req ?? null,
      }, tx);
    }
    if (bill.offerId && Number(bill.offerDiscount || 0) > 0 && bill.billType !== "estimate") {
      await writeRequiredBillAudit({
        shopId,
        userId: createdByUserId,
        deviceId: deviceId ?? billIdentity.sourceDeviceId ?? null,
        action: "OFFER_REDEEMED",
        entityType: "Bill",
        entityId: bill.id,
        after: { offerId: bill.offerId, offerCode: bill.offerCode, discount: bill.offerDiscount },
        metadata: { billNo: bill.billNo, locationId: bill.locationId },
        req: actor.req ?? null,
      }, tx);
    }
    if (Number(bill.loyaltyPointsRedeemed || 0) > 0) {
      await writeRequiredBillAudit({
        shopId,
        userId: createdByUserId,
        deviceId: deviceId ?? billIdentity.sourceDeviceId ?? null,
        action: "LOYALTY_POINTS_REDEEMED",
        entityType: "Bill",
        entityId: bill.id,
        after: { customerId: bill.customerId, points: bill.loyaltyPointsRedeemed, discount: bill.loyaltyDiscount },
        metadata: { billNo: bill.billNo, locationId: bill.locationId },
        req: actor.req ?? null,
      }, tx);
    }
    const deliveries = await stageIntegrationEvent(shopId, "bill.created", {
      id: bill.id,
      billNo: bill.billNo,
      billType: bill.billType,
      status: bill.status,
      customerId: bill.customerId,
      customerName: bill.customerName,
      grandTotal: bill.grandTotal,
      paidAmount: bill.paidAmount,
      creditAmount: bill.creditAmount,
      offerId: bill.offerId,
      offerCode: bill.offerCode,
      offerDiscount: bill.offerDiscount,
      createdAt: bill.createdAt,
      locationId: bill.locationId,
    }, { client: tx });

    return { bill, deliveries: [...deliveries, ...sourceOrderDeliveries] };
  });
    bill = transactionResult.bill;
    integrationDeliveries = transactionResult.deliveries;
  } catch (error) {
    if (isUniqueConstraintError(error) && hasBillIdentity(billIdentity)) {
      const existingBill = await findExistingBillByIdentity(db, shopId, billIdentity);
      if (!existingBill) throw error;
      bill = existingBill;
    } else {
      throw error;
    }
  }

  await dispatchIntegrationDeliveries(integrationDeliveries);

  return {
    ...bill,
    payments: bill.payments.filter((payment) => payment.mode !== "credit"),
  };
}

// ─────────────────────────────────────────────────────────────
// CANCEL BILL — reverses everything
// ─────────────────────────────────────────────────────────────
export async function cancelBill(shopId, billId, { reason, idempotentRaceOk = false }, actor = {}) {
  const bill = await db.bill.findFirst({
    where: { id: billId, shopId },
    include: { items: true, payments: true },
  });

  if (!bill) throw new AppError("Bill not found", 404);
  // Idempotent: a bill can be cancelled then "deleted" (both map to this op), or the same
  // cancel can be replayed by sync. Already-cancelled => return as-is WITHOUT re-reversing
  // stock/udhar (the reversal already happened), instead of throwing a permanent CONFLICT.
  if (bill.status === "cancelled") return bill;
  if (bill.billType === "sales_return") {
    const err = new AppError("A completed sale return cannot be cancelled from the bill screen", 409);
    err.code = "SALE_RETURN_NOT_CANCELLABLE";
    throw err;
  }
  const activeReturnCount = await db.bill.count({
    where: { shopId, returnOfBillId: bill.id, billType: "sales_return", status: "active" },
  });
  if (activeReturnCount > 0) {
    const err = new AppError("This bill has completed returns and can no longer be cancelled", 409);
    err.code = "BILL_HAS_ACTIVE_RETURNS";
    throw err;
  }

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
    const location = await resolveOperationalLocation(shopId, bill.locationId, tx, { allowInactive: true });

    const saleLedgerRows = await tx.stockLedger.count({
      where: { shopId, billId: bill.id, action: "sale" },
    });
    for (const item of saleLedgerRows > 0 ? bill.items : []) {
      if (!item.productId) continue;

      const product = await tx.product.findFirst({ where: { id: item.productId, shopId } });
      if (!product) continue;
      const stockResult = await incrementLocationInventory(tx, { shopId, location, product, quantityBase: item.quantityInBaseUnit, packs: packsFromBillItem(item) });

      await tx.stockLedger.create({
        data: {
          shopId,
          locationId: location.id,
          productId: item.productId,
          productName: item.name,
          ...stockLedgerProvenance(actor),
          action: "cancel_reversal",
          changeBaseQty: item.quantityInBaseUnit,
          oldStockBaseQty: stockResult.oldStock,
          newStockBaseQty: stockResult.newStock,
          billId: bill.id,
          sourceDeviceId: actor.deviceId ?? null,
          sourceType: "bill_cancel",
          sourceId: bill.id,
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
            locationId: location.id,
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
        waivedAmount: Number(bill.waivedAmount ?? 0),
        customerId: bill.customerId ?? null,
        reversalAt: cancelledAt,
        // Cancelling a bill already in the recycle bin (offline replay can deliver DELETE_BILL
        // and CANCEL_BILL in either order): softDeleteBill has reversed the sale and its tenders
        // already, so only the udhar/gift-card half is left to reverse. Reversing in full here
        // would take the sale off the books twice.
        scope: bill.deletedAt ? "retained" : "full",
      });
    }

    // Loyalty earning and redemption are part of the same cancellation unit as
    // stock, udhar, and accounting. A crash can no longer leave points detached.
    await reverseBillLoyaltyInTransaction(tx, shopId, bill.id);
    await reverseBillOfferRedemption(tx, shopId, bill);
    await reverseGiftCardRedemptions(tx, shopId, bill.id, { note: `Bill cancelled: ${reason}` });
    await restoreBillLotAllocations(tx, bill.id);

    const cancelled = await tx.bill.findFirst({ where: { id: billId, shopId } });
    await writeRequiredBillAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? null,
      action: "BILL_CANCELLED",
      entityType: "Bill",
      entityId: bill.id,
      before: { status: bill.status, cancelledAt: bill.cancelledAt, cancelledReason: bill.cancelledReason },
      after: { status: cancelled.status, cancelledAt: cancelled.cancelledAt, cancelledReason: cancelled.cancelledReason },
      metadata: { reason, billNo: bill.billNo, offlineSyncEventId: actor.syncEventId ?? null },
      req: actor.req ?? null,
    }, tx);
    return cancelled;
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

  const normalizedRefundMode = ["cash", "upi", "bank", "udhar", "gift_card"].includes(String(refundMode)) ? String(refundMode) : "cash";
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
  let integrationDeliveries = [];
  try {
    const transactionResult = await db.$transaction(async (tx) => {
      const existing = await findExistingBillByIdentity(tx, shopId, billIdentity);
      if (existing) return { bill: existing, deliveries: [] };

      // Optional link to the original sale (bill-linked returns).
      const original = returnOfBillId
        ? await tx.bill.findFirst({ where: { id: returnOfBillId, shopId }, include: { items: true } })
        : null;
      if (returnOfBillId && !original) throw new AppError("Original sale not found", 404);
      if (original && original.status !== "active") {
        const err = new AppError("Only an active sale can be returned", 409);
        err.code = "ORIGINAL_BILL_NOT_RETURNABLE";
        throw err;
      }
      if (original?.billType === "sales_return") {
        const err = new AppError("A return cannot be returned again", 409);
        err.code = "RETURN_OF_RETURN_NOT_ALLOWED";
        throw err;
      }
      const location = await resolveOperationalLocation(
        shopId,
        body.locationId ?? body.location_id ?? original?.locationId ?? actor?.locationId ?? null,
        tx,
        { allowInactive: Boolean(original?.locationId) },
      );
      const shop = await tx.shop.findUnique({ where: { id: shopId } });
      if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
      const sellerIdentity = original ? billSellerIdentity(original, shop) : locationSellerIdentity(location, shop);

      // A return against an estimate must not post GST: the original kacha bill never entered
      // the GST report, so its reversal can't either — otherwise the report would show negative
      // tax with no positive side. Sales/stock/refund effects still apply in full.
      const effectiveGstMode = original?.billType === "estimate" ? "none" : original?.gstMode ?? gstMode;

      const productIds = [...new Set([
        ...items.filter((i) => i.productId).map((i) => i.productId),
        ...(original?.items ?? []).filter((i) => i.productId).map((i) => i.productId),
      ])];
      const dbProducts = await tx.product.findMany({ where: { id: { in: productIds }, shopId } });
      const productMap = Object.fromEntries(dbProducts.map((p) => [p.id, p]));

      let subtotal = 0;
      let totalGst = 0;
      let itemProfit = 0;
      const billItems = [];
      const restockPlan = []; // { product, qtyInBase, lineCost, damaged }
      const originalItemById = new Map((original?.items ?? []).map((line) => [line.id, line]));

      const returnLineKey = (line) => [
        line.productId ? `product:${line.productId}` : `name:${String(line.name ?? "").trim().toLowerCase()}`,
        `rate:${round2(Math.abs(Number(line.ratePerRateUnit ?? 0)))}`,
      ].join("|");

      // A linked return must reverse the money that the original invoice
      // actually recorded, not recalculate a new sale from the sticker price.
      // This matters for invoice-level discounts and also preserves historical
      // invoices created under an older GST policy. Every amount is allocated in
      // paise, and a final partial return receives the exact remaining residue.
      const previouslyReturned = original
        ? await tx.bill.findMany({
            where: { shopId, returnOfBillId: original.id, billType: "sales_return", status: "active" },
            include: { items: true },
          })
        : [];
      const originalFinancialByLine = new Map();
      if (original) {
        const originalLines = original.items.map((line) => ({
          lineTotal: Math.abs(Number(line.lineTotal ?? 0)),
          gstRate: Number(line.gstRate ?? 0),
        }));
        const invoiceDiscount = allocateInvoiceDiscount(
          originalLines.map((line) => line.lineTotal),
          Math.abs(Number(original.discount ?? 0)),
        );
        const currentTax = calculateInvoiceGst(
          originalLines,
          Math.abs(Number(original.discount ?? 0)),
          effectiveGstMode,
        );
        const preDiscountTax = calculateInvoiceGst(originalLines, 0, effectiveGstMode);
        const taxWeights = currentTax.lineGst.some((value) => value > 0)
          ? currentTax.lineGst
          : preDiscountTax.lineGst.some((value) => value > 0)
            ? preDiscountTax.lineGst
            : originalLines.map((line) => line.lineTotal);
        const exactStoredTax = allocateAmountByWeights(taxWeights, Math.abs(Number(original.gst ?? 0)));

        original.items.forEach((line, index) => {
          originalFinancialByLine.set(line.id, {
            soldQuantity: Math.abs(Number(line.quantityInBaseUnit ?? line.quantity ?? 0)),
            gross: addMoney(Math.abs(Number(line.lineTotal ?? 0)), Math.abs(Number(line.lineDiscount ?? 0))),
            subtotal: invoiceDiscount.discountedLineTotals[index] ?? 0,
            gst: exactStoredTax[index] ?? 0,
            cost: Math.abs(Number(line.lineCost ?? 0)),
            returnedQuantity: 0,
            returnedGross: 0,
            returnedSubtotal: 0,
            returnedGst: 0,
            returnedCost: 0,
          });
        });

        for (const previousReturn of previouslyReturned) {
          const returnLines = previousReturn.items.map((line) => ({
            lineTotal: Math.abs(Number(line.lineTotal ?? 0)),
            gstRate: Number(line.gstRate ?? 0),
          }));
          const calculatedReturnTax = calculateInvoiceGst(returnLines, 0, previousReturn.gstMode ?? effectiveGstMode);
          const returnTaxWeights = calculatedReturnTax.lineGst.some((value) => value > 0)
            ? calculatedReturnTax.lineGst
            : returnLines.map((line) => line.lineTotal);
          const exactReturnTax = allocateAmountByWeights(
            returnTaxWeights,
            Math.abs(Number(previousReturn.gst ?? 0)),
          );

          previousReturn.items.forEach((returnedItem, index) => {
            const legacyCandidates = original.items.filter((line) => returnLineKey(line) === returnLineKey(returnedItem));
            const key = returnedItem.originalBillItemId ?? (legacyCandidates.length === 1 ? legacyCandidates[0].id : null);
            const financial = key ? originalFinancialByLine.get(key) : null;
            if (!financial) return;
            financial.returnedQuantity = addMoney(
              financial.returnedQuantity,
              Math.abs(Number(returnedItem.quantityInBaseUnit ?? returnedItem.quantity ?? 0)),
            );
            financial.returnedGross = addMoney(
              financial.returnedGross,
              Math.abs(Number(returnedItem.lineTotal ?? 0)),
              Math.abs(Number(returnedItem.lineDiscount ?? 0)),
            );
            financial.returnedSubtotal = addMoney(financial.returnedSubtotal, Math.abs(Number(returnedItem.lineTotal ?? 0)));
            financial.returnedGst = addMoney(financial.returnedGst, exactReturnTax[index] ?? 0);
            financial.returnedCost = addMoney(financial.returnedCost, Math.abs(Number(returnedItem.lineCost ?? 0)));
          });
        }
      }

      for (const item of items) {
        let originalItem = item.originalBillItemId ? originalItemById.get(item.originalBillItemId) : null;
        if (original && !originalItem) {
          const candidates = original.items.filter((line) => returnLineKey(line) === returnLineKey(item));
          if (candidates.length === 1) originalItem = candidates[0];
        }
        if (original && !originalItem) {
          const err = new AppError("Return item could not be matched to one original bill line", 409);
          err.code = "RETURN_LINE_NOT_ON_ORIGINAL_SALE";
          throw err;
        }
        const effectiveProductId = originalItem?.productId ?? item.productId ?? null;
        const product = effectiveProductId ? productMap[effectiveProductId] : null;
        if (effectiveProductId && !product) throw new AppError(`Product not found: ${effectiveProductId}`, 404);

        // A return item may arrive without enteredUnit (older clients / quick returns). Fall back
        // to the product's units instead of letting toBaseQty throw "enteredUnit is required",
        // which previously left sale-return sync stuck failing forever.
        const enteredUnit = (originalItem?.enteredUnit ?? item.enteredUnit) || product?.rateUnit || product?.baseUnit || "piece";
        const baseUnit = originalItem?.baseUnit ?? product?.baseUnit ?? enteredUnit;
        const rateUnit = originalItem?.rateUnit ?? product?.rateUnit ?? enteredUnit;
        const costPerRateUnit = Number(originalItem?.costPerRateUnit ?? product?.costPerRateUnit ?? 0);
        const originalQuantity = Math.abs(Number(originalItem?.quantity ?? 0));
        const returnFraction = originalItem ? Number(item.quantity) / Math.max(originalQuantity, 0.000001) : 0;
        const qtyInBase = originalItem
          ? round2(Math.abs(Number(originalItem.quantityInBaseUnit)) * returnFraction)
          : product ? toBaseQty(item.quantity, enteredUnit, product.baseUnit) : item.quantity;
        const originalFinancial = originalItem ? originalFinancialByLine.get(originalItem.id) : null;
        const availableQuantity = originalFinancial
          ? Math.max(0, subtractMoney(originalFinancial.soldQuantity, originalFinancial.returnedQuantity))
          : 0;
        if (originalFinancial && qtyInBase > availableQuantity + 0.000001) {
          const err = new AppError("Return quantity or price exceeds what remains on the original sale", 409);
          err.code = "RETURN_EXCEEDS_ORIGINAL_SALE";
          throw err;
        }
        const isFinalLinkedReturn = Boolean(
          originalFinancial && qtyInBase >= availableQuantity - 0.000001,
        );
        const qtyInRateUnit = originalItem
          ? round2((Math.abs(Number(originalItem.lineTotal)) + Math.abs(Number(originalItem.lineDiscount ?? 0))) * returnFraction / Math.max(Math.abs(Number(originalItem.ratePerRateUnit)), 0.000001))
          : product ? baseQtyToRateQty(qtyInBase, rateUnit, baseUnit) : item.quantity;

        const authoritativeRate = Number(originalItem?.ratePerRateUnit ?? item.ratePerRateUnit);
        const grossLineTotal = originalItem
          ? isFinalLinkedReturn
            ? Math.max(0, subtractMoney(originalFinancial.gross, originalFinancial.returnedGross))
            : round2(originalFinancial.gross * returnFraction)
          : multiplyMoney(authoritativeRate, qtyInRateUnit);
        const lineTotal = originalItem
          ? isFinalLinkedReturn
            ? Math.max(0, subtractMoney(originalFinancial.subtotal, originalFinancial.returnedSubtotal))
            : round2(originalFinancial.subtotal * returnFraction)
          : subtractMoney(grossLineTotal, Math.min(round2(Math.max(0, Number(item.lineDiscount ?? 0))), grossLineTotal));
        // The return line embeds both the original line discount and its exact
        // share of the bill-level discount. That makes return subtotal/profit
        // reconcile without applying a second discount on the credit note.
        const lineDiscount = originalItem
          ? Math.max(0, subtractMoney(grossLineTotal, lineTotal))
          : Math.min(round2(Math.max(0, Number(item.lineDiscount ?? 0))), grossLineTotal);
        const rate = Number(originalItem?.gstRate ?? item.gstRate ?? product?.gstRate ?? 0);
        const remainingOriginalGst = originalFinancial
          ? Math.max(0, subtractMoney(originalFinancial.gst, originalFinancial.returnedGst))
          : 0;
        const proportionalReturnGst = effectiveGstMode === "exclusive"
          ? multiplyMoney(lineTotal, rate / 100)
          : effectiveGstMode === "none" || rate <= 0
            ? 0
            : subtractMoney(lineTotal, round2(lineTotal / (1 + rate / 100)));
        const gstAmount = originalItem
          ? isFinalLinkedReturn
            ? remainingOriginalGst
            : Math.min(remainingOriginalGst, proportionalReturnGst)
          : effectiveGstMode === "exclusive"
            ? multiplyMoney(lineTotal, rate / 100)
            : effectiveGstMode === "none" || rate <= 0
              ? 0
              : subtractMoney(lineTotal, round2(lineTotal / (1 + rate / 100)));
        const lineCost = originalItem
          ? isFinalLinkedReturn
            ? Math.max(0, subtractMoney(originalFinancial.cost, originalFinancial.returnedCost))
            : round2(originalFinancial.cost * returnFraction)
          : multiplyMoney(costPerRateUnit, qtyInRateUnit);
        const lineProfit = subtractMoney(lineTotal, lineCost);
        const damaged = item.damaged === true;

        subtotal = addMoney(subtotal, lineTotal);
        totalGst = addMoney(totalGst, gstAmount);
        itemProfit = addMoney(itemProfit, lineProfit);

        // Stored NEGATIVE on the return bill so reports net the original sale down.
        billItems.push({
          productId: effectiveProductId,
          originalBillItemId: originalItem?.id ?? null,
          name: originalItem?.name ?? product?.name ?? item.name ?? "Item",
          quantity: -Math.abs(item.quantity),
          enteredUnit,
          baseUnit,
          quantityInBaseUnit: -Math.abs(qtyInBase),
          rateUnit,
          ratePerRateUnit: authoritativeRate,
          costPerRateUnit,
          gstRate: rate,
          hsn: originalItem?.hsn ?? product?.hsn ?? item.hsn ?? null,
          note: (originalItem?.note ?? item.note) || null,
          lineDiscount: -lineDiscount,
          lineTotal: -lineTotal,
          lineCost: -lineCost,
          lineProfit: -lineProfit,
          // Carry the packaging the sale recorded onto the return line. Without it a
          // return bill cannot say which size came back, and any later reversal or
          // per-size report would have only base units to work from.
          sellingUnitId: originalItem?.sellingUnitId ?? null,
          sellingUnitCode: originalItem?.sellingUnitCode ?? null,
          sellingUnitLabel: originalItem?.sellingUnitLabel ?? null,
          ...moneyShadows({ ratePerRateUnit: authoritativeRate, costPerRateUnit, lineDiscount: -lineDiscount, lineTotal: -lineTotal, lineCost: -lineCost, lineProfit: -lineProfit }),
        });

        if (product) {
          restockPlan.push({
            product,
            qtyInBase: round2(qtyInBase),
            lineCost,
            damaged,
            // item.quantity is in the same units as the original line, so for a
            // packaged sale it is already a pack count — including partial returns
            // (2 of the 3 boxes sold). Taking it from the request rather than
            // re-deriving from qtyInBase avoids rounding a pack back into a
            // fraction of itself.
            sellingUnitId: originalItem?.sellingUnitId ?? null,
            sellingUnitQty: originalItem?.sellingUnitId ? Math.abs(Number(item.quantity)) : 0,
          });
        }

        if (originalFinancial) {
          originalFinancial.returnedQuantity = addMoney(originalFinancial.returnedQuantity, qtyInBase);
          originalFinancial.returnedGross = addMoney(originalFinancial.returnedGross, grossLineTotal);
          originalFinancial.returnedSubtotal = addMoney(originalFinancial.returnedSubtotal, lineTotal);
          originalFinancial.returnedGst = addMoney(originalFinancial.returnedGst, gstAmount);
          originalFinancial.returnedCost = addMoney(originalFinancial.returnedCost, lineCost);
        }
      }

      const grandTotalMagnitude = effectiveGstMode === "exclusive" ? addMoney(subtotal, totalGst) : subtotal;
      const refundAmount = round2(grandTotalMagnitude);
      const resolvedCustomerId = customerId ?? original?.customerId ?? null;
      const returnCustomer = !original && resolvedCustomerId
        ? await tx.customer.findFirst({ where: { id: resolvedCustomerId, shopId, deletedAt: null } })
        : null;

      const billNo = await generateBillNo(shopId, tx, { billType: "sales_return" });
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
        giftCardAmount: normalizedRefundMode === "gift_card" ? -refundAmount : 0,
      };

      const returnBill = await tx.bill.create({
        data: {
          shopId,
          locationId: location.id,
          billNo,
          billType: "sales_return",
          status: "active",
          customerId: resolvedCustomerId,
          customerName: original?.customerName ?? customerName ?? returnCustomer?.name ?? "Walk-in",
          buyerGstin: original?.buyerGstin ?? returnCustomer?.gstNumber ?? null,
          buyerStateCode: original?.buyerStateCode ?? returnCustomer?.stateCode ?? null,
          buyerAddress: original?.buyerAddress ?? returnCustomer?.address ?? null,
          sellerGstin: sellerIdentity.sellerGstin,
          sellerStateCode: sellerIdentity.sellerStateCode,
          sellerLegalName: sellerIdentity.sellerLegalName,
          sellerTradeName: sellerIdentity.sellerTradeName,
          sellerAddress: sellerIdentity.sellerAddress,
          sellerCity: sellerIdentity.sellerCity,
          gstMode: effectiveGstMode,
          ...negativeMoney,
          ...moneyShadows(negativeMoney),
          createdByUserId: actor?.userId ?? null,
          deviceId: actor?.deviceId ?? null,
          clientBillId: billIdentity.clientBillId,
          idempotencyKey: billIdentity.idempotencyKey,
          sourceDeviceId: billIdentity.sourceDeviceId,
          returnOfBillId: returnOfBillId ?? null,
          refundMode: normalizedRefundMode,
          items: { create: billItems },
          payments: { create: paymentRows },
        },
        include: { items: true, payments: true },
      });
      await restoreLotsForSaleReturn(tx, { originalBillId: original?.id ?? null, returnBill });

      // Restock resellable items; write off damaged ones (no restock, records the cost loss).
      for (const { product, qtyInBase, lineCost, damaged, sellingUnitId, sellingUnitQty } of restockPlan) {
        if (damaged) {
          await tx.stockLedger.create({
            data: {
              shopId,
              locationId: location.id,
              productId: product.id,
              productName: product.name,
              ...stockLedgerProvenance(actor),
              action: "damage",
              changeBaseQty: 0,
              oldStockBaseQty: await getLocationQuantity(tx, shopId, location, product),
              newStockBaseQty: await getLocationQuantity(tx, shopId, location, product),
              damageLossValue: lineCost,
              // The paise shadow has to be written alongside the decimal, exactly
              // as inventory.service.js does for a counter damage entry. Without it
              // the row reads as zero loss to any paise-based reconciliation, so
              // damage silently undercounts once those consumers become primary.
              ...moneyShadows({ damageLossValue: lineCost }),
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
        // Damaged returns took the `continue` above and never reach here, so a
        // written-off pack is correctly not put back on the shelf count.
        const stockResult = await incrementLocationInventory(tx, {
          shopId,
          location,
          product,
          quantityBase: qtyInBase,
          packs: sellingUnitId && sellingUnitQty > 0
            ? new Map([[sellingUnitId, { sellingUnit: { id: sellingUnitId }, qty: round2(sellingUnitQty) }]])
            : null,
        });
        await tx.stockLedger.create({
          data: {
            shopId,
            locationId: location.id,
            productId: product.id,
            productName: product.name,
            ...stockLedgerProvenance(actor),
            action: "return",
            changeBaseQty: qtyInBase,
            oldStockBaseQty: stockResult.oldStock,
            newStockBaseQty: stockResult.newStock,
            sellingUnitId: sellingUnitId ?? null,
            sellingUnitQty: sellingUnitId && sellingUnitQty > 0 ? round2(sellingUnitQty) : null,
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
            locationId: location.id,
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

      const issuedGiftCard = normalizedRefundMode === "gift_card"
        ? await issueReturnCreditInTransaction(tx, {
            shopId,
            customerId: resolvedCustomerId,
            billId: returnBill.id,
            locationId: location.id,
            amount: refundAmount,
            userId: actor?.userId ?? null,
            note: `Return credit for ${returnBill.billNo}`,
          })
        : null;

      await postSaleReturnLedger(tx, {
        shopId,
        bill: returnBill,
        refundMode: normalizedRefundMode,
        refundAmount,
        customerId: resolvedCustomerId,
      });

      await writeRequiredBillAudit({
        shopId,
        userId: actor.userId ?? null,
        deviceId: actor.deviceId ?? billIdentity.sourceDeviceId ?? null,
        action: "SALE_RETURN_CREATED",
        entityType: "Bill",
        entityId: returnBill.id,
        after: { billNo: returnBill.billNo, grandTotal: returnBill.grandTotal, refundMode: returnBill.refundMode },
        metadata: {
          returnOfBillId: returnBill.returnOfBillId ?? null,
          locationId: returnBill.locationId,
          giftCardIssued: Boolean(issuedGiftCard),
          reason: reason ?? null,
          idempotencyKey: returnBill.idempotencyKey ?? null,
          offlineSyncEventId: actor.syncEventId ?? null,
        },
        req: actor.req ?? null,
      }, tx);
      const deliveries = await stageIntegrationEvent(shopId, "sale.return_created", {
        id: returnBill.id,
        billNo: returnBill.billNo,
        returnOfBillId: returnBill.returnOfBillId,
        grandTotal: returnBill.grandTotal,
        refundMode: returnBill.refundMode,
        locationId: returnBill.locationId,
      }, { client: tx });

      return { bill: issuedGiftCard ? { ...returnBill, issuedGiftCard } : returnBill, deliveries };
    });
    bill = transactionResult.bill;
    integrationDeliveries = transactionResult.deliveries;
  } catch (error) {
    if (isUniqueConstraintError(error) && hasBillIdentity(billIdentity)) {
      const existingBill = await findExistingBillByIdentity(db, shopId, billIdentity);
      if (!existingBill) throw error;
      bill = existingBill;
    } else {
      throw error;
    }
  }

  await dispatchIntegrationDeliveries(integrationDeliveries);
  return bill;
}

// ─────────────────────────────────────────────────────────────
// RESTORE CANCELLED BILL — reapplies sale effects safely
// Used by offline sync RESTORE_BILL events.
// ─────────────────────────────────────────────────────────────
export async function restoreCancelledBill(shopId, billId, { reason = "Offline bill restore sync" } = {}, actor = {}) {
  const bill = await db.bill.findFirst({
    where: { id: billId, shopId },
    include: { items: true, payments: true },
  });

  if (!bill) throw new AppError("Bill not found", 404);
  if (bill.status !== "cancelled") throw new AppError("Bill is already restored or not cancelled", 409);

  return db.$transaction(async (tx) => {
    const location = await resolveOperationalLocation(shopId, bill.locationId, tx, { allowInactive: true });
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

      let stockResult;
      try {
        stockResult = await decrementLocationInventory(tx, {
          shopId,
          location,
          product,
          quantityBase: item.quantityInBaseUnit,
          allowShortfall: false,
          // Exact mirror of the cancellation that put these packs back.
          packs: packsFromBillItem(item),
        });
      } catch (error) {
        if (["INSUFFICIENT_LOCATION_STOCK", "PRODUCT_NOT_AVAILABLE"].includes(error?.code)) {
          error.code = "RESTORE_INSUFFICIENT_STOCK_CONCURRENT_MODIFICATION";
        }
        throw error;
      }

      await tx.stockLedger.create({
        data: {
          shopId,
          locationId: location.id,
          productId: product.id,
          productName: item.name,
          ...stockLedgerProvenance(actor),
          action: "restore_reversal",
          changeBaseQty: -item.quantityInBaseUnit,
          oldStockBaseQty: stockResult.oldStock,
          newStockBaseQty: stockResult.newStock,
          billId: bill.id,
          sourceDeviceId: actor.deviceId ?? null,
          sourceType: "bill_restore",
          sourceId: bill.id,
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
          locationId: location.id,
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
        waivedAmount: Number(bill.waivedAmount ?? 0),
        customerId: bill.customerId ?? null,
        restoreAt: restoredAt,
        // Un-cancelling a bill that is also in the recycle bin only puts the udhar/gift-card
        // half back; it stays off the reports until it leaves the bin. Mirrors cancelBill.
        scope: bill.deletedAt ? "retained" : "full",
      });
    }

    await reapplyBillLoyaltyInTransaction(tx, shopId, bill.id);
    await reapplyGiftCardRedemptions(tx, shopId, bill.id, { note: `Bill restored: ${reason}` });
    await reapplyBillOfferRedemption(tx, shopId, bill);
    await reapplyBillLotAllocations(tx, bill.id);

    const restored = await tx.bill.findFirst({ where: { id: billId, shopId }, include: { items: true, payments: true } });
    await writeRequiredBillAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? null,
      action: "BILL_RESTORED",
      entityType: "Bill",
      entityId: bill.id,
      before: { status: bill.status, cancelledAt: bill.cancelledAt, cancelledReason: bill.cancelledReason },
      after: { status: restored.status, cancelledAt: restored.cancelledAt, cancelledReason: restored.cancelledReason },
      metadata: { reason, billNo: bill.billNo, offlineSyncEventId: actor.syncEventId ?? null },
      req: actor.req ?? null,
    }, tx);
    return restored;
  });
}


// Rebuilds the pack breakdown for a reversal from what the sale stored on the bill
// item. BillItem.quantity is already in the chosen pack's own units (the sale
// derived qtyInBase from it), so the reversal restores exactly what was taken
// without recomputing anything from base units — which would round differently for
// packs whose conversionToBase does not divide evenly.
export function packsFromBillItem(item) {
  const packs = new Map();
  const qty = Number(item?.quantity ?? 0);
  if (item?.sellingUnitId && qty > 0) {
    packs.set(item.sellingUnitId, { sellingUnit: { id: item.sellingUnitId }, qty: round2(qty) });
  }
  return packs;
}

// Aggregates by product, because base-unit stock and the ledger are per product and
// must stay exactly as they were. The per-pack breakdown is accumulated alongside
// rather than replacing it: one bill can sell the same product in two pack sizes
// (two 70 g packets and an 8-pack box), which merges into a single base-unit
// movement but has to decrement two different packs.
export function aggregateStockUpdates(stockUpdates) {
  const byProduct = new Map();
  for (const update of stockUpdates) {
    const existing = byProduct.get(update.product.id);
    const target = existing ?? { ...update, sellingUnitQtyById: new Map() };
    if (existing) {
      existing.qtyInBase = round2(existing.qtyInBase + update.qtyInBase);
    } else {
      byProduct.set(update.product.id, target);
    }
    if (update.sellingUnit?.id && update.sellingUnitQty > 0) {
      const packs = target.sellingUnitQtyById.get(update.sellingUnit.id);
      if (packs) {
        packs.qty = round2(packs.qty + update.sellingUnitQty);
      } else {
        target.sellingUnitQtyById.set(update.sellingUnit.id, {
          sellingUnit: update.sellingUnit,
          qty: round2(update.sellingUnitQty),
        });
      }
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
  const include = { items: BILL_ITEMS_WITH_OPTIONS, payments: true };
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

    // The counter intentionally permits negative inventory so sales can continue
    // before a delayed stock-in is recorded. Keep the fallback atomic: a
    // read-then-absolute-write loses deductions when two bills arrive together.
    const shortfallUpdate = await tx.product.updateMany({
      where: { id: product.id, shopId, deletedAt: null },
      data: { stockBaseQty: { decrement: qtyInBase } },
    });
    if (shortfallUpdate.count !== 1) {
      const err = new AppError(`Product "${product.name}" is no longer available`, 409);
      err.code = "PRODUCT_NOT_AVAILABLE";
      throw err;
    }

    const fresh = await tx.product.findFirst({
      where: { id: product.id, shopId, deletedAt: null },
      select: { stockBaseQty: true },
    });
    if (!fresh) {
      const err = new AppError(`Product "${product.name}" is no longer available`, 409);
      err.code = "PRODUCT_NOT_AVAILABLE";
      throw err;
    }
    const newStock = round2(fresh.stockBaseQty);
    const oldStock = round2(newStock + qtyInBase);
    const shortfallBaseQty = round2(Math.max(0, -newStock));
    return { oldStock, newStock, shortfallBaseQty };
  }

  const freshProduct = await tx.product.findFirst({
    where: { id: product.id, shopId },
    select: { stockBaseQty: true },
  });
  const newStock = round2(freshProduct?.stockBaseQty ?? product.stockBaseQty - qtyInBase);
  const oldStock = round2(newStock + qtyInBase);
  return { oldStock, newStock, shortfallBaseQty: 0 };
}
