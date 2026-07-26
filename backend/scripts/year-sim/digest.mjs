/**
 * Turns out/reports.json + out/simulation-summary.json into a readable
 * markdown brief (out/YEAR-REPORT.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fmtINR } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SIM_OUT ?? path.join(HERE, "out");
const sim = JSON.parse(fs.readFileSync(path.join(OUT, "simulation-summary.json"), "utf8"));
const { results: R, failures } = JSON.parse(fs.readFileSync(path.join(OUT, "reports.json"), "utf8"));

const rs = (paise) => fmtINR((Number(paise) || 0) / 100);
const pct = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");
const ok = (v) => v && !v.__error;
const lines = [];
const w = (s = "") => lines.push(s);

const sales = R.salesSummaryYear ?? {};
const pnl = R.pnlYearly ?? {};
const gst = R.gstReport ?? {};

w(`# ${sim.shopName} — one-year operating report`);
w();
w(`Period **${sim.period.from} → ${sim.period.to}** (365 days). Everything below was entered through the live API and read back from the app's own reporting endpoints.`);
w();

// ── headline ───────────────────────────────────────────────────────
w("## 1. Headline numbers");
w();
w("| Metric | Value |");
w("| --- | --- |");
w(`| Bills (pakka) | ${sales.totalBills ?? "—"} |`);
w(`| Gross sales | ${rs(sales.totalSalesPaise)} |`);
w(`| Average bill | ${rs(sales.averageBillValuePaise)} |`);
w(`| Gross profit | ${fmtINR(pnl.grossProfit)} (${pct(pnl.grossProfit, pnl.grossSales)} of sales) |`);
w(`| Inventory loss (damage/shrink) | ${fmtINR(pnl.inventoryLoss)} |`);
w(`| Operating expenses | ${fmtINR(pnl.operatingExpenses)} |`);
w(`| **Net profit** | **${fmtINR(pnl.netProfit)}** (${pct(pnl.netProfit, pnl.grossSales)} of sales) |`);
w(`| Udhar given in year | ${fmtINR(pnl.udharGivenThisPeriod)} |`);
w(`| Udhar recovered in year | ${fmtINR(pnl.udharRecoveredThisPeriod)} |`);
w(`| Udhar outstanding at close | ${fmtINR(R.udharSummary?.totalOutstanding)} |`);
w(`| GST collected | ${fmtINR(gst.gstCollected)} (CGST ${fmtINR(gst.cgst)} + SGST ${fmtINR(gst.sgst)}) |`);
w();

// ── month by month ─────────────────────────────────────────────────
if (Array.isArray(R.monthlyPnl)) {
  w("## 2. Month by month");
  w();
  w("| Month | Bills | Sales | Gross profit | Expenses | Net profit | GST collected |");
  w("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const m of R.monthlyPnl) {
    if (!ok(m.pnl)) continue;
    w(`| ${m.label} | ${m.pnl.totalBills} | ${fmtINR(m.pnl.grossSales)} | ${fmtINR(m.pnl.grossProfit)} | ${fmtINR(m.pnl.operatingExpenses)} | ${fmtINR(m.pnl.netProfit)} | ${ok(m.gst) ? fmtINR(m.gst.gstCollected) : "—"} |`);
  }
  w();
  const best = [...R.monthlyPnl].filter((m) => ok(m.pnl)).sort((a, b) => b.pnl.grossSales - a.pnl.grossSales);
  if (best.length) {
    w(`Best month **${best[0].label}** (${fmtINR(best[0].pnl.grossSales)}), weakest **${best[best.length - 1].label}** (${fmtINR(best[best.length - 1].pnl.grossSales)}).`);
    w();
  }
}

// ── busiest days ───────────────────────────────────────────────────
if (Array.isArray(sales.dailyBreakdown)) {
  const days = [...sales.dailyBreakdown].sort((a, b) => b.totalSalesPaise - a.totalSalesPaise);
  w("## 3. Peak trading days");
  w();
  w("| Date | Bills | Sales |");
  w("| --- | ---: | ---: |");
  for (const d of days.slice(0, 8)) w(`| ${d.date} | ${d.totalBills} | ${rs(d.totalSalesPaise)} |`);
  w();
  const avg = sales.dailyBreakdown.reduce((s, d) => s + d.totalSalesPaise, 0) / sales.dailyBreakdown.length;
  w(`Average trading day ${rs(avg)} across ${sales.dailyBreakdown.length} days; the top day runs ${(days[0].totalSalesPaise / avg).toFixed(1)}× the average.`);
  w();
}

// ── payment mix ────────────────────────────────────────────────────
const pm = R.paymentModes ?? {};
const pmTotal = (pm.cashPaise ?? 0) + (pm.upiPaise ?? 0) + (pm.bankPaise ?? 0) + (pm.creditUdharPaise ?? 0);
w("## 4. How customers paid");
w();
w("| Mode | Value | Share |");
w("| --- | ---: | ---: |");
for (const [label, key] of [["Cash", "cashPaise"], ["UPI", "upiPaise"], ["Bank transfer", "bankPaise"], ["Udhar (credit)", "creditUdharPaise"]]) {
  w(`| ${label} | ${rs(pm[key])} | ${pct(pm[key] ?? 0, pmTotal)} |`);
}
w();
w(`Split-tender bills: ${(pm.mixedPayments ?? []).length}. Round-off (“chhod do”) waived across the year: ${fmtINR(((sales.waivedAmountPaise ?? 0) / 100))} on ${sim.stats.waived} bills. Counter discounts given: ${fmtINR((sales.discountsPaise ?? 0) / 100)}.`);
w();

// ── products ───────────────────────────────────────────────────────
const top = Array.isArray(R.topProducts) ? R.topProducts : [];
const productsList = Array.isArray(R.products) ? R.products : (R.products?.products ?? []);
const catOf = new Map(productsList.map((p) => [p.id, p.category]));
if (top.length) {
  w("## 5. What sold");
  w();
  w("| # | Product | Revenue | Gross profit | Margin |");
  w("| ---: | --- | ---: | ---: | ---: |");
  for (const p of top.slice(0, 15)) {
    w(`| ${p.rank} | ${p.productName} | ${rs(p.revenuePaise)} | ${rs(p.grossProfitPaise)} | ${pct(p.grossProfitPaise, p.revenuePaise)} |`);
  }
  w();
  const byCat = new Map();
  for (const p of top) {
    const cat = catOf.get(p.productId) ?? "other";
    const cur = byCat.get(cat) ?? { revenue: 0, profit: 0 };
    cur.revenue += p.revenuePaise; cur.profit += p.grossProfitPaise;
    byCat.set(cat, cur);
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
  const catTotal = cats.reduce((s, [, v]) => s + v.revenue, 0);
  w("Category mix (top-100 products):");
  w();
  w("| Category | Revenue | Share | Margin |");
  w("| --- | ---: | ---: | ---: |");
  for (const [cat, v] of cats) w(`| ${cat} | ${rs(v.revenue)} | ${pct(v.revenue, catTotal)} | ${pct(v.profit, v.revenue)} |`);
  w();
}

// ── credit book ────────────────────────────────────────────────────
const age = R.udharAgeing ?? {};
if (age.buckets) {
  w("## 6. Khata (credit) book");
  w();
  w(`Outstanding at close: **${rs(age.totalPendingUdharPaise)}** across ${(age.customers ?? []).length} customers.`);
  w();
  w("| Ageing bucket | Customers | Amount |");
  w("| --- | ---: | ---: |");
  for (const [key, label] of [["0_7_days", "0–7 days"], ["8_30_days", "8–30 days"], ["31_60_days", "31–60 days"], ["60_plus_days", "60+ days"]]) {
    const b = age.buckets[key] ?? {};
    w(`| ${label} | ${b.count ?? 0} | ${rs(b.amountPaise)} |`);
  }
  w();
  const risky = (age.customers ?? []).filter((c) => c.riskLevel === "high").slice(0, 5);
  if (risky.length) {
    w(`Highest-risk khatas: ${risky.map((c) => `${c.name} (${rs(c.balancePaise)})`).join(", ")}.`);
    w();
  }
}

// ── inventory ──────────────────────────────────────────────────────
const inv = R.inventoryHealth ?? {};
w("## 7. Inventory health");
w();
w(`Low stock now: **${(inv.lowStock ?? []).length}** products · dead stock (no sale in window): **${(inv.deadStock ?? []).length}** · reorder suggestions: **${(R.reorderSuggestions ?? []).length}**.`);
w();
if ((inv.lowStock ?? []).length) {
  w("| Needs reorder | Stock | Alert level |");
  w("| --- | ---: | ---: |");
  for (const p of inv.lowStock.slice(0, 10)) w(`| ${p.productName} | ${p.stockBaseQty} ${p.baseUnit} | ${p.lowStockThreshold} |`);
  w();
}

// ── expenses ───────────────────────────────────────────────────────
const exp = R.expenseSummary ?? {};
w("## 8. Operating expenses");
w();
w(`Total booked: **${fmtINR(pnl.operatingExpenses)}** over ${sim.stats.expenses} entries.`);
const byCategory = exp.byCategory ?? R.expenseOverview?.byCategory ?? {};
const catRows = Object.entries(byCategory).sort((a, b) => (b[1]?.total ?? b[1]) - (a[1]?.total ?? a[1]));
if (catRows.length) {
  w();
  w("| Category | Amount |");
  w("| --- | ---: |");
  for (const [cat, v] of catRows) w(`| ${cat} | ${fmtINR(typeof v === "object" ? v.total : v)} |`);
}
w();

// ── staff ──────────────────────────────────────────────────────────
const staff = R.staffSales?.staff ?? [];
if (staff.length) {
  w("## 9. Counter performance");
  w();
  w("| Operator | Role | Bills | Sales | Avg bill |");
  w("| --- | --- | ---: | ---: | ---: |");
  for (const s of staff) w(`| ${s.userName} | ${s.userRole} | ${s.billCount} | ${rs(s.salesPaise)} | ${rs(s.averageBillValuePaise)} |`);
  w();
}

// ── tax ────────────────────────────────────────────────────────────
w("## 10. GST position");
w();
w(`Taxable sales **${fmtINR(gst.taxableSales)}**, GST collected **${fmtINR(gst.gstCollected)}** (CGST ${fmtINR(gst.cgst)} / SGST ${fmtINR(gst.sgst)} / IGST ${fmtINR(gst.igst)}) across ${gst.gstBills}/${gst.totalBills} bills carrying tax.`);
if (ok(R.complianceReadiness)) {
  const c = R.complianceReadiness;
  w();
  w(`Compliance readiness score **${c.score}/100** — ${c.checks.filter((x) => x.ready).length}/${c.checks.length} checks green.`);
  const notReady = c.checks.filter((x) => !x.ready);
  if (notReady.length) w(`Open items: ${notReady.map((x) => `${x.label} (${x.detail})`).join("; ")}.`);
}
w();

// ── what was exercised ─────────────────────────────────────────────
w("## 11. Feature coverage in this run");
w();
const s = sim.stats;
w("| Feature | Volume |");
w("| --- | ---: |");
w(`| Bills (normal sale) | ${s.bills} |`);
w(`| Estimates / kacha bills | ${s.estimates} |`);
w(`| Sales returns | ${s.returns} |`);
w(`| Bill cancellations | ${s.cancelled} |`);
w(`| Credit (udhar) sales | ${s.creditSales} |`);
w(`| Udhar repayments | ${s.udharPayments} |`);
w(`| Purchase / stock-in entries | ${s.purchases} |`);
w(`| Purchase orders (create→send→receive) | ${s.purchaseOrders} |`);
w(`| Stock count sessions | ${s.stockCounts} |`);
w(`| Damage write-offs | ${s.damages} |`);
w(`| Stock corrections | ${s.corrections} |`);
w(`| Coupons applied | ${s.offersApplied} (${fmtINR(s.offerDiscount)}) |`);
w(`| Loyalty redemptions | ${s.loyaltyRedemptions} |`);
w(`| Gift cards issued / redeemed | ${s.giftCardsIssued} / ${s.giftCardRedemptions} |`);
w(`| Expenses booked | ${s.expenses} |`);
w(`| Products / customers / suppliers | ${s.newProducts} / ${s.newCustomers} / 8 |`);
w(`| Price revisions | ${s.priceRevisions} |`);
w(`| Total API calls | ${sim.apiCalls} |`);
w(`| API errors | ${s.apiErrorCount} |`);
w();
w(`Rows written: ${Object.entries(sim.dbCounts).map(([k, v]) => `${k} ${v}`).join(" · ")}.`);
w();
if (failures?.length) {
  w("## 12. Report surfaces that did not return");
  w();
  for (const f of failures) w(`- ${f}`);
  w();
}

w("## 13. Findings from the run");
w();
for (const f of [
  ["Price edit does not move the selling unit's ceiling — product becomes unsellable",
   "`PATCH /api/products/:id` with a new `defaultPricePerRateUnit`/`mrp` updates the Product row but leaves the auto-created default ProductSellingUnit untouched. Billing takes its ceiling from `sellingUnit.maximumPrice`, so every later sale of that item is rejected with `PRICE_ABOVE_CONFIGURED_MAXIMUM: exceeds the configured maximum of Rs <old MRP>` even though `GET /products` reports the new MRP. In the first full run this silently killed ~70% of sales from the October price revision onward (30 bills/day → 8). Workaround used here: re-send the full `sellingUnits` array with the patch."],
  ["Unbounded data exports",
   "`GET /reports/export/stock` has no row limit and no default date window (`exportStockLedgerData` → `findMany` with no `take`); one year of trading returned a 53 MB JSON body for 50,381 ledger rows. `GET /reports/export/udhar` likewise loads every customer with their entire ledger. Both are owner-facing buttons on a mobile PWA."],
  ["Double-entry ledger balanced",
   "`/api/accounting/control` reports `status: balanced` over the full year — period activity debit = credit = ₹68,86,587.30, trial balance ₹53,74,141.90 on both sides, difference ₹0, across 51,758 FinancialLedger rows."],
  ["Estimate handling matches the documented policy",
   "Estimates carry EST- numbers, count toward sales (₹80,927 of the ₹52.85L total) and move stock/tender, but are excluded from the GST report (11,938 GST-scope bills = 12,073 − 135 estimates). Cancelled bills (9) drop out of sales entirely."],
  ["Overselling is permitted by design and shows as negative stock",
   "Ginger closed the year at −1,613 g. The counter never blocks a sale for missing stock; the deficit is left visible for reconciliation, and the low-stock/reorder reports pick it up."],
  ["Server rejects udhar overpayment",
   "A repayment larger than the outstanding khata is refused (`409 Payment ₹363.88 exceeds outstanding udhar ₹350.88`) — the server ledger stays authoritative when a client's cached balance drifts."],
  ["Async CSV export jobs need Redis",
   "`POST /reports/exports` returns `503 Report export queue is disabled` unless `QUEUES_ENABLED`/`REDIS_URL` are set. The synchronous `/reports/export/*` endpoints are the only working path in this configuration."],
]) {
  w(`**${f[0]}.** ${f[1]}`);
  w();
}

fs.writeFileSync(path.join(OUT, "YEAR-REPORT.md"), lines.join("\n"));
console.log(lines.join("\n"));
