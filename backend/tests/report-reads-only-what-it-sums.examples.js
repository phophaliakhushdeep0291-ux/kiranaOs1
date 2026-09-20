/**
 * report-reads-only-what-it-sums.examples.js
 *
 * An aggregate report reads a bill to add two numbers off it and throw the row away.
 * Every one of them used to ask for that with `include: { payments: true }`, which
 * hydrates all ~70 Bill columns and every Payment column — the buyer's address, the
 * seller's trade name, the WhatsApp delivery key, the whole parallel *Paise set —
 * for rows whose only job is to be summed. On a year of trading the all-time
 * reconciliation spent a full second doing it.
 *
 * Two things have to hold together, and neither is worth much alone:
 *
 *   NARROW — the report asks for a `select`, not an `include`, and that select does
 *            not carry columns the report never reads. This is the part that is easy
 *            to lose: `include: { payments: true }` is the shorter thing to type and
 *            the tests all still pass when someone types it.
 *
 *   WHOLE  — every column the arithmetic touches is still in the select. A money
 *            column dropped from a select fails loudly, because sumMoney refuses a
 *            non-finite value — but the columns that decide WHICH rows are summed do
 *            not. Drop `status` and every tender reads "not confirmed", so the day's
 *            cash is 0. Drop `createdByUserId` and every bill falls into the legacy
 *            staff bucket. Those are the silent ones, and they are why each figure
 *            below is asserted against a bill built with a DIFFERENT number in every
 *            column: a missing one has to be visible, not merely plausible.
 *
 * The money arithmetic itself stays in JS on purpose. sumMoney computes Σ round(xᵢ×100)
 * — it rounds each row to paise before adding — and pushing these sums into SQL as
 * SUM() would compute round(Σxᵢ×100) instead. Different number, no type error.
 */

import assert from "node:assert/strict";
import db from "../src/db.js";
import { env } from "../src/config/env.js";
import { formatDateInTimeZone } from "../src/utils/dates.js";
import {
  exportBillsData,
  getDailyClosing,
  getFinancialLedgerReconciliation,
  getPaymentModeReport,
  getPnL,
  getSalesSummary,
  getStaffSales,
} from "../src/modules/reports/reports.service.js";

const today = formatDateInTimeZone(new Date(), env.DAILY_CLOSING_TIMEZONE);

// Columns no aggregate report reads. If one of these turns up in a Bill select the
// query has gone wide again — either through `include` or through a copied select.
const COLUMNS_NO_REPORT_SUMS = [
  "buyerAddress",
  "sellerAddress",
  "sellerTradeName",
  "whatsappDeliveryKey",
  "whatsappProviderMessageId",
  "cancelledReason",
  "deletedReason",
];

// ── Record what each report actually asks Prisma for ──────────────────────────
const asked = [];
db.$use(async (params, next) => {
  if (params.model === "Bill" && String(params.action).startsWith("find")) {
    asked.push({ select: params.args?.select ?? null, include: params.args?.include ?? null });
  }
  return next(params);
});

function billReadsDuring(label) {
  assert.ok(asked.length > 0, `${label}: expected at least one Bill read`);
  for (const read of asked) {
    assert.equal(read.include, null,
      `${label}: reads bills with include, which hydrates every Bill column to sum two of them`);
    assert.ok(read.select, `${label}: reads bills with neither select nor include`);
    for (const column of COLUMNS_NO_REPORT_SUMS) {
      assert.ok(!(column in read.select),
        `${label}: selects "${column}", which no report reads`);
    }
  }
  asked.length = 0;
}

// ── One bill, a different number in every column a report sums ───────────────
const shop = await db.shop.create({ data: { name: "Narrow Select Kirana", ownerName: "o", city: "c", address: "a" } });
const user = await db.user.create({
  data: { shopId: shop.id, name: "Owner", mobile: "9000000099", role: "owner", passwordHash: "x" },
});
const customer = await db.customer.create({
  data: { shopId: shop.id, name: "Udhar Customer", mobile: "9000000098", udharAmount: 37 },
});

// grandTotal 500 = paid 410 + credit 90, of which the tender split is 300 cash + 110 upi.
// Nothing is a round multiple of anything else, so no two columns can stand in for
// each other if one goes missing.
const bill = await db.bill.create({
  data: {
    shopId: shop.id,
    billNo: "NS-1",
    customerId: customer.id,
    createdByUserId: user.id,
    status: "active",
    billType: "normal_sale",
    subtotal: 530,
    discount: 23,
    waivedAmount: 7,
    grandTotal: 500,
    paidAmount: 410,
    creditAmount: 90,
    grossProfit: 61,
    buyerAddress: "should never be read by a report",
    businessDate: new Date(),
  },
});
await db.payment.createMany({
  data: [
    { shopId: shop.id, billId: bill.id, mode: "cash", amount: 300, status: "confirmed" },
    { shopId: shop.id, billId: bill.id, mode: "upi", amount: 110, status: "confirmed" },
    // A pending tender is money that has not arrived. sumPaymentsByMode filters on
    // status, so `status` has to survive the narrowing too — drop it and this 999
    // lands in the day's cash.
    { shopId: shop.id, billId: bill.id, mode: "cash", amount: 999, status: "pending" },
  ],
});
await db.billItem.create({
  data: {
    billId: bill.id, name: "Atta", quantity: 2, enteredUnit: "kg", baseUnit: "kg", rateUnit: "kg",
    quantityInBaseUnit: 2, ratePerRateUnit: 265, costPerRateUnit: 234, gstRate: 5,
    lineTotal: 500, lineCost: 439, lineProfit: 61,
  },
});

// ── Daily closing ─────────────────────────────────────────────────────────────
const closing = await getDailyClosing(shop.id, { date: today, allLocations: true });
billReadsDuring("daily closing");
assert.equal(closing.totalSalesPaise, 50_000, "daily closing lost grandTotal");
assert.equal(closing.udharGivenPaise, 9_000, "daily closing lost creditAmount");
assert.equal(closing.cashReceivedPaise, 30_000, "daily closing counted a pending tender as cash");
assert.equal(closing.upiReceivedPaise, 11_000, "daily closing lost the upi tender");

// ── Sales summary ─────────────────────────────────────────────────────────────
const summary = await getSalesSummary(shop.id, { range: "today" });
billReadsDuring("sales summary");
assert.equal(summary.totalSalesPaise, 50_000, "sales summary lost grandTotal");
assert.equal(summary.udharSalesPaise, 9_000, "sales summary lost creditAmount");
assert.equal(summary.discountsPaise, 2_300, "sales summary lost discount");
assert.equal(summary.waivedAmountPaise, 700, "sales summary lost waivedAmount");
assert.equal(summary.partialSalesPaise, 50_000, "sales summary lost paidAmount, so the part-paid test failed");
assert.equal(summary.cashSalesPaise, 30_000, "sales summary lost the cash tender");
assert.deepEqual(
  summary.dailyBreakdown.map((row) => [row.date, row.totalSalesPaise]),
  [[today, 50_000]],
  "sales summary lost businessDate, so the daily breakdown lost its day",
);

// ── Payment modes ─────────────────────────────────────────────────────────────
const modes = await getPaymentModeReport(shop.id, { from: today, to: today });
billReadsDuring("payment mode report");
assert.equal(modes.cashPaise, 30_000, "payment modes lost the cash tender");
assert.equal(modes.upiPaise, 11_000, "payment modes lost the upi tender");
assert.equal(modes.creditUdharPaise, 9_000, "payment modes lost creditAmount");
// Cash + upi + credit on one bill is the mixed-tender case, and it is listed by
// bill number — the two identifying columns have to survive the narrowing.
assert.deepEqual(
  modes.mixedPayments.map((row) => [row.billId, row.billNo, row.totalPaise]),
  [[bill.id, "NS-1", 50_000]],
  "payment modes lost the identity of the mixed-tender bill",
);

// ── P&L ───────────────────────────────────────────────────────────────────────
const pnl = await getPnL(shop.id, { from: today, to: today });
billReadsDuring("p&l");
assert.equal(pnl.grossSales, 500, "p&l lost grandTotal");
assert.equal(pnl.grossProfit, 61, "p&l lost grossProfit");
assert.equal(pnl.cashCollected, 300, "p&l lost the cash tender");

// ── Staff sales ───────────────────────────────────────────────────────────────
const staff = await getStaffSales(shop.id, { from: today, to: today });
billReadsDuring("staff sales");
const owner = staff.staff.find((row) => row.userId === user.id);
assert.ok(owner, "staff sales lost createdByUserId, so the bill fell into the legacy bucket");
assert.equal(owner.billCount, 1, "staff sales lost status, so an active bill stopped counting");
assert.equal(owner.salesPaise, 50_000, "staff sales lost grandTotal");
assert.equal(owner.udharPaise, 9_000, "staff sales lost creditAmount");
assert.equal(owner.cashPaise, 30_000, "staff sales lost the cash tender");

// ── All-time ledger reconciliation ────────────────────────────────────────────
const reconciliation = await getFinancialLedgerReconciliation(shop.id);
billReadsDuring("financial ledger reconciliation");
assert.equal(reconciliation.operational.sales, 500, "reconciliation lost grandTotal");
assert.equal(reconciliation.operational.cashCollected, 300, "reconciliation lost the cash tender");

// ── Bill export: the CSV names its columns, and the query has to carry them ───
const exported = await exportBillsData(shop.id, { from: today, to: today, status: "all" });
billReadsDuring("bill export");
assert.equal(exported.rows.length, 1, "bill export lost its line row");
assert.deepEqual(exported.rows[0], {
  billNo: "NS-1",
  date: exported.rows[0].date,
  time: exported.rows[0].time,
  billType: "normal_sale",
  status: "active",
  customerName: exported.rows[0].customerName,
  productName: "Atta",
  quantity: 2,
  unit: "kg",
  rate: 265,
  lineTotal: 500,
  lineProfit: 61,
  gstRate: 5,
  discount: 23,
  grandTotal: 500,
  paidAmount: 410,
  udharAmount: 90,
  grossProfit: 61,
  // A pending tender is still a tender the accountant's CSV lists; the export
  // reports what was recorded rather than what cleared.
  paymentModes: "cash:300|upi:110|cash:999",
}, "bill export dropped a column its CSV writes");

console.log("report-reads-only-what-it-sums.examples.js OK");
await db.$disconnect();
