// Read-only context bundles for audit evaluation.
//
// A context bundle is everything the deterministic rules need to evaluate one
// entity: the entity itself, its related canonical rows, shop settings and
// baselines. Building it performs ONLY reads — this module must never write.
// Every query is shopId-scoped; cross-shop rows are surfaced as findings by
// the sync-integrity rules, never silently followed.
import crypto from "node:crypto";
import db from "../../db.js";
import { ENTITY_TYPES, EVENT_TYPES } from "./assurance.constants.js";
import { getShopBaselines } from "./baseline.service.js";

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export class AuditContextError extends Error {
  constructor(message, code = "AUDIT_CONTEXT_ERROR") {
    super(message);
    this.code = code;
  }
}

/**
 * Deterministic hash of the canonical inputs of an evaluation. Recorded on
 * AuditEvaluation so any score can be reproduced and unchanged entities can be
 * skipped cheaply on re-runs.
 */
export function computeInputHash(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload, jsonSafe))
    .digest("hex");
}

function jsonSafe(_key, value) {
  if (typeof value === "bigint") return value.toString();
  return value;
}

export async function buildContext(shopId, entityType, entityId, { client = db } = {}) {
  switch (entityType) {
    case ENTITY_TYPES.BILL:
      return buildBillContext(shopId, entityId, client);
    case ENTITY_TYPES.CUSTOMER:
      return buildCustomerContext(shopId, entityId, client);
    case ENTITY_TYPES.PRODUCT:
      return buildProductContext(shopId, entityId, client);
    case ENTITY_TYPES.PURCHASE:
      return buildPurchaseContext(shopId, entityId, client);
    case ENTITY_TYPES.EXPENSE:
      return buildExpenseContext(shopId, entityId, client);
    case ENTITY_TYPES.DAILY_CLOSING:
      return buildDailyClosingContext(shopId, entityId, client);
    case ENTITY_TYPES.SYNC_EVENT:
      return buildSyncEventContext(shopId, entityId, client);
    default:
      throw new AuditContextError(`Unknown audit entity type: ${entityType}`, "UNKNOWN_ENTITY_TYPE");
  }
}

async function loadShopSettings(shopId, client) {
  const shop = await client.shop.findUnique({ where: { id: shopId }, select: { settingsJson: true } });
  if (!shop) throw new AuditContextError("Shop not found", "SHOP_NOT_FOUND");
  let settings = {};
  try {
    settings = JSON.parse(shop.settingsJson || "{}");
  } catch {
    settings = {};
  }
  const audit = settings.audit && typeof settings.audit === "object" ? settings.audit : {};
  return {
    // Owner-configurable thresholds with safe defaults.
    maxDiscountPercent: numberOr(audit.maxDiscountPercent, 20),
    belowCostTolerancePercent: numberOr(audit.belowCostTolerancePercent, 2),
    largeAdjustmentPaise: numberOr(audit.largeAdjustmentPaise, 500000), // ₹5,000
    expenseReceiptRequiredAbovePaise: numberOr(audit.expenseReceiptRequiredAbovePaise, 100000), // ₹1,000
    purchaseInvoiceRequiredAbovePaise: numberOr(audit.purchaseInvoiceRequiredAbovePaise, 100000),
    udharAgeingLimitDays: numberOr(audit.udharAgeingLimitDays, 90),
    creditLimitPaise: numberOr(audit.creditLimitPaise, 0), // 0 = no limit configured
    closingDifferenceAlertPaise: numberOr(audit.closingDifferenceAlertPaise, 20000), // ₹200
    staffCancellationRateAlert: numberOr(audit.staffCancellationRateAlert, 0.15),
  };
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ── BILL ──────────────────────────────────────────────────────
async function buildBillContext(shopId, billId, client) {
  const bill = await client.bill.findFirst({
    where: { id: billId, shopId },
    include: { items: true, payments: true },
  });
  if (!bill) throw new AuditContextError("Bill not found in this shop", "ENTITY_NOT_FOUND");

  const [settings, baselines] = await Promise.all([
    loadShopSettings(shopId, client),
    getShopBaselines(shopId, { client }),
  ]);

  const productIds = [...new Set(bill.items.map((i) => i.productId).filter(Boolean))];
  const createdAt = new Date(bill.createdAt);
  const windowStart = new Date(createdAt.getTime() - DUPLICATE_WINDOW_MS);
  const windowEnd = new Date(createdAt.getTime() + DUPLICATE_WINDOW_MS);
  const dayStart = startOfDay(createdAt);
  const dayEnd = endOfDay(createdAt);

  const [
    products,
    udharRows,
    stockRows,
    customer,
    duplicateCandidates,
    sameBillNo,
    closingSnapshot,
    syncEvents,
    auditLogs,
    staffRecentBills,
    upiReferenceReuse,
    financialLedgerRows,
    createdByUser,
  ] = await Promise.all([
    // Deliberately unscoped by shopId: a product row that resolves to another
    // shop is exactly what the cross-shop-reference rule must detect. Only
    // identity columns are selected, so no other tenant's data is exposed.
    productIds.length
      ? client.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, shopId: true, name: true, isLooseItem: true, baseUnit: true, deletedAt: true, costPerRateUnit: true },
        })
      : Promise.resolve([]),
    client.udharLedger.findMany({ where: { shopId, billId: bill.id } }),
    client.stockLedger.findMany({ where: { shopId, billId: bill.id } }),
    // Also unscoped on purpose, for the same cross-shop check.
    bill.customerId
      ? client.customer.findFirst({
          where: { id: bill.customerId },
          select: { id: true, shopId: true, name: true, mobile: true, udharAmount: true, deletedAt: true },
        })
      : Promise.resolve(null),
    client.bill.findMany({
      where: {
        shopId,
        id: { not: bill.id },
        customerId: bill.customerId ?? undefined,
        customerName: bill.customerId ? undefined : bill.customerName,
        grandTotal: bill.grandTotal,
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      include: { items: { select: { productId: true, quantity: true } } },
      take: 10,
    }),
    client.bill.findMany({
      where: { shopId, billNo: bill.billNo, id: { not: bill.id } },
      select: { id: true, billNo: true, createdAt: true },
      take: 5,
    }),
    client.dailyClosingSnapshot.findFirst({
      where: { shopId, date: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: "desc" },
    }),
    bill.idempotencyKey
      ? client.offlineSyncEvent.findMany({
          where: { shopId, requestJson: { contains: bill.idempotencyKey } },
          select: { id: true, eventId: true, status: true, attempts: true, type: true, createdAt: true },
          take: 20,
        })
      : Promise.resolve([]),
    client.auditLog.findMany({
      where: { shopId, entityType: "Bill", entityId: bill.id },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    bill.createdByUserId
      ? client.bill.findMany({
          where: {
            shopId,
            createdByUserId: bill.createdByUserId,
            createdAt: { gte: new Date(createdAt.getTime() - 30 * 24 * 60 * 60 * 1000) },
          },
          select: { id: true, status: true },
        })
      : Promise.resolve([]),
    (async () => {
      const references = bill.payments
        .map((p) => p.providerReference)
        .filter((ref) => typeof ref === "string" && ref.trim().length >= 6);
      if (!references.length) return [];
      return client.payment.findMany({
        where: {
          providerReference: { in: references },
          billId: { not: bill.id },
          bill: { shopId },
        },
        select: { id: true, billId: true, providerReference: true, amount: true, createdAt: true },
        take: 20,
      });
    })(),
    client.financialLedger.findMany({
      where: { shopId, billId: bill.id },
      select: { id: true, entryType: true, direction: true, amountPaise: true, sourceType: true, businessDate: true },
    }),
    bill.createdByUserId
      ? client.user.findFirst({
          where: { id: bill.createdByUserId, shopId },
          select: { id: true, role: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  const events = deriveBillEvents(bill);

  return {
    shopId,
    entityType: ENTITY_TYPES.BILL,
    entityId: bill.id,
    events,
    settings,
    baselines,
    bill,
    customer,
    products: new Map(products.map((p) => [p.id, p])),
    udharRows,
    stockRows,
    duplicateCandidates,
    sameBillNo,
    closingSnapshot,
    syncEvents,
    auditLogs,
    staffRecentBills,
    upiReferenceReuse,
    financialLedgerRows,
    createdByUser,
    inputHash: computeInputHash({
      bill,
      items: bill.items,
      payments: bill.payments,
      udharRows,
      stockRows: stockRows.map((r) => ({ id: r.id, action: r.action, changeBaseQty: r.changeBaseQty })),
      duplicateIds: duplicateCandidates.map((b) => b.id),
      closingLockedAt: closingSnapshot?.lockedAt ?? null,
      ledgerRows: financialLedgerRows.map((r) => `${r.entryType}:${r.amountPaise}`),
    }),
  };
}

function deriveBillEvents(bill) {
  const events = [];
  if (bill.billType === "sales_return") events.push(EVENT_TYPES.SALE_RETURNED);
  else events.push(EVENT_TYPES.SALE_CREATED);
  if (bill.status === "cancelled") events.push(EVENT_TYPES.SALE_CANCELLED);
  if (bill.payments?.some((p) => p.mode !== "credit")) events.push(EVENT_TYPES.PAYMENT_RECEIVED);
  if (Number(bill.creditAmount ?? 0) > 0) events.push(EVENT_TYPES.CUSTOMER_CREDIT_CREATED);
  if (Number(bill.discount ?? 0) > 0 || bill.items?.some((i) => Number(i.lineDiscount ?? 0) > 0)) {
    events.push(EVENT_TYPES.DISCOUNT_APPLIED);
  }
  return events;
}

// ── CUSTOMER ──────────────────────────────────────────────────
async function buildCustomerContext(shopId, customerId, client) {
  const customer = await client.customer.findFirst({ where: { id: customerId, shopId } });
  if (!customer) throw new AuditContextError("Customer not found in this shop", "ENTITY_NOT_FOUND");

  const [settings, baselines, ledger, creditBills, similarCustomers] = await Promise.all([
    loadShopSettings(shopId, client),
    getShopBaselines(shopId, { client }),
    client.udharLedger.findMany({
      where: { shopId, customerId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    client.bill.findMany({
      where: { shopId, customerId, creditAmount: { gt: 0 } },
      select: { id: true, billNo: true, status: true, creditAmount: true, grandTotal: true, createdAt: true },
    }),
    // Duplicate-identity candidates. Mobile is unique per shop among live rows,
    // so exact-mobile matches only surface soft-deleted twins; same-name rows
    // are the realistic duplicate signal. Comparison happens in the rule.
    client.customer.findMany({
      where: {
        shopId,
        id: { not: customerId },
        OR: [
          { name: customer.name },
          ...(customer.mobile ? [{ mobile: customer.mobile }] : []),
        ],
      },
      select: { id: true, name: true, mobile: true, deletedAt: true, udharAmount: true },
      take: 10,
    }),
  ]);

  const billIds = [...new Set(ledger.map((l) => l.billId).filter(Boolean))];
  const referencedBills = billIds.length
    ? await client.bill.findMany({
        where: { id: { in: billIds } },
        select: { id: true, shopId: true, status: true, creditAmount: true, billNo: true },
      })
    : [];

  return {
    shopId,
    entityType: ENTITY_TYPES.CUSTOMER,
    entityId: customer.id,
    events: [EVENT_TYPES.CUSTOMER_CREDIT_CREATED, EVENT_TYPES.CUSTOMER_CREDIT_ADJUSTED],
    settings,
    baselines,
    customer,
    ledger,
    creditBills,
    referencedBills: new Map(referencedBills.map((b) => [b.id, b])),
    similarCustomers,
    inputHash: computeInputHash({ customer, ledger, creditBills }),
  };
}

// ── PRODUCT (inventory) ───────────────────────────────────────
async function buildProductContext(shopId, productId, client) {
  const product = await client.product.findFirst({ where: { id: productId, shopId } });
  if (!product) throw new AuditContextError("Product not found in this shop", "ENTITY_NOT_FOUND");

  const [settings, baselines, movements, locationStocks, lockedClosings] = await Promise.all([
    loadShopSettings(shopId, client),
    getShopBaselines(shopId, { client }),
    client.stockLedger.findMany({
      where: { shopId, productId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    client.locationStock.findMany({ where: { shopId, productId } }),
    client.dailyClosingSnapshot.findMany({
      where: { shopId, lockedAt: { not: null } },
      select: { id: true, date: true, lockedAt: true },
      orderBy: { date: "desc" },
      take: 120,
    }),
  ]);

  const billIds = [...new Set(movements.map((m) => m.billId).filter(Boolean))];
  const referencedBills = billIds.length
    ? await client.bill.findMany({
        where: { id: { in: billIds } },
        select: { id: true, shopId: true, status: true, billType: true },
      })
    : [];

  return {
    shopId,
    entityType: ENTITY_TYPES.PRODUCT,
    entityId: product.id,
    events: [EVENT_TYPES.STOCK_INCREASED, EVENT_TYPES.STOCK_DECREASED, EVENT_TYPES.STOCK_CORRECTED],
    settings,
    baselines,
    product,
    movements,
    locationStocks,
    lockedClosings,
    referencedBills: new Map(referencedBills.map((b) => [b.id, b])),
    inputHash: computeInputHash({
      product: { id: product.id, stockBaseQty: product.stockBaseQty, deletedAt: product.deletedAt },
      movements: movements.map((m) => ({ id: m.id, action: m.action, changeBaseQty: m.changeBaseQty, billId: m.billId, sourceType: m.sourceType, sourceId: m.sourceId })),
      locationStocks,
    }),
  };
}

// ── PURCHASE ──────────────────────────────────────────────────
// entityId may be a PurchaseReceipt id (PO flow) or a PurchaseHistory id
// (quick purchase). The context normalizes both shapes.
async function buildPurchaseContext(shopId, entityId, client) {
  const [settings, baselines] = await Promise.all([
    loadShopSettings(shopId, client),
    getShopBaselines(shopId, { client }),
  ]);

  const receipt = await client.purchaseReceipt.findFirst({
    where: { id: entityId, shopId },
    include: { items: true, purchaseOrder: { include: { items: true } }, supplier: true },
  });

  if (receipt) {
    const [historyRows, stockRows, duplicateInvoices] = await Promise.all([
      client.purchaseHistory.findMany({ where: { shopId, purchaseReceiptId: receipt.id } }),
      client.stockLedger.findMany({ where: { shopId, sourceType: "purchase_receipt", sourceId: receipt.id } }),
      receipt.supplierInvoiceNumber
        ? client.purchaseReceipt.findMany({
            where: {
              shopId,
              id: { not: receipt.id },
              supplierInvoiceNumber: receipt.supplierInvoiceNumber,
              ...(receipt.supplierId ? { supplierId: receipt.supplierId } : {}),
            },
            select: { id: true, receiptNumber: true, supplierInvoiceNumber: true, totalAmount: true, createdAt: true },
            take: 10,
          })
        : Promise.resolve([]),
    ]);

    const [supplierHistory, sameAmountSameDay, returns, closingSnapshot, priorNegativeSales] = await Promise.all([
      receipt.supplierId
        ? client.purchaseHistory.findMany({
            where: { shopId, supplierId: receipt.supplierId },
            select: { totalCost: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 200,
          })
        : Promise.resolve([]),
      client.purchaseReceipt.findMany({
        where: {
          shopId,
          id: { not: receipt.id },
          totalAmount: receipt.totalAmount,
          ...(receipt.supplierId ? { supplierId: receipt.supplierId } : {}),
          createdAt: { gte: startOfDay(receipt.createdAt), lte: endOfDay(receipt.createdAt) },
        },
        select: { id: true, receiptNumber: true, totalAmount: true, createdAt: true, supplierInvoiceNumber: true },
        take: 10,
      }),
      client.purchaseReturn.findMany({
        where: { shopId, purchaseReceiptId: receipt.id },
        include: { items: true },
      }),
      client.dailyClosingSnapshot.findFirst({
        where: { shopId, date: { gte: startOfDay(receipt.createdAt), lte: endOfDay(receipt.createdAt) } },
        orderBy: { createdAt: "desc" },
      }),
      (async () => {
        const productIds = [...new Set(receipt.items.map((item) => item.productId))];
        if (!productIds.length) return [];
        return client.stockLedger.findMany({
          where: {
            shopId,
            productId: { in: productIds },
            action: "sale",
            newStockBaseQty: { lt: 0 },
            createdAt: { lt: receipt.createdAt },
          },
          select: { id: true, productId: true, productName: true, newStockBaseQty: true, createdAt: true },
          take: 20,
        });
      })(),
    ]);

    return {
      shopId,
      entityType: ENTITY_TYPES.PURCHASE,
      entityId: receipt.id,
      purchaseKind: "receipt",
      events: [EVENT_TYPES.PURCHASE_CREATED, EVENT_TYPES.STOCK_INCREASED, ...(returns.length ? [EVENT_TYPES.PURCHASE_RETURNED] : [])],
      settings,
      baselines,
      receipt,
      supplier: receipt.supplier ?? null,
      historyRows,
      stockRows,
      duplicateInvoices,
      supplierHistory,
      sameAmountSameDay,
      returns,
      closingSnapshot,
      priorNegativeSales,
      inputHash: computeInputHash({ receipt, items: receipt.items, historyRows: historyRows.map((h) => h.id), stockRows: stockRows.map((s) => s.id), returnIds: returns.map((r) => r.id) }),
    };
  }

  const history = await client.purchaseHistory.findFirst({
    where: { id: entityId, shopId },
    include: { product: true, supplier: true },
  });
  if (!history) throw new AuditContextError("Purchase not found in this shop", "ENTITY_NOT_FOUND");

  const [stockRows, duplicateInvoices, productHistory, sameAmountSameDay, closingSnapshot, priorNegativeSales] = await Promise.all([
    client.stockLedger.findMany({
      where: {
        shopId,
        productId: history.productId,
        action: "purchase",
        createdAt: {
          gte: new Date(new Date(history.createdAt).getTime() - DUPLICATE_WINDOW_MS),
          lte: new Date(new Date(history.createdAt).getTime() + DUPLICATE_WINDOW_MS),
        },
      },
    }),
    history.invoiceNumber
      ? client.purchaseHistory.findMany({
          where: {
            shopId,
            id: { not: history.id },
            invoiceNumber: history.invoiceNumber,
            supplierName: history.supplierName,
          },
          select: { id: true, invoiceNumber: true, billAmount: true, createdAt: true },
          take: 10,
        })
      : Promise.resolve([]),
    client.purchaseHistory.findMany({
      where: { shopId, productId: history.productId, id: { not: history.id } },
      select: { pricePerRateUnit: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    client.purchaseHistory.findMany({
      where: {
        shopId,
        id: { not: history.id },
        billAmount: history.billAmount,
        supplierName: history.supplierName,
        createdAt: { gte: startOfDay(history.createdAt), lte: endOfDay(history.createdAt) },
      },
      select: { id: true, billAmount: true, invoiceNumber: true, createdAt: true },
      take: 10,
    }),
    client.dailyClosingSnapshot.findFirst({
      where: { shopId, date: { gte: startOfDay(history.createdAt), lte: endOfDay(history.createdAt) } },
      orderBy: { createdAt: "desc" },
    }),
    client.stockLedger.findMany({
      where: {
        shopId,
        productId: history.productId,
        action: "sale",
        newStockBaseQty: { lt: 0 },
        createdAt: { lt: history.createdAt },
      },
      select: { id: true, productId: true, productName: true, newStockBaseQty: true, createdAt: true },
      take: 20,
    }),
  ]);

  return {
    shopId,
    entityType: ENTITY_TYPES.PURCHASE,
    entityId: history.id,
    purchaseKind: "history",
    events: [EVENT_TYPES.PURCHASE_CREATED, EVENT_TYPES.STOCK_INCREASED],
    settings,
    baselines,
    history,
    supplier: history.supplier ?? null,
    stockRows,
    duplicateInvoices,
    productHistory,
    sameAmountSameDay,
    closingSnapshot,
    priorNegativeSales,
    returns: [],
    inputHash: computeInputHash({ history, stockRows: stockRows.map((s) => s.id) }),
  };
}

// ── EXPENSE ───────────────────────────────────────────────────
async function buildExpenseContext(shopId, expenseId, client) {
  const expense = await client.expense.findFirst({ where: { id: expenseId, shopId } });
  if (!expense) throw new AuditContextError("Expense not found in this shop", "ENTITY_NOT_FOUND");

  const spentAt = new Date(expense.spentAt);
  const [settings, baselines, duplicates, closingSnapshot, categoryExpenses, recentExpenses] = await Promise.all([
    loadShopSettings(shopId, client),
    getShopBaselines(shopId, { client }),
    client.expense.findMany({
      where: {
        shopId,
        id: { not: expense.id },
        deletedAt: null,
        amount: expense.amount,
        category: expense.category,
        spentAt: {
          gte: new Date(spentAt.getTime() - 24 * 60 * 60 * 1000),
          lte: new Date(spentAt.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      select: { id: true, title: true, amount: true, spentAt: true, vendor: true },
      take: 10,
    }),
    client.dailyClosingSnapshot.findFirst({
      where: { shopId, date: { gte: startOfDay(spentAt), lte: endOfDay(spentAt) } },
      orderBy: { createdAt: "desc" },
    }),
    client.expense.findMany({
      where: { shopId, category: expense.category, deletedAt: null, id: { not: expense.id } },
      select: { amount: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    client.expense.findMany({
      where: {
        shopId,
        deletedAt: null,
        spentAt: { gte: new Date(spentAt.getTime() - 90 * 24 * 60 * 60 * 1000), lte: spentAt },
      },
      select: { id: true, amount: true, paymentMode: true, category: true, spentAt: true, vendor: true },
      orderBy: { spentAt: "desc" },
      take: 500,
    }),
  ]);

  return {
    shopId,
    entityType: ENTITY_TYPES.EXPENSE,
    entityId: expense.id,
    events: [EVENT_TYPES.EXPENSE_CREATED],
    settings,
    baselines,
    expense,
    duplicates,
    closingSnapshot,
    categoryExpenses,
    recentExpenses,
    inputHash: computeInputHash({ expense, duplicateIds: duplicates.map((d) => d.id), closingLockedAt: closingSnapshot?.lockedAt ?? null }),
  };
}

// ── DAILY CLOSING ─────────────────────────────────────────────
async function buildDailyClosingContext(shopId, snapshotId, client) {
  const snapshot = await client.dailyClosingSnapshot.findFirst({ where: { id: snapshotId, shopId } });
  if (!snapshot) throw new AuditContextError("Daily closing snapshot not found in this shop", "ENTITY_NOT_FOUND");

  const dayStart = startOfDay(new Date(snapshot.date));
  const dayEnd = endOfDay(new Date(snapshot.date));

  const [settings, baselines, bills, payments, udharPayments, expenses, lateSyncEvents] = await Promise.all([
    loadShopSettings(shopId, client),
    getShopBaselines(shopId, { client }),
    client.bill.findMany({
      where: { shopId, createdAt: { gte: dayStart, lte: dayEnd } },
      select: { id: true, billNo: true, billType: true, status: true, grandTotal: true, paidAmount: true, creditAmount: true, createdAt: true, updatedAt: true },
    }),
    client.payment.findMany({
      where: { bill: { shopId }, createdAt: { gte: dayStart, lte: dayEnd } },
      select: { id: true, billId: true, mode: true, amount: true, status: true, providerReference: true },
    }),
    client.udharLedger.findMany({
      where: { shopId, type: "payment", createdAt: { gte: dayStart, lte: dayEnd } },
      select: { id: true, amount: true, mode: true, reversedAt: true, billId: true },
    }),
    client.expense.findMany({
      where: { shopId, deletedAt: null, spentAt: { gte: dayStart, lte: dayEnd } },
      select: { id: true, amount: true, paymentMode: true, spentAt: true, createdAt: true },
    }),
    snapshot.lockedAt
      ? client.bill.findMany({
          where: { shopId, createdAt: { gte: dayStart, lte: dayEnd }, updatedAt: { gt: snapshot.lockedAt } },
          select: { id: true, billNo: true, updatedAt: true, status: true },
          take: 25,
        })
      : Promise.resolve([]),
  ]);

  return {
    shopId,
    entityType: ENTITY_TYPES.DAILY_CLOSING,
    entityId: snapshot.id,
    events: [EVENT_TYPES.DAILY_CLOSING_COMPLETED],
    settings,
    baselines,
    snapshot,
    bills,
    payments,
    udharPayments,
    expenses,
    lateSyncEvents,
    inputHash: computeInputHash({
      snapshot,
      billIds: bills.map((b) => `${b.id}:${b.status}`),
      paymentIds: payments.map((p) => p.id),
      expenseIds: expenses.map((e) => e.id),
    }),
  };
}

// ── SYNC EVENT ────────────────────────────────────────────────
async function buildSyncEventContext(shopId, eventRowId, client) {
  const event = await client.offlineSyncEvent.findFirst({ where: { id: eventRowId, shopId } });
  if (!event) throw new AuditContextError("Sync event not found in this shop", "ENTITY_NOT_FOUND");

  const [settings, baselines, sameEventId, conflicts] = await Promise.all([
    loadShopSettings(shopId, client),
    getShopBaselines(shopId, { client }),
    client.offlineSyncEvent.findMany({
      where: { shopId, eventId: event.eventId, id: { not: event.id } },
      select: { id: true, status: true, attempts: true, createdAt: true },
      take: 10,
    }),
    client.syncConflict.findMany({
      where: { shopId, sourceEventId: event.eventId },
      take: 10,
    }),
  ]);

  return {
    shopId,
    entityType: ENTITY_TYPES.SYNC_EVENT,
    entityId: event.id,
    events: [EVENT_TYPES.OFFLINE_EVENT_SYNCED, ...(conflicts.length ? [EVENT_TYPES.SYNC_CONFLICT_DETECTED] : [])],
    settings,
    baselines,
    syncEvent: event,
    sameEventId,
    conflicts,
    inputHash: computeInputHash({ event, sameEventIdIds: sameEventId.map((e) => e.id), conflictIds: conflicts.map((c) => c.id) }),
  };
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
