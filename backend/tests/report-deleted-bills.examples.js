import assert from "node:assert/strict";
import db from "../src/db.js";
import { cancelBill, confirmBill, softDeleteBill } from "../src/modules/bills/bills.service.js";
import { buildTallyExport, listApiResource } from "../src/modules/integrations/integrations.service.js";
import { env } from "../src/config/env.js";
import { dateRangeForDateOnly, formatDateInTimeZone } from "../src/utils/dates.js";
import {
  exportBillsData,
  getDailyClosing,
  getGstReport,
  getInventoryHealth,
  getMonthlyBreakdown,
  getPaymentModeReport,
  getPaymentSummary,
  getPnL,
  getSalesSummary,
  getStaffSales,
  getTopProducts,
} from "../src/modules/reports/reports.service.js";

// Soft-deleting a bill stamps `deletedAt` and leaves `status` as "active"
// (bills.service.js softDeleteBill), and there is no global Prisma soft-delete
// middleware. So any query filtering on status alone keeps recycle-bin bills in its
// totals — the GST screen was reporting tax on bills the shop had deleted, and so
// were the TallyPrime export and the partner REST API that read the same bills.
//
// The shape of the test: bill everything TWICE, delete one copy, and assert every
// report reads exactly the surviving half. Halving is what makes a missed filter
// visible — an absolute figure would still look plausible if the delete were ignored.
//
// The GST screen and the Tally export are asserted to AGREE, not merely to be right
// separately: tally-voucher splits tax by exactly the rule getGstReport uses, so a
// filter fixed on one side alone is the regression worth catching.

// Day keys must be resolved in the SHOP timezone, not UTC. `toISOString().slice(0,10)` is the
// UTC day, which between 00:00 and 05:30 IST names yesterday — every range assertion below
// would then query a window the freshly-created bills fall outside of, so the suite would fail
// for five and a half hours a day. Every report keys off this helper for the same reason.
function todayKey() {
  return formatDateInTimeZone(new Date(), env.DAILY_CLOSING_TIMEZONE);
}

function dayKeyBefore(key, daysBack) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - daysBack)).toISOString().slice(0, 10);
}

// buildTallyExport reads `query.include` directly, and the default for it lives in the Zod
// route schema — so calling the service straight has to supply it. Sales only: this file is
// about which BILLS the export selects, not the purchase/receipt/expense voucher kinds.
function salesExport(shopId, from, to) {
  return buildTallyExport(shopId, { from, to, include: ["sales"] });
}

// Midday in the shop timezone — a timestamp put here cannot drift across a day boundary,
// unlike one placed exactly on it.
function middayOn(key) {
  return new Date(dateRangeForDateOnly(key, env.DAILY_CLOSING_TIMEZONE).start.getTime() + 12 * 60 * 60 * 1000);
}

async function sellOne(shopId, product, tag) {
  return confirmBill(shopId, {
    billType: "normal_sale",
    customerName: "Walk-in",
    gstMode: "exclusive", // taxable value = subtotal, so the GST maths is easy to read
    items: [{
      productId: product.id,
      name: product.name,
      quantity: 1,
      enteredUnit: "piece",
      ratePerRateUnit: 100,
      gstRate: 18,
    }],
    discount: 0,
    payments: [{ mode: "cash", amount: 118 }],
    actualAmount: 118,
    buyerPaidAmount: 118,
    waivedAmount: 0,
    clientBillId: tag,
    idempotencyKey: tag,
  });
}

async function main() {
  const shop = await db.shop.create({ data: { name: `RDB ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  const day = todayKey();
  const range = { from: day, to: day };

  try {
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "Toor Dal 1kg", category: "staples",
        baseUnit: "g", rateUnit: "piece", displayUnit: "piece",
        stockBaseQty: 100, defaultPricePerRateUnit: 100, costPerRateUnit: 60,
        gstRate: 18,
      },
    });

    const kept = await sellOne(shop.id, product, "rdb-bill-kept");
    const doomed = await sellOne(shop.id, product, "rdb-bill-doomed");

    // ── before: both bills are on the books ─────────────────────────
    const gstBefore = await getGstReport(shop.id, range);
    assert.equal(gstBefore.totalBills, 2, "both bills start out in the GST report");
    assert.equal(gstBefore.taxableSales, 200, "two ₹100 taxable sales");
    assert.equal(gstBefore.gstCollected, 36, "18% on each");

    const salesBefore = await getSalesSummary(shop.id, range);
    assert.equal(salesBefore.totalBills, 2);
    assert.equal(salesBefore.totalSalesPaise, 23600);

    // ── delete one ──────────────────────────────────────────────────
    const deleted = await softDeleteBill(shop.id, doomed.id, { reason: "billed twice by mistake" });
    assert.ok(deleted.deletedAt, "the bill is in the recycle bin");
    assert.equal(
      (await db.bill.findUnique({ where: { id: doomed.id } })).status,
      "active",
      "and its status is STILL active — which is the whole trap",
    );

    // ── after: every report reads the surviving bill only ───────────
    const gst = await getGstReport(shop.id, range);
    assert.equal(gst.totalBills, 1, "GST report drops the deleted bill");
    assert.equal(gst.taxableSales, 100, "taxable sales halve");
    assert.equal(gst.gstCollected, 18, "GST collected halves");
    assert.equal(gst.gstBills, 1);
    // Intrastate (no buyer state code) splits central/state, so both must halve too.
    assert.equal(gst.cgst, 9, "CGST halves with it");
    assert.equal(gst.sgst, 9, "SGST halves with it");
    assert.equal(gst.igst, 0);

    const sales = await getSalesSummary(shop.id, range);
    assert.equal(sales.totalBills, 1, "sales summary drops it");
    assert.equal(sales.totalSalesPaise, 11800);
    assert.equal(sales.cashSalesPaise, 11800, "and so does the cash it was tendered with");
    assert.equal(sales.dailyBreakdown.reduce((n, row) => n + row.totalBills, 0), 1, "including the daily breakdown");

    const closing = await getDailyClosing(shop.id, { date: day, allLocations: true });
    assert.equal(closing.totalBills, 1, "daily closing drops it");
    assert.equal(closing.totalSalesPaise, 11800);
    assert.equal(closing.cashReceivedPaise, 11800, "the drawer is not credited for a deleted bill");

    const modes = await getPaymentModeReport(shop.id, range);
    assert.equal(modes.cashPaise, 11800, "payment-mode report drops it");

    const pnl = await getPnL(shop.id, { from: day, to: day });
    assert.equal(pnl.totalBills, 1, "P&L drops it");
    assert.equal(pnl.grossSales, 118);
    assert.equal(pnl.grossProfit, 40, "₹100 sold at ₹60 cost, once");

    const months = await getMonthlyBreakdown(shop.id, {
      year: Number(day.slice(0, 4)),
      untilMonth: Number(day.slice(5, 7)),
    });
    const thisMonth = months.months.at(-1);
    assert.equal(thisMonth.totalBills, 1, "monthly breakdown drops it");
    assert.equal(thisMonth.grossSales, 118);

    const top = await getTopProducts(shop.id, range);
    assert.equal(top[0].revenuePaise, 10000, "top products counts the line once");
    assert.equal(top[0].quantitySoldBase, 1);

    const health = await getInventoryHealth(shop.id, { windowDays: 1 });
    const moved = health.fastMoving.find((row) => row.productId === product.id);
    assert.equal(moved.quantitySoldBase, 1, "sales velocity counts the line once");

    const staff = await getStaffSales(shop.id, range);
    const legacy = staff.staff.find((row) => row.userId === null);
    assert.equal(legacy.billCount, 1, "staff sales drops it");
    assert.equal(legacy.salesPaise, 11800);

    const summary = await getPaymentSummary(shop.id, { from: day, to: day });
    assert.equal(summary.cash, 118, "payment summary drops its tender");

    const csv = await exportBillsData(shop.id, { from: day, to: day, status: "all" });
    assert.equal(csv.count, 1, "a deleted bill is not in the accountant's export either");
    assert.equal(csv.rows.every((row) => row.billNo !== doomed.billNo), true);
    assert.equal(csv.rows.some((row) => row.billNo === kept.billNo), true, "the surviving bill still is");

    // ── cancelled-then-deleted leaves both counts ───────────────────
    // "Cancelled today" is its own reported line, so it needs the same exclusion:
    // a bill in the recycle bin is off the books, whichever status it carries.
    const scrapped = await sellOne(shop.id, product, "rdb-bill-scrapped");
    await cancelBill(shop.id, scrapped.id, { reason: "customer walked out" });
    assert.equal((await getDailyClosing(shop.id, { date: day, allLocations: true })).cancelledBills, 1, "a cancelled bill is reported as cancelled");

    await softDeleteBill(shop.id, scrapped.id, { reason: "tidying up the bin" });
    const afterBinning = await getDailyClosing(shop.id, { date: day, allLocations: true });
    assert.equal(afterBinning.cancelledBills, 0, "once deleted it leaves the cancelled count too");
    assert.equal(afterBinning.totalBills, 1, "without reappearing as a sale");
    assert.equal(
      (await getSalesSummary(shop.id, range)).cancelledSalesPaise,
      0,
      "and the sales summary agrees",
    );

    // ── a deleted estimate stops being a rough bill ─────────────────
    const estimate = await confirmBill(shop.id, {
      billType: "estimate",
      customerName: "Walk-in",
      items: [{ productId: product.id, name: product.name, quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100, gstRate: 0 }],
      discount: 0,
      payments: [{ mode: "cash", amount: 100 }],
      actualAmount: 100,
      buyerPaidAmount: 100,
      waivedAmount: 0,
      clientBillId: "rdb-estimate",
      idempotencyKey: "rdb-estimate",
    });
    assert.equal((await getDailyClosing(shop.id, { date: day, allLocations: true })).roughBills, 1, "the estimate is counted");
    await softDeleteBill(shop.id, estimate.id, { reason: "wrong customer" });
    assert.equal((await getDailyClosing(shop.id, { date: day, allLocations: true })).roughBills, 0, "and uncounted once deleted");
    // An estimate is not a tax document, so it was never in the GST report to begin with.
    assert.equal((await getGstReport(shop.id, range)).totalBills, 1, "the GST report still sees only the one pakka bill");

    // ── the Tally export agrees with the GST screen ─────────────────
    // This is the pairing that exposed the bug: tally-voucher splitting follows exactly the
    // rule getGstReport uses, so the two are only ever right together. Assert agreement, not
    // just a count — a filter fixed on one side alone is the failure being guarded against.
    const tally = await salesExport(shop.id, day, day);
    assert.equal(tally.count, 1, "the Tally export drops the deleted bill too");
    assert.equal(tally.xml.includes(doomed.billNo), false, "the deleted bill has no voucher");
    assert.equal(tally.xml.includes(kept.billNo), true, "the surviving one does");
    // One voucher per bill the GST report counted…
    const gstNow = await getGstReport(shop.id, range);
    assert.equal(
      (tally.xml.match(/<VOUCHER /g) ?? []).length,
      gstNow.totalBills,
      "GST screen and Tally export must count the same bills for the same period",
    );
    // …carrying the same money, split the same way. The voucher posts the taxable value to
    // Sales and each half of the tax to its own Output ledger, which is precisely the split
    // getGstReport reports — so assert them against each other rather than against literals.
    const ledgerAmount = (name) => {
      const match = tally.xml.match(new RegExp(`<LEDGERNAME>${name}</LEDGERNAME>[\\s\\S]*?<AMOUNT>(-?[\\d.]+)</AMOUNT>`));
      return match ? Number(match[1]) : null;
    };
    assert.equal(ledgerAmount("Sales"), gstNow.taxableSales, "Sales ledger carries the taxable value the GST report shows");
    assert.equal(ledgerAmount("Output CGST"), gstNow.cgst, "CGST matches the GST report");
    assert.equal(ledgerAmount("Output SGST"), gstNow.sgst, "SGST matches the GST report");
    // The party is credited the gross, which is taxable + both halves of the tax.
    assert.equal(ledgerAmount("Cash"), -(gstNow.taxableSales + gstNow.cgst + gstNow.sgst), "the party line is the gross");
    // Estimates are not tax documents, so neither surface may carry the one binned above.
    assert.equal(tally.xml.includes("EST-"), false, "no estimate voucher in a tax export");

    // The partner REST API reads bills through a different function; same rule applies.
    const api = await listApiResource({
      shopId: shop.id,
      resource: "bills",
      scope: "bills:read",
      query: { limit: 50 },
    });
    assert.equal(api.items.some((row) => row.billNo === doomed.billNo), false, "the integrations API drops it as well");
    assert.equal(api.items.some((row) => row.billNo === kept.billNo), true, "and still serves the live one");

    // ── the export is keyed on the SALE date, not the sync date ─────
    // A bill rung up offline on Monday and synced on Thursday has businessDate Monday and
    // createdAt Thursday. Every report in the app works in businessDate, so an export keyed
    // on createdAt filed that sale in the week it synced in — a month-boundary sync moves it
    // into the wrong filing period outright.
    const backdated = await sellOne(shop.id, product, "rdb-bill-offline");
    const saleDay = dayKeyBefore(day, 3);
    await db.bill.update({
      where: { id: backdated.id },
      // businessDate moves to the day of the sale; createdAt stays today, as a delayed sync leaves it.
      data: { businessDate: middayOn(saleDay) },
    });

    const todayExport = await salesExport(shop.id, day, day);
    assert.equal(
      todayExport.xml.includes(backdated.billNo),
      false,
      "a sale made three days ago is not today's business, whenever its row was written",
    );
    assert.equal(todayExport.count, 1, "today still exports only the bill actually sold today");

    const saleDayExport = await salesExport(shop.id, saleDay, saleDay);
    assert.equal(saleDayExport.count, 1, "and it appears in the period it was actually sold in");
    assert.equal(saleDayExport.xml.includes(backdated.billNo), true);
    // The voucher date Tally files under must be the sale date too, not the sync date.
    assert.equal(
      saleDayExport.xml.includes(`<DATE>${saleDay.replaceAll("-", "")}</DATE>`),
      true,
      "the voucher is dated the day of the sale",
    );
    assert.equal(
      saleDayExport.xml.includes(`<DATE>${day.replaceAll("-", "")}</DATE>`),
      false,
      "never the day the row synced",
    );

    // Same period, same bills: the whole point of matching the report's date basis.
    assert.equal(
      (await getGstReport(shop.id, { from: saleDay, to: saleDay })).totalBills,
      saleDayExport.count,
      "GST screen and Tally export must agree on which period a backdated sale belongs to",
    );

    // Put it back on today so the restore assertions below read the same books as before.
    await db.bill.update({ where: { id: backdated.id }, data: { businessDate: new Date() } });
    await softDeleteBill(shop.id, backdated.id, { reason: "test fixture" });

    // ── restore puts it back ────────────────────────────────────────
    // The filter must read current state, not "was ever deleted".
    await db.bill.update({ where: { id: doomed.id }, data: { deletedAt: null, deletedReason: null } });
    const restored = await getGstReport(shop.id, range);
    assert.equal(restored.totalBills, 2, "restoring a bill puts it back in the GST report");
    assert.equal(restored.gstCollected, 36);

    console.log("report-deleted-bills.examples.js OK");
  } finally {
    // Best-effort teardown. A throw in here would mask a real assertion failure
    // from the body, which is the only error worth reading.
    for (const remove of [
      () => db.billItem.deleteMany({ where: { bill: { shopId: shop.id } } }),
      () => db.payment.deleteMany({ where: { bill: { shopId: shop.id } } }),
      () => db.stockLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.udharLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.bill.deleteMany({ where: { shopId: shop.id } }),
      () => db.locationStock.deleteMany({ where: { shopId: shop.id } }),
      () => db.product.deleteMany({ where: { shopId: shop.id } }),
      () => db.billCounter.deleteMany({ where: { shopId: shop.id } }),
      () => db.financialLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.changeLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.inventoryLot.deleteMany({ where: { shopId: shop.id } }),
      () => db.subscription.deleteMany({ where: { shopId: shop.id } }),
      () => db.storeLocation.deleteMany({ where: { shopId: shop.id } }),
      () => db.shop.delete({ where: { id: shop.id } }),
    ]) {
      await remove().catch(() => {});
    }
  }
}

await main();
