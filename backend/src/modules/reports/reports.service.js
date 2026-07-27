import db from "../../db.js";
import { dateRangeForDateOnly, daysBetweenInclusive, endOfZonedDay, formatDateInTimeZone, getDateRange, startOfZonedDay } from "../../utils/dates.js";
import { addMoney, round2, subtractMoney, sumMoney } from "../../utils/money.js";
import { AppError } from "../../middleware/error.js";
import { env } from "../../config/env.js";
import { getReportRangeLimit } from "../feature-gates/featureGate.service.js";
import { getLocationQuantity, resolveOperationalLocation } from "../stores/location-context.service.js";
import { validateGstin } from "../../utils/gst.js";
import { baseQtyToRateQty } from "../../utils/units.js";

// Estimates (kacha bills) are full sales — stock, tender, udhar — so they count in every
// sales/cash/P&L report. The one exception is GST: an estimate is not a tax document, so the
// GST report keeps its own estimate-excluding filter below.
const REAL_SALE_BILL_FILTER = { status: "active" };
const GST_BILL_FILTER = { status: "active", billType: { not: "estimate" } };
const DEFAULT_TOP_LIMIT = 20;
const MAX_TOP_LIMIT = 100;

function toPaise(value) {
  return Math.round(Number(value || 0) * 100);
}

function fromPaise(value) {
  return round2(Number(value || 0) / 100);
}

function startOfDay(date) {
  return startOfZonedDay(date, env.DAILY_CLOSING_TIMEZONE);
}

function endOfDay(date) {
  return endOfZonedDay(date, env.DAILY_CLOSING_TIMEZONE);
}

function parseDateOnly(dateString) {
  try {
    return dateRangeForDateOnly(dateString, env.DAILY_CLOSING_TIMEZONE).start;
  } catch {
    const err = new AppError("date must be YYYY-MM-DD", 400);
    err.code = "INVALID_REPORT_DATE";
    throw err;
  }
}

// 1..12 month of a timestamp in the shop timezone. Date.getMonth() would use the server's local
// clock, mis-bucketing rows within the UTC offset (5.5h for IST) of a month boundary.
function monthInShopTz(date, timeZone = env.DAILY_CLOSING_TIMEZONE) {
  return Number(formatDateInTimeZone(new Date(date), timeZone).slice(5, 7));
}

// Start-of-day (shop tz) for `daysBack` days before `now`, computed on the shop-tz calendar via
// UTC date math. The old `Date.setDate(getDate() - n)` mutated using the SERVER's local calendar
// and only happened to work because IST has no DST; this is robust regardless of the server clock.
function zonedDayStartDaysAgo(now, daysBack, timeZone = env.DAILY_CLOSING_TIMEZONE) {
  const [y, m, d] = formatDateInTimeZone(now, timeZone).split("-").map(Number);
  const key = new Date(Date.UTC(y, m - 1, d - daysBack)).toISOString().slice(0, 10);
  return dateRangeForDateOnly(key, timeZone).start;
}

function normalizeDateRange({ range, from, to } = {}) {
  const now = new Date();
  if (range === "today" || range === "daily") {
    return { start: startOfDay(now), end: endOfDay(now), label: "today" };
  }
  if (range === "7d") {
    return { start: zonedDayStartDaysAgo(now, 6), end: endOfDay(now), label: "7d" };
  }
  if (range === "30d") {
    return { start: zonedDayStartDaysAgo(now, 29), end: endOfDay(now), label: "30d" };
  }
  if (from || to) {
    if (!from || !to) {
      const err = new AppError("Both from and to are required for a custom report range", 400);
      err.code = "REPORT_RANGE_REQUIRED";
      throw err;
    }
    return { start: startOfDay(new Date(from)), end: endOfDay(new Date(to)), label: "custom" };
  }
  return { start: startOfDay(now), end: endOfDay(now), label: "today" };
}

async function enforceReportRangeLimit(shopId, { start, end }, requestedLabel = "custom") {
  const limit = await getReportRangeLimit(shopId);
  const days = daysBetweenInclusive(start, end);
  if (days > limit.days) {
    const err = new AppError(`Report range exceeds current plan limit of ${limit.days} days`, 403);
    err.code = "REPORT_RANGE_LIMIT_EXCEEDED";
    err.meta = { requestedDays: days, allowedDays: limit.days, feature: limit.feature, range: requestedLabel };
    throw err;
  }
  return { days, limit };
}

function activeSalesWhere(shopId, start, end, locationId = null) {
  return {
    shopId,
    ...(locationId && { locationId }),
    ...REAL_SALE_BILL_FILTER,
    businessDate: { gte: start, lte: end },
  };
}

function groupByDay(date) {
  return formatDateInTimeZone(date, env.DAILY_CLOSING_TIMEZONE);
}

function maskPhone(phone) {
  if (!phone) return "";
  const s = String(phone);
  if (s.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

function resolveBucket(ageDays) {
  if (ageDays <= 7) return "0_7_days";
  if (ageDays <= 30) return "8_30_days";
  if (ageDays <= 60) return "31_60_days";
  return "60_plus_days";
}

function riskLevelForBucket(bucket) {
  if (bucket === "60_plus_days") return "high";
  if (bucket === "31_60_days") return "medium";
  return "low";
}

function sumPaymentsByMode(payments, mode) {
  return sumMoney(payments.filter((p) => p.mode === mode).map((p) => p.amount));
}

function paymentModesForBill(bill) {
  const modes = bill.payments.map((p) => ({ mode: p.mode, amount: p.amount }));
  if (Number(bill.creditAmount || 0) > 0) {
    modes.push({ mode: "credit", amount: bill.creditAmount });
  }
  return modes;
}

async function countPendingSync(shopId) {
  try {
    return await db.offlineSyncEvent.count({
      where: { shopId, status: { not: "synced" } },
    });
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────
// DAILY CLOSING — shopkeeper dashboard report
// ─────────────────────────────────────────────────────────────
export async function getDailyClosing(shopId, { date, locationId, allLocations = false } = {}) {
  const day = date ? parseDateOnly(date) : new Date();
  const start = startOfDay(day);
  const end = endOfDay(day);
  const dateKey = date ?? formatDateInTimeZone(start, env.DAILY_CLOSING_TIMEZONE);

  const [activeBills, cancelledBills, roughBillsCount, oldUdharRecovered, pendingSyncCount, lowStockProducts, topProducts] = await Promise.all([
    db.bill.findMany({
      where: activeSalesWhere(shopId, start, end, locationId),
      include: { payments: true },
    }),
    db.bill.findMany({
      where: { shopId, ...(locationId && { locationId }), status: "cancelled", businessDate: { gte: start, lte: end } },
      select: { id: true, grandTotal: true },
    }),
    db.bill.count({ where: { shopId, ...(locationId && { locationId }), billType: "estimate", businessDate: { gte: start, lte: end } } }),
    db.udharLedger.findMany({
      where: { shopId, ...(locationId && { locationId }), type: "payment", mode: { in: ["cash", "upi", "bank"] }, businessDate: { gte: start, lte: end }, reversedAt: null },
      select: { amount: true, mode: true },
    }),
    countPendingSync(shopId),
    db.product.findMany({
      where: { shopId, deletedAt: null, lowStockThreshold: { gt: 0 } },
      select: { id: true, name: true, stockBaseQty: true, lowStockThreshold: true, baseUnit: true },
      orderBy: { stockBaseQty: "asc" },
      take: 20,
    }),
    getTopProducts(shopId, { from: dateKey, to: dateKey, limit: 5, includeProfit: false, locationId }),
  ]);

  const reportLocation = allLocations ? null : await resolveOperationalLocation(shopId, locationId);
  const lowStockAtLocation = allLocations
    ? lowStockProducts
    : await Promise.all(lowStockProducts.map(async (product) => ({
      ...product,
      stockBaseQty: await getLocationQuantity(db, shopId, reportLocation, product),
    })));

  const activePayments = activeBills.flatMap((b) => b.payments);
  const billCash = sumPaymentsByMode(activePayments, "cash");
  const billUpi = sumPaymentsByMode(activePayments, "upi");
  const billBank = sumPaymentsByMode(activePayments, "bank");
  const oldUdharCash = sumMoney(oldUdharRecovered.filter((u) => u.mode === "cash").map((u) => u.amount));
  const oldUdharUpi = sumMoney(oldUdharRecovered.filter((u) => u.mode === "upi").map((u) => u.amount));
  const oldUdharBank = sumMoney(oldUdharRecovered.filter((u) => u.mode === "bank").map((u) => u.amount));
  const cashReceived = addMoney(billCash, oldUdharCash);
  const upiReceived = addMoney(billUpi, oldUdharUpi);
  const bankReceived = addMoney(billBank, oldUdharBank);

  return {
    date: dateKey,
    totalSalesPaise: toPaise(sumMoney(activeBills.map((b) => b.grandTotal))),
    cashReceivedPaise: toPaise(cashReceived),
    upiReceivedPaise: toPaise(upiReceived),
    bankReceivedPaise: toPaise(bankReceived),
    udharGivenPaise: toPaise(sumMoney(activeBills.map((b) => b.creditAmount))),
    oldUdharRecoveredPaise: toPaise(sumMoney(oldUdharRecovered.map((u) => u.amount))),
    expectedCashPaise: toPaise(cashReceived),
    totalBills: activeBills.length,
    cancelledBills: cancelledBills.length,
    roughBills: roughBillsCount,
    topProducts,
    location: reportLocation
      ? { id: reportLocation.id, code: reportLocation.code, name: reportLocation.name }
      : { id: "all", code: "ALL", name: "All locations" },
    lowStock: lowStockAtLocation
      .filter((p) => Number(p.stockBaseQty) <= Number(p.lowStockThreshold))
      .map((p) => ({
        productId: p.id,
        productName: p.name,
        stockBaseQty: p.stockBaseQty,
        lowStockThreshold: p.lowStockThreshold,
        baseUnit: p.baseUnit,
      })),
    pendingSyncCount,
    localEstimate: false,
    generatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
// SALES SUMMARY — today/7d/30d/custom with plan range limits
// ─────────────────────────────────────────────────────────────
export async function getSalesSummary(shopId, { range, from, to, locationId, includeProfit = false } = {}) {
  const normalized = normalizeDateRange({ range, from, to });
  await enforceReportRangeLimit(shopId, normalized, normalized.label);
  const { start, end } = normalized;

  const [bills, cancelledBills] = await Promise.all([
    db.bill.findMany({
      where: activeSalesWhere(shopId, start, end, locationId),
      include: { payments: true },
      orderBy: { businessDate: "asc" },
    }),
    db.bill.findMany({
      where: { shopId, ...(locationId && { locationId }), status: "cancelled", businessDate: { gte: start, lte: end } },
      select: { grandTotal: true, businessDate: true },
    }),
  ]);

  const payments = bills.flatMap((b) => b.payments);
  const totalSales = sumMoney(bills.map((b) => b.grandTotal));
  const daily = new Map();
  for (const b of bills) {
    const key = groupByDay(b.businessDate);
    const row = daily.get(key) ?? { date: key, totalSalesPaise: 0, totalBills: 0, cashSalesPaise: 0, upiSalesPaise: 0, bankSalesPaise: 0, udharSalesPaise: 0 };
    row.totalSalesPaise += toPaise(b.grandTotal);
    row.totalBills += 1;
    row.cashSalesPaise += toPaise(sumPaymentsByMode(b.payments, "cash"));
    row.upiSalesPaise += toPaise(sumPaymentsByMode(b.payments, "upi"));
    row.bankSalesPaise += toPaise(sumPaymentsByMode(b.payments, "bank"));
    row.udharSalesPaise += toPaise(b.creditAmount);
    daily.set(key, row);
  }

  const data = {
    range: normalized.label,
    from: start.toISOString(),
    to: end.toISOString(),
    totalSalesPaise: toPaise(totalSales),
    totalBills: bills.length,
    averageBillValuePaise: bills.length ? toPaise(totalSales / bills.length) : 0,
    cashSalesPaise: toPaise(sumPaymentsByMode(payments, "cash")),
    upiSalesPaise: toPaise(sumPaymentsByMode(payments, "upi")),
    bankSalesPaise: toPaise(sumPaymentsByMode(payments, "bank")),
    udharSalesPaise: toPaise(sumMoney(bills.map((b) => b.creditAmount))),
    partialSalesPaise: toPaise(sumMoney(bills.filter((b) => b.paidAmount > 0 && b.creditAmount > 0).map((b) => b.grandTotal))),
    cancelledSalesPaise: toPaise(sumMoney(cancelledBills.map((b) => b.grandTotal))),
    discountsPaise: toPaise(sumMoney(bills.map((b) => b.discount))),
    waivedAmountPaise: toPaise(sumMoney(bills.map((b) => b.waivedAmount))),
    dailyBreakdown: Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date)),
  };

  if (includeProfit) data.grossProfitPaise = toPaise(sumMoney(bills.map((b) => b.grossProfit)));
  return data;
}

// ─────────────────────────────────────────────────────────────
// PAYMENT MODE REPORT
// ─────────────────────────────────────────────────────────────
export async function getPaymentModeReport(shopId, { from, to, locationId } = {}) {
  const { start, end } = normalizeDateRange({ from, to });
  await enforceReportRangeLimit(shopId, { start, end }, "custom");

  const [bills, oldUdharRecovered] = await Promise.all([
    db.bill.findMany({
      where: activeSalesWhere(shopId, start, end, locationId),
      include: { payments: true },
      orderBy: { businessDate: "desc" },
    }),
    db.udharLedger.findMany({
      where: { shopId, ...(locationId && { locationId }), type: "payment", mode: { in: ["cash", "upi", "bank"] }, businessDate: { gte: start, lte: end }, reversedAt: null },
      select: { amount: true, mode: true },
    }),
  ]);

  const payments = bills.flatMap((b) => b.payments);
  const mixedPayments = bills
    .filter((b) => {
      const billPaymentModes = new Set(b.payments.map((p) => p.mode));
      if (Number(b.creditAmount || 0) > 0) {
        billPaymentModes.add("credit");
      }
      return billPaymentModes.size > 1;
    })
    .slice(0, 100)
    .map((b) => ({
      billId: b.id,
      billNo: b.billNo,
      totalPaise: toPaise(b.grandTotal),
      modes: paymentModesForBill(b).map((p) => ({ mode: p.mode, amountPaise: toPaise(p.amount) })),
    }));

  const billCash = sumPaymentsByMode(payments, "cash");
  const billUpi = sumPaymentsByMode(payments, "upi");
  const billBank = sumPaymentsByMode(payments, "bank");
  const oldUdharCash = sumMoney(oldUdharRecovered.filter((u) => u.mode === "cash").map((u) => u.amount));
  const oldUdharUpi = sumMoney(oldUdharRecovered.filter((u) => u.mode === "upi").map((u) => u.amount));
  const oldUdharBank = sumMoney(oldUdharRecovered.filter((u) => u.mode === "bank").map((u) => u.amount));
  const totalCashInHand = addMoney(billCash, oldUdharCash);
  const totalUpiReceived = addMoney(billUpi, oldUdharUpi);
  const totalBankReceived = addMoney(billBank, oldUdharBank);

  return {
    from: start.toISOString(),
    to: end.toISOString(),
    cashPaise: toPaise(billCash),
    upiPaise: toPaise(billUpi),
    bankPaise: toPaise(billBank),
    cardPaise: toPaise(sumPaymentsByMode(payments, "card")),
    creditUdharPaise: toPaise(sumMoney(bills.map((b) => b.creditAmount))),
    mixedPayments,
    oldUdharRecoveredPaise: toPaise(sumMoney(oldUdharRecovered.map((u) => u.amount))),
    oldUdharRecoveredCashPaise: toPaise(oldUdharCash),
    oldUdharRecoveredUpiPaise: toPaise(oldUdharUpi),
    oldUdharRecoveredBankPaise: toPaise(oldUdharBank),
    totalCashInHandPaise: toPaise(totalCashInHand),
    totalUpiReceivedPaise: toPaise(totalUpiReceived),
    totalBankReceivedPaise: toPaise(totalBankReceived),
    totalCollectedPaise: toPaise(addMoney(totalCashInHand, totalUpiReceived, totalBankReceived)),
    refundPaise: 0,
    reversalPaise: 0,
    unsupported: { refunds: false, reversals: false },
  };
}

// ─────────────────────────────────────────────────────────────
// UDHAR AGEING REPORT
// ─────────────────────────────────────────────────────────────
export async function getUdharAgeing(shopId) {
  const customers = await db.customer.findMany({
    where: { shopId, udharAmount: { gt: 0 } },
    include: {
      udharLedger: {
        where: { type: "debit" },
        orderBy: { businessDate: "asc" },
        take: 1,
      },
    },
    orderBy: { udharAmount: "desc" },
  });

  const now = new Date();
  const buckets = {
    "0_7_days": { count: 0, amountPaise: 0 },
    "8_30_days": { count: 0, amountPaise: 0 },
    "31_60_days": { count: 0, amountPaise: 0 },
    "60_plus_days": { count: 0, amountPaise: 0 },
  };

  const rows = customers.map((c) => {
    const oldest = c.udharLedger[0]?.businessDate ?? c.createdAt;
    const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(oldest).getTime()) / 86_400_000));
    const bucket = resolveBucket(ageDays);
    const amountPaise = toPaise(c.udharAmount);
    buckets[bucket].count += 1;
    buckets[bucket].amountPaise += amountPaise;
    return {
      customerId: c.id,
      name: c.name,
      phone: maskPhone(c.mobile),
      deleted: Boolean(c.deletedAt),
      balancePaise: amountPaise,
      oldestPendingDate: oldest.toISOString(),
      bucket,
      dueDate: null,
      promiseToPayDate: c.reminderOverrideUntil?.toISOString?.() ?? null,
      riskLevel: riskLevelForBucket(bucket),
      whatsappReminderEligible: amountPaise > 0,
    };
  });

  return {
    totalPendingUdharPaise: toPaise(sumMoney(customers.map((c) => c.udharAmount))),
    buckets,
    customers: rows,
    generatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
// P&L REPORT
// Formula:
//   grossProfit   = sum of bill.grossProfit (active bills only)
//   inventoryLoss = sum of stockLedger.damageLossValue
//   netProfit     = grossProfit - inventoryLoss
// ─────────────────────────────────────────────────────────────
export async function getPnL(shopId, { range, from, to, locationId }) {
  const { start, end } = getDateRange(range, from, to, env.DAILY_CLOSING_TIMEZONE);

  // These six reads are independent, so run them in parallel (one batch of round-trips
  // instead of six sequential ones) — matching how the other report functions already work.
  const [bills, cancelledBills, damageEntries, udharCreated, udharRecovered, operatingExpenseRows] = await Promise.all([
    db.bill.findMany({
      where: {
        shopId,
        ...(locationId && { locationId }),
        status: "active",
        businessDate: { gte: start, lte: end },
      },
      include: { payments: true },
    }),
    db.bill.findMany({
      where: {
        shopId,
        ...(locationId && { locationId }),
        status: "cancelled",
        businessDate: { gte: start, lte: end },
      },
      select: { grandTotal: true, creditAmount: true },
    }),
    db.stockLedger.findMany({
      where: {
        shopId,
        ...(locationId && { locationId }),
        action: "damage",
        createdAt: { gte: start, lte: end },
      },
      select: { damageLossValue: true },
    }),
    db.udharLedger.findMany({
      where: {
        shopId,
        ...(locationId && { locationId }),
        type: "debit",
        // "Udhar given this period" = credit genuinely extended to customers: bill credit
        // (mode "credit") and manual credit adjustments. Exclude system-generated debits —
        // payment reversals, negative-balance repairs, and pre-existing opening balances —
        // which would otherwise inflate the metric (e.g. every clamp adds a system_repair).
        mode: { in: ["credit", "adjustment"] },
        businessDate: { gte: start, lte: end },
      },
      select: { amount: true },
    }),
    db.udharLedger.findMany({
      where: {
        shopId,
        ...(locationId && { locationId }),
        type: "payment",
        mode: { not: "reversal" },
        reversedAt: null,
        businessDate: { gte: start, lte: end },
      },
      select: { amount: true },
    }),
    db.expense.findMany({
      where: { shopId, ...(locationId && { locationId }), deletedAt: null, spentAt: { gte: start, lte: end } },
      select: { amount: true },
    }),
  ]);

  const grossSales = sumMoney(bills.map((b) => b.grandTotal));
  const grossProfit = sumMoney(bills.map((b) => b.grossProfit));
  const inventoryLoss = sumMoney(damageEntries.map((d) => d.damageLossValue));
  const operatingExpenses = sumMoney(operatingExpenseRows.map((e) => e.amount));
  // Net profit = trading profit minus damage losses minus operating expenses (rent, salary…).
  const netProfit = subtractMoney(subtractMoney(grossProfit, inventoryLoss), operatingExpenses);

  const cashCollected = sumPaymentsByMode(bills.flatMap((b) => b.payments), "cash");
  const upiCollected = sumPaymentsByMode(bills.flatMap((b) => b.payments), "upi");
  const bankCollected = sumPaymentsByMode(bills.flatMap((b) => b.payments), "bank");
  const udharGivenThisPeriod = sumMoney(udharCreated.map((u) => u.amount));
  const udharRecoveredThisPeriod = sumMoney(udharRecovered.map((u) => u.amount));
  const cancelledBillsValue = sumMoney(cancelledBills.map((b) => b.grandTotal));

  return {
    range: range ?? "custom",
    from: start.toISOString(),
    to: end.toISOString(),
    totalBills: bills.length,
    cancelledBills: cancelledBills.length,
    cancelledBillsValue,
    grossSales,
    grossProfit,
    inventoryLoss,
    operatingExpenses,
    netProfit,
    cashCollected,
    upiCollected,
    bankCollected,
    udharGivenThisPeriod,
    udharRecoveredThisPeriod,
    totalCollected: addMoney(cashCollected, upiCollected, bankCollected, udharRecoveredThisPeriod),
  };
}

// ─────────────────────────────────────────────────────────────
// GST REPORT — taxable sales + jurisdiction-aware GST collected for a period.
// Taxable value depends on the bill's gstMode: exclusive bills carry tax on
// top of the subtotal; inclusive bills carry it inside (taxable = subtotal − gst).
// ─────────────────────────────────────────────────────────────
export async function getGstReport(shopId, { range, from, to, locationId } = {}) {
  const { start, end } = getDateRange(range, from, to, env.DAILY_CLOSING_TIMEZONE);

  const [shop, bills] = await Promise.all([
    db.shop.findUnique({ where: { id: shopId }, select: { gstNumber: true } }),
    db.bill.findMany({
      where: { shopId, ...(locationId && { locationId }), ...GST_BILL_FILTER, businessDate: { gte: start, lte: end } },
      select: { subtotal: true, gst: true, gstMode: true, buyerStateCode: true },
    }),
  ]);
  const sellerStateCode = validateGstin(shop?.gstNumber).stateCode || "";

  let gstCollected = 0;
  let taxableSales = 0;
  let gstBills = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  for (const bill of bills) {
    const gst = Number(bill.gst) || 0;
    gstCollected = addMoney(gstCollected, gst);
    const taxable = bill.gstMode === "exclusive"
      ? Number(bill.subtotal) || 0
      : subtractMoney(Number(bill.subtotal) || 0, gst);
    taxableSales = addMoney(taxableSales, taxable);
    if (gst !== 0) gstBills += 1;
    const buyerStateCode = String(bill.buyerStateCode || "");
    const interstate = Boolean(sellerStateCode && /^\d{2}$/.test(buyerStateCode) && buyerStateCode !== sellerStateCode);
    if (interstate) igst = addMoney(igst, gst);
    else {
      const central = round2(gst / 2);
      cgst = addMoney(cgst, central);
      sgst = addMoney(sgst, subtractMoney(gst, central));
    }
  }

  return {
    range: range ?? "custom",
    from: start.toISOString(),
    to: end.toISOString(),
    totalBills: bills.length,
    gstBills,
    taxableSales: round2(taxableSales),
    gstCollected: round2(gstCollected),
    cgst: round2(cgst),
    sgst: round2(sgst),
    igst: round2(igst),
  };
}

// ─────────────────────────────────────────────────────────────
// MONTHLY BREAKDOWN — grouped query pattern avoids obvious N+1 bill fetching
// ─────────────────────────────────────────────────────────────
export async function getMonthlyBreakdown(shopId, { year, untilMonth, locationId }) {
  const tz = env.DAILY_CLOSING_TIMEZONE;
  const daysInUntilMonth = new Date(Date.UTC(year, untilMonth, 0)).getUTCDate();
  const start = dateRangeForDateOnly(`${year}-01-01`, tz).start;
  const end = dateRangeForDateOnly(`${year}-${String(untilMonth).padStart(2, "0")}-${String(daysInUntilMonth).padStart(2, "0")}`, tz).end;
  const [bills, damageRows] = await Promise.all([
    db.bill.findMany({
      where: { shopId, ...(locationId && { locationId }), status: "active", businessDate: { gte: start, lte: end } },
      select: { grandTotal: true, grossProfit: true, businessDate: true },
    }),
    db.stockLedger.findMany({
      where: { shopId, ...(locationId && { locationId }), action: "damage", createdAt: { gte: start, lte: end } },
      select: { damageLossValue: true, createdAt: true },
    }),
  ]);

  const months = [];
  for (let m = 1; m <= untilMonth; m++) {
    const monthBills = bills.filter((b) => monthInShopTz(b.businessDate, tz) === m);
    const monthDamage = damageRows.filter((d) => monthInShopTz(d.createdAt, tz) === m);
    const grossSales = sumMoney(monthBills.map((b) => b.grandTotal));
    const grossProfit = sumMoney(monthBills.map((b) => b.grossProfit));
    const inventoryLoss = sumMoney(monthDamage.map((d) => d.damageLossValue));
    months.push({
      month: m,
      monthName: new Date(year, m - 1).toLocaleString("en-IN", { month: "long" }),
      year,
      totalBills: monthBills.length,
      grossSales,
      grossProfit,
      inventoryLoss,
      netProfit: subtractMoney(grossProfit, inventoryLoss),
    });
  }

  return { year, months };
}

// ─────────────────────────────────────────────────────────────
// TOP PRODUCTS by revenue/quantity
// ─────────────────────────────────────────────────────────────
export async function getTopProducts(shopId, { from, to, locationId, limit = DEFAULT_TOP_LIMIT, includeProfit = false } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_TOP_LIMIT, 1), MAX_TOP_LIMIT);
  const range = normalizeDateRange({ from, to });
  const billFilter = activeSalesWhere(shopId, range.start, range.end, locationId);

  const items = await db.billItem.findMany({
    where: { bill: billFilter },
    select: {
      name: true,
      productId: true,
      lineTotal: true,
      lineProfit: true,
      quantityInBaseUnit: true,
    },
  });

  const agg = new Map();
  for (const item of items) {
    const key = item.productId ?? `name:${item.name}`;
    const row = agg.get(key) ?? { productId: item.productId ?? null, productName: item.name, quantitySoldBase: 0, revenue: 0, grossProfit: 0 };
    row.revenue += item.lineTotal;
    row.grossProfit += item.lineProfit;
    row.quantitySoldBase += item.quantityInBaseUnit;
    agg.set(key, row);
  }

  return Array.from(agg.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, safeLimit)
    .map((p, index) => ({
      productId: p.productId,
      productName: p.productName,
      quantitySoldBase: round2(p.quantitySoldBase),
      revenuePaise: toPaise(p.revenue),
      ...(includeProfit ? { grossProfitPaise: toPaise(p.grossProfit) } : {}),
      rank: index + 1,
    }));
}

// ─────────────────────────────────────────────────────────────
// INVENTORY HEALTH
// ─────────────────────────────────────────────────────────────
export async function getInventoryHealth(shopId, { includeCost = false, windowDays = 30, locationId } = {}) {
  const since = zonedDayStartDaysAgo(new Date(), Number(windowDays || 30));
  const [products, soldItems] = await Promise.all([
    db.product.findMany({ where: { shopId }, orderBy: { name: "asc" } }),
    db.billItem.findMany({
      where: { bill: { shopId, ...(locationId && { locationId }), status: "active", businessDate: { gte: since } } },
      select: { productId: true, name: true, quantityInBaseUnit: true, lineTotal: true },
    }),
  ]);

  const soldByProduct = new Map();
  for (const item of soldItems) {
    const key = item.productId ?? `name:${item.name}`;
    const row = soldByProduct.get(key) ?? { productId: item.productId, productName: item.name, quantitySoldBase: 0, revenue: 0 };
    row.quantitySoldBase += item.quantityInBaseUnit;
    row.revenue += item.lineTotal;
    soldByProduct.set(key, row);
  }

  const activeProducts = products.filter((p) => !p.deletedAt);
  const reportLocation = await resolveOperationalLocation(shopId, locationId);
  const movementRows = await Promise.all(activeProducts.map(async (p) => ({
    productId: p.id,
    productName: p.name,
    stockBaseQty: await getLocationQuantity(db, shopId, reportLocation, p),
    baseUnit: p.baseUnit,
    lowStockThreshold: p.lowStockThreshold,
    quantitySoldBase: round2(soldByProduct.get(p.id)?.quantitySoldBase ?? 0),
    revenuePaise: toPaise(soldByProduct.get(p.id)?.revenue ?? 0),
  })));

  const result = {
    lowStock: movementRows.filter((p) => p.lowStockThreshold > 0 && p.stockBaseQty <= p.lowStockThreshold),
    deadStock: movementRows.filter((p) => p.quantitySoldBase === 0),
    fastMoving: [...movementRows].sort((a, b) => b.quantitySoldBase - a.quantitySoldBase).slice(0, 20),
    slowMoving: [...movementRows].sort((a, b) => a.quantitySoldBase - b.quantitySoldBase).slice(0, 20),
    negativeStock: movementRows.filter((p) => p.stockBaseQty < 0),
    totalProducts: products.length,
    activeProducts: activeProducts.length,
    inactiveProducts: products.filter((p) => p.deletedAt).length,
    windowDays: Number(windowDays || 30),
  };

  if (includeCost) {
    const branchStockByProduct = new Map(movementRows.map((row) => [row.productId, row.stockBaseQty]));
    // Stock is held in base units (g, ml, piece) while cost and price are per
    // rate unit (kg, l, piece). Multiplying the two directly values a 40 kg sack
    // of atta as if it were 40,000 kg — on a real kirana catalogue that
    // overstated closing stock by ~85x. Convert before valuing.
    const valuation = activeProducts.map((p) => {
      const rateQty = baseQtyToRateQty(Number(branchStockByProduct.get(p.id) || 0), p.rateUnit, p.baseUnit);
      return {
        category: p.category || "general",
        costValue: rateQty * Number(p.costPerRateUnit || 0),
        retailValue: rateQty * Number(p.defaultPricePerRateUnit || 0),
      };
    });

    const byCategory = new Map();
    for (const row of valuation) {
      const entry = byCategory.get(row.category) ?? { category: row.category, costValue: 0, retailValue: 0, productCount: 0 };
      entry.costValue += row.costValue;
      entry.retailValue += row.retailValue;
      entry.productCount += 1;
      byCategory.set(row.category, entry);
    }

    const totalCost = sumMoney(valuation.map((row) => row.costValue));
    const totalRetail = sumMoney(valuation.map((row) => row.retailValue));
    result.totalInventoryCostPaise = toPaise(totalCost);
    result.totalInventoryRetailPaise = toPaise(totalRetail);
    result.potentialMarginPaise = toPaise(subtractMoney(totalRetail, totalCost));
    result.inventoryValuationByCategory = [...byCategory.values()]
      .map((entry) => ({
        category: entry.category,
        productCount: entry.productCount,
        costValuePaise: toPaise(entry.costValue),
        retailValuePaise: toPaise(entry.retailValue),
      }))
      .sort((a, b) => b.costValuePaise - a.costValuePaise);
    // Unit-aware now; the only remaining approximation is weighted-average cost.
    result.inventoryCostEstimate = false;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// STAFF-WISE SALES
// Phase 12: group by server-trusted Bill.createdByUserId. Legacy/null bills
// are kept in an Unknown/Legacy bucket instead of inventing cashier data.
// ─────────────────────────────────────────────────────────────
export async function getStaffSales(shopId, { from, to, locationId } = {}) {
  const { start, end } = normalizeDateRange({ from, to });
  await enforceReportRangeLimit(shopId, { start, end }, "custom");

  const bills = await db.bill.findMany({
    where: { shopId, ...(locationId && { locationId }), businessDate: { gte: start, lte: end } },
    include: { payments: true },
  });

  const userIds = [...new Set(bills.map((b) => b.createdByUserId).filter(Boolean))];
  const users = userIds.length
    ? await db.user.findMany({
        where: { shopId, id: { in: userIds } },
        select: { id: true, name: true, role: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const groups = new Map();

  function getGroup(userId) {
    const key = userId || "legacy";
    if (!groups.has(key)) {
      const user = userId ? userMap.get(userId) : null;
      groups.set(key, {
        userId: userId ?? null,
        userName: user?.name ?? "Unknown / Legacy",
        userRole: user?.role ?? null,
        billCount: 0,
        sales: 0,
        cash: 0,
        upi: 0,
        udhar: 0,
        cancelledBills: 0,
      });
    }
    return groups.get(key);
  }

  for (const bill of bills) {
    const group = getGroup(bill.createdByUserId ?? null);
    if (bill.status === "cancelled") {
      group.cancelledBills += 1;
      continue;
    }
    if (bill.status !== "active") continue;
    group.billCount += 1;
    group.sales = addMoney(group.sales, bill.grandTotal);
    group.cash = addMoney(group.cash, sumPaymentsByMode(bill.payments, "cash"));
    group.upi = addMoney(group.upi, sumPaymentsByMode(bill.payments, "upi"));
    group.udhar = addMoney(group.udhar, bill.creditAmount);
  }

  const staff = Array.from(groups.values()).map((row) => ({
    userId: row.userId,
    userName: row.userName,
    userRole: row.userRole,
    billCount: row.billCount,
    salesPaise: toPaise(row.sales),
    cashPaise: toPaise(row.cash),
    upiPaise: toPaise(row.upi),
    udharPaise: toPaise(row.udhar),
    cancelledBills: row.cancelledBills,
    averageBillValuePaise: row.billCount ? toPaise(row.sales / row.billCount) : 0,
  })).sort((a, b) => b.salesPaise - a.salesPaise);

  return {
    from: start.toISOString(),
    to: end.toISOString(),
    staff,
    legacyBucketIncluded: staff.some((row) => row.userId === null),
  };
}

// ─────────────────────────────────────────────────────────────
// PAYMENT SUMMARY — backward-compatible existing endpoint
// ─────────────────────────────────────────────────────────────
export async function getPaymentSummary(shopId, { from, to, locationId }) {
  const { start, end } = getDateRange(null, from, to, env.DAILY_CLOSING_TIMEZONE);

  const [payments, bills, oldUdharRecovered, purchases] = await Promise.all([
    db.payment.findMany({
      where: {
        bill: { shopId, ...(locationId && { locationId }), status: "active", businessDate: { gte: start, lte: end } },
      },
      select: { mode: true, amount: true },
    }),
    db.bill.findMany({
      where: activeSalesWhere(shopId, start, end, locationId),
      select: { creditAmount: true },
    }),
    db.udharLedger.findMany({
      where: { shopId, ...(locationId && { locationId }), type: "payment", mode: { in: ["cash", "upi", "bank"] }, businessDate: { gte: start, lte: end }, reversedAt: null },
      select: { mode: true, amount: true },
    }),
    db.stockLedger.findMany({
      where: { shopId, ...(locationId && { locationId }), action: "purchase", createdAt: { gte: start, lte: end } },
      select: { purchasePaymentMode: true, purchasePaidAmount: true, purchaseDueAmount: true },
    }),
  ]);

  const summary = {
    cash: 0,
    upi: 0,
    bank: 0,
    credit: 0,
    total: 0,
    oldUdharRecovered: 0,
    cashInHand: 0,
    upiReceived: 0,
    bankReceived: 0,
    purchaseCashPaid: 0,
    purchaseUpiPaid: 0,
    purchaseBankPaid: 0,
    purchaseDue: 0,
    netCashInHand: 0,
  };
  for (const p of payments) {
    summary[p.mode] = addMoney(summary[p.mode] ?? 0, p.amount);
    summary.total = addMoney(summary.total, p.amount);
  }
  summary.credit = sumMoney(bills.map((b) => b.creditAmount));
  summary.total = addMoney(summary.total, summary.credit);
  for (const p of oldUdharRecovered) {
    summary.oldUdharRecovered = addMoney(summary.oldUdharRecovered, p.amount);
    if (p.mode === "cash") summary.cashInHand = addMoney(summary.cashInHand, p.amount);
    if (p.mode === "upi") summary.upiReceived = addMoney(summary.upiReceived, p.amount);
    if (p.mode === "bank") summary.bankReceived = addMoney(summary.bankReceived, p.amount);
  }
  for (const purchase of purchases) {
    const paid = purchase.purchasePaidAmount || 0;
    const mode = String(purchase.purchasePaymentMode || "").toLowerCase();
    if (mode === "cash") summary.purchaseCashPaid = addMoney(summary.purchaseCashPaid, paid);
    if (mode === "upi") summary.purchaseUpiPaid = addMoney(summary.purchaseUpiPaid, paid);
    if (mode === "bank") summary.purchaseBankPaid = addMoney(summary.purchaseBankPaid, paid);
    summary.purchaseDue = addMoney(summary.purchaseDue, purchase.purchaseDueAmount || 0);
  }
  summary.cashInHand = addMoney(summary.cashInHand, summary.cash);
  summary.upiReceived = addMoney(summary.upiReceived, summary.upi);
  summary.bankReceived = addMoney(summary.bankReceived, summary.bank);
  summary.totalCollected = addMoney(summary.cashInHand, summary.upiReceived, summary.bankReceived);
  summary.netCashInHand = Math.max(0, subtractMoney(summary.cashInHand, summary.purchaseCashPaid));
  summary.netBankInHand = Math.max(0, subtractMoney(summary.bankReceived, summary.purchaseBankPaid));

  return { from: start.toISOString(), to: end.toISOString(), ...summary };
}

// ─────────────────────────────────────────────────────────────
// DAILY CLOSING SNAPSHOT SERVICE WRAPPERS
// Kept here for backward compatibility with Phase 11 imports/tests. The real
// persisted implementation lives in dailyClosingSnapshot.service.js.
// ─────────────────────────────────────────────────────────────
export async function generateDailyClosingSnapshot(shopId, storeIdOrDate, maybeDate, options = {}) {
  const date = maybeDate ?? storeIdOrDate;
  const storeId = maybeDate ? storeIdOrDate : null;
  const mod = await import("./dailyClosingSnapshot.service.js");
  return mod.generateDailyClosingSnapshot(shopId, date, { ...options, storeId });
}

export async function getDailyClosingSnapshot(shopId, storeIdOrDate, maybeDate) {
  const date = maybeDate ?? storeIdOrDate;
  const storeId = maybeDate ? storeIdOrDate : null;
  const mod = await import("./dailyClosingSnapshot.service.js");
  return mod.getDailyClosingSnapshot(shopId, date, storeId);
}

export async function refreshDailyClosingSnapshot(shopId, storeIdOrDate, maybeDate, options = {}) {
  const date = maybeDate ?? storeIdOrDate;
  const storeId = maybeDate ? storeIdOrDate : null;
  const mod = await import("./dailyClosingSnapshot.service.js");
  return mod.refreshDailyClosingSnapshot(shopId, date, { ...options, storeId });
}

// ─────────────────────────────────────────────────────────────
// EXPORT — raw data for CSV / Excel download
// ─────────────────────────────────────────────────────────────
export async function exportBillsData(shopId, { from, to, status, locationId }) {
  const where = {
    shopId,
    ...(locationId && { locationId }),
    ...(status && status !== "all" ? { status } : {}),
    ...(from && to ? { businessDate: { gte: new Date(from), lte: new Date(to) } } : {}),
  };

  const bills = await db.bill.findMany({
    where,
    include: { items: true, payments: true },
    orderBy: { businessDate: "desc" },
  });

  const rows = [];
  for (const b of bills) {
    for (const item of b.items) {
      rows.push({
        billNo: b.billNo,
        date: b.businessDate.toISOString().split("T")[0],
        time: b.businessDate.toTimeString().slice(0, 5),
        billType: b.billType,
        status: b.status,
        customerName: b.customerName,
        productName: item.name,
        quantity: item.quantity,
        unit: item.enteredUnit,
        rate: item.ratePerRateUnit,
        lineTotal: item.lineTotal,
        lineProfit: item.lineProfit,
        gstRate: item.gstRate,
        discount: b.discount,
        grandTotal: b.grandTotal,
        paidAmount: b.paidAmount,
        udharAmount: b.creditAmount,
        grossProfit: b.grossProfit,
        paymentModes: b.payments.map((p) => `${p.mode}:${p.amount}`).join("|"),
      });
    }
    if (!b.items.length) {
      rows.push({
        billNo: b.billNo,
        date: b.businessDate.toISOString().split("T")[0],
        time: b.businessDate.toTimeString().slice(0, 5),
        billType: b.billType,
        status: b.status,
        customerName: b.customerName,
        productName: "",
        quantity: "",
        unit: "",
        rate: "",
        lineTotal: "",
        lineProfit: "",
        gstRate: "",
        discount: b.discount,
        grandTotal: b.grandTotal,
        paidAmount: b.paidAmount,
        udharAmount: b.creditAmount,
        grossProfit: b.grossProfit,
        paymentModes: b.payments.map((p) => `${p.mode}:${p.amount}`).join("|"),
      });
    }
  }

  return { rows, count: bills.length };
}

/**
 * Synchronous exports stream straight into an owner's phone, so they are
 * bounded on both axes. Without this a year of trading returns every stock
 * ledger row in one response — 50k rows and tens of megabytes on a mobile PWA.
 * `truncated` tells the caller to narrow the range or use the async export job.
 */
export const SYNC_EXPORT_ROW_LIMIT = 10000;
const SYNC_EXPORT_DEFAULT_WINDOW_DAYS = 90;

function boundedExportWindow(from, to) {
  if (from && to) return { gte: new Date(from), lte: new Date(to) };
  if (from) return { gte: new Date(from) };
  if (to) return { lte: new Date(to) };
  // No window asked for: default to a recent window rather than all history.
  const start = new Date();
  start.setDate(start.getDate() - SYNC_EXPORT_DEFAULT_WINDOW_DAYS);
  return { gte: start };
}

export async function exportStockLedgerData(shopId, { from, to, productId, locationId, limit } = {}) {
  const take = Math.min(Number(limit) || SYNC_EXPORT_ROW_LIMIT, SYNC_EXPORT_ROW_LIMIT);
  const where = {
    shopId,
    ...(locationId && { locationId }),
    ...(productId ? { productId } : {}),
    createdAt: boundedExportWindow(from, to),
  };
  const rows = await db.stockLedger.findMany({ where, orderBy: { createdAt: "desc" }, take: take + 1 });
  const truncated = rows.length > take;
  return {
    rows: truncated ? rows.slice(0, take) : rows,
    count: truncated ? take : rows.length,
    truncated,
    limit: take,
    defaultWindowDays: from || to ? null : SYNC_EXPORT_DEFAULT_WINDOW_DAYS,
  };
}

export async function exportUdharData(shopId) {
  const customers = await db.customer.findMany({
    where: { shopId, deletedAt: null },
    include: {
      udharLedger: { orderBy: { businessDate: "asc" } },
    },
  });

  return customers.map((c) => ({
    id: c.id,
    name: c.name,
    mobile: c.mobile || "",
    type: c.type,
    outstandingBalance: c.udharAmount,
    entries: c.udharLedger.map((e) => ({
      date: e.businessDate.toISOString().split("T")[0],
      type: e.type,
      amount: e.amount,
      mode: e.mode,
      billNo: e.billNo || "",
      note: e.note || "",
    })),
  }));
}

export const __reportInternals = { toPaise, fromPaise, normalizeDateRange, enforceReportRangeLimit, monthInShopTz, zonedDayStartDaysAgo };
