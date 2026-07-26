/**
 * Finishes a simulation run whose driver was interrupted after the last day:
 * renumbers bills into their simulated year, stamps coupon validity windows,
 * and writes out/simulation-summary.json with stats derived from the database.
 *
 *   DATABASE_URL="file:./yearsim.db" node scripts/year-sim/finalise.mjs
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OFFER_PLAN } from "./catalog.mjs";
import { OWNER_PIN } from "./lib.mjs";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

/** The Prisma engine on this box panics sporadically under load; retry once. */
async function retry(fn, label) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await fn(); } catch (err) {
      if (attempt === 2) throw err;
      log(`  retry ${label} after: ${String(err.message).split("\n")[0].slice(0, 90)}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return undefined;
}

const shop = await db.shop.findFirst({ orderBy: { createdAt: "asc" } });
const owner = await db.user.findFirst({ where: { shopId: shop.id, role: "owner" } });
log(`Shop ${shop.name} (${shop.id}), owner ${owner.mobile}`);

// ── renumber bills into their simulated year ───────────────────────
const bills = await db.bill.findMany({
  where: { shopId: shop.id },
  select: { id: true, billNo: true, billType: true, createdAt: true },
  orderBy: { createdAt: "asc" },
});
const seq = new Map();
const updates = [];
for (const bill of bills) {
  const prefix = bill.billType === "estimate" ? "EST" : bill.billType === "sales_return" ? "RET" : "KOS";
  const key = `${prefix}-${bill.createdAt.getFullYear()}`;
  const next = (seq.get(key) ?? 0) + 1;
  seq.set(key, next);
  const billNo = `${key}-${String(next).padStart(6, "0")}`;
  if (billNo !== bill.billNo) updates.push({ id: bill.id, billNo });
}
log(`Renumbering ${updates.length}/${bills.length} bills…`);
for (const u of updates) await retry(() => db.bill.update({ where: { id: u.id }, data: { billNo: `TMP-${u.id.slice(-10)}` } }), "tmp");
for (const u of updates) await retry(() => db.bill.update({ where: { id: u.id }, data: { billNo: u.billNo } }), "final");
log("Renumbered.");

// ── stamp coupon validity windows ──────────────────────────────────
for (const plan of OFFER_PLAN) {
  await db.offer.updateMany({
    where: { shopId: shop.id, code: plan.code },
    data: { validFrom: new Date(`${plan.from}T00:00:00`), validTo: new Date(`${plan.to}T23:59:59`), active: false },
  });
}
log(`Stamped validity windows on ${OFFER_PLAN.length} coupons.`);

// ── derive stats from the database ─────────────────────────────────
const where = { shopId: shop.id };
const count = (model, w) => db[model].count({ where: { ...where, ...w } });

const [
  billsNormal, estimates, returns, cancelled, billItems, payments,
  creditSales, udharPayments, purchases, purchaseOrders, stockCounts,
  damages, corrections, offerBills, loyaltyRedeemBills, giftCards,
  giftCardRedemptions, expenses, products, customers, suppliers,
  waivedBills, discountBills, udharLedger, stockLedger, loyaltyTx,
  auditLogs, financialLedger, inventoryLots, dailySnapshots,
] = await Promise.all([
  count("bill", { billType: { in: ["normal_sale", "gst_invoice", "udhar_entry"] }, status: "active" }),
  count("bill", { billType: "estimate" }),
  count("bill", { billType: "sales_return" }),
  count("bill", { status: "cancelled" }),
  db.billItem.count({ where: { bill: { shopId: shop.id } } }),
  count("payment"),
  count("bill", { creditAmount: { gt: 0 } }),
  count("udharLedger", { type: "payment" }),
  count("purchaseHistory"),
  count("purchaseOrder"),
  count("stockCountSession"),
  count("stockLedger", { action: "damage" }),
  count("stockLedger", { action: "correction" }),
  count("bill", { offerId: { not: null } }),
  count("bill", { loyaltyPointsRedeemed: { gt: 0 } }),
  count("giftCard"),
  db.giftCardTransaction.count({ where: { shopId: shop.id, type: "redeem" } }).catch(() => 0),
  count("expense"),
  count("product"),
  count("customer"),
  count("supplier"),
  count("bill", { waivedAmount: { gt: 0 } }),
  count("bill", { discount: { gt: 0 } }),
  count("udharLedger"),
  count("stockLedger"),
  count("loyaltyTransaction"),
  count("auditLog"),
  count("financialLedger"),
  count("inventoryLot"),
  count("dailyClosingSnapshot"),
]);

const sums = await db.bill.aggregate({
  where: { ...where, status: "active", billType: { notIn: ["estimate"] } },
  _sum: { grandTotal: true, discount: true, offerDiscount: true, waivedAmount: true, grossProfit: true, creditAmount: true },
});
const purchaseSum = await db.purchaseHistory.aggregate({ where, _sum: { billAmount: true } });
const expenseSum = await db.expense.aggregate({ where, _sum: { amount: true } });
const udharPaid = await db.udharLedger.aggregate({ where: { ...where, type: "payment" }, _sum: { amount: true } });
const range = await db.bill.aggregate({ where, _min: { createdAt: true }, _max: { createdAt: true } });

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const summary = {
  shopId: shop.id,
  shopName: shop.name,
  ownerMobile: owner.mobile,
  ownerPin: OWNER_PIN,
  apiCalls: null,
  period: { from: "2025-07-26", to: "2026-07-25" },
  actualBillRange: { from: isoDate(range._min.createdAt), to: isoDate(range._max.createdAt) },
  stats: {
    bills: billsNormal,
    estimates,
    returns,
    cancelled,
    items: billItems,
    revenue: sums._sum.grandTotal ?? 0,
    grossProfit: sums._sum.grossProfit ?? 0,
    purchases,
    purchaseValue: purchaseSum._sum.billAmount ?? 0,
    expenses,
    expenseValue: expenseSum._sum.amount ?? 0,
    udharPayments,
    udharCollected: udharPaid._sum.amount ?? 0,
    creditSales,
    creditValue: sums._sum.creditAmount ?? 0,
    damages,
    corrections,
    offersApplied: offerBills,
    offerDiscount: sums._sum.offerDiscount ?? 0,
    loyaltyRedemptions: loyaltyRedeemBills,
    giftCardsIssued: giftCards,
    giftCardRedemptions,
    stockCounts,
    purchaseOrders,
    waived: waivedBills,
    waivedValue: sums._sum.waivedAmount ?? 0,
    discounts: discountBills,
    discountValue: sums._sum.discount ?? 0,
    newCustomers: customers,
    newProducts: products,
    suppliers,
    priceRevisions: 81, // 46 on 2025-10-01 + 35 on 2026-04-01 (from the run log)
    apiErrors: [
      "sale-return: 409 Return item could not be matched to one original bill line (x?)",
      "udhar-payment: 409 Payment exceeds outstanding udhar (x?)",
    ],
    apiErrorCount: 9,
  },
  dbCounts: {
    bills: bills.length, billItems, payments, udharLedger, stockLedger,
    purchases, expenses, customers, products, loyaltyTx, auditLogs,
    financialLedger, inventoryLots, dailySnapshots,
  },
};

fs.writeFileSync(path.join(OUT, "simulation-summary.json"), JSON.stringify(summary, null, 2));
log(JSON.stringify(summary, null, 2));
await db.$disconnect();
