/**
 * Pulls every reporting / analytics surface the API exposes for the simulated
 * shop and writes them to out/reports.json plus a readable markdown digest.
 *
 *   DATABASE_URL="file:./yearsim.db" node scripts/year-sim/report.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeClient, fmtINR, OWNER_PIN, ApiError } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SIM_OUT ?? path.join(HERE, "out");
const summary = JSON.parse(fs.readFileSync(path.join(OUT, "simulation-summary.json"), "utf8"));

const FROM = summary.period.from;
const TO = summary.period.to;
const client = makeClient({ deviceId: "sim-counter-desktop-01", pin: OWNER_PIN });

const results = {};
const failures = [];

async function grab(label, fn) {
  try {
    results[label] = await fn();
    return results[label];
  } catch (err) {
    const detail = err instanceof ApiError ? `${err.status} ${JSON.stringify(err.body?.error ?? err.body)}` : err.message;
    failures.push(`${label}: ${detail}`.slice(0, 300));
    results[label] = { __error: detail };
    return null;
  }
}

async function main() {
  const session = await client.post("/auth/login", {
    mobile: summary.ownerMobile, password: "Kirana@2025", shopId: summary.shopId,
  });
  client.setToken(session.accessToken ?? session.token);
  console.log(`Logged in as owner of ${summary.shopName}`);

  // ── sales & profitability ────────────────────────────────────────
  await grab("salesSummaryYear", () => client.get(`/reports/sales-summary?from=${FROM}&to=${TO}`));
  await grab("salesSummary30d", () => client.get("/reports/sales-summary?range=30d"));
  await grab("pnlYearly", () => client.get(`/reports/pnl?from=${FROM}&to=${TO}`));
  await grab("pnlMonthlyRange", () => client.get("/reports/pnl?range=monthly"));
  await grab("monthlyBreakdown2025", () => client.get("/reports/monthly-breakdown?year=2025&untilMonth=12"));
  await grab("monthlyBreakdown2026", () => client.get("/reports/monthly-breakdown?year=2026&untilMonth=7"));
  await grab("topProducts", () => client.get(`/reports/top-products?from=${FROM}&to=${TO}&limit=100`));

  // month-by-month P&L (the monthly-breakdown report excludes operating expenses)
  const months = [];
  for (let m = 0; m < 13; m += 1) {
    const start = new Date(2025, 6 + m, 1);
    const end = new Date(2025, 7 + m, 0);
    const fromIso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
    const toIso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    const label = start.toLocaleString("en-IN", { month: "short", year: "numeric" });
    const pnl = await grab(`pnl_${fromIso.slice(0, 7)}`, () => client.get(`/reports/pnl?from=${fromIso}&to=${toIso}`));
    const gst = await grab(`gst_${fromIso.slice(0, 7)}`, () => client.get(`/reports/gst?from=${fromIso}&to=${toIso}`));
    months.push({ label, from: fromIso, to: toIso, pnl, gst });
  }
  results.monthlyPnl = months;
  await grab("paymentModes", () => client.get(`/reports/payment-modes?from=${FROM}&to=${TO}`));
  await grab("paymentSummary", () => client.get("/reports/payment-summary"));
  await grab("staffSales", () => client.get(`/reports/staff-sales?from=${FROM}&to=${TO}`));

  // ── credit book ──────────────────────────────────────────────────
  await grab("udharSummary", () => client.get("/udhar/summary"));
  await grab("udharAgeing", () => client.get("/reports/udhar-ageing"));
  await grab("udharLedgerPage", () => client.get("/udhar?page=1&limit=20"));

  // ── inventory ────────────────────────────────────────────────────
  await grab("inventoryHealth", () => client.get("/reports/inventory-health?windowDays=90"));
  await grab("lowStock", () => client.get("/inventory/low-stock"));
  await grab("inventory", () => client.get("/inventory"));
  await grab("reorderSuggestions", () => client.get("/purchase-orders/suggestions"));
  await grab("stockLedgerPage", () => client.get("/inventory/ledger?page=1&limit=20"));
  await grab("stockCounts", () => client.get("/inventory/counts?status=all&limit=20"));
  await grab("inventoryLots", () => client.get("/inventory-lots?limit=20"));

  // ── purchases & suppliers ────────────────────────────────────────
  await grab("purchaseOrders", () => client.get("/purchase-orders?status=all&limit=50"));
  await grab("suppliers", () => client.get("/suppliers"));
  await grab("purchaseReturns", () => client.get("/purchase-returns"));

  // ── expenses ─────────────────────────────────────────────────────
  await grab("expenseOverview", () => client.get("/expenses/overview"));
  await grab("expenseSummary", () => client.get(`/expenses/summary?from=${FROM}&to=${TO}`));

  // ── tax & compliance ─────────────────────────────────────────────
  await grab("gstReport", () => client.get(`/reports/gst?from=${FROM}&to=${TO}`));
  await grab("complianceReadiness", () => client.get("/compliance/readiness"));
  await grab("hsnSummary", () => client.get("/compliance/hsn-summary"));
  await grab("gstRegister", () => client.get(`/compliance/gst-register?from=2026-06-01&to=2026-06-30`));
  await grab("gstr1Working", () => client.get(`/compliance/gstr1-working?from=2026-06-01&to=2026-06-30`));

  // ── accounting ───────────────────────────────────────────────────
  await grab("accountingControl", () => client.get(`/accounting/control?from=${new Date(`${FROM}T00:00:00+05:30`).toISOString()}&to=${new Date(`${TO}T23:59:59+05:30`).toISOString()}`));

  // ── loyalty / offers / gift cards ────────────────────────────────
  await grab("loyaltyProgram", () => client.get("/loyalty/program"));
  await grab("loyaltyAccounts", () => client.get("/loyalty/accounts"));
  await grab("offers", () => client.get("/offers"));
  await grab("giftCards", () => client.get("/gift-cards?status=all&limit=50"));

  // ── daily closing (yesterday of the simulated year) ──────────────
  await grab("dailyClosingLive", () => client.get(`/reports/daily-closing?date=${TO}`));
  await grab("dailyClosingSnapshot", () => client.post("/reports/daily-closing/snapshot", { date: TO }));
  await grab("dailyClosingDiwali", () => client.get("/reports/daily-closing?date=2025-10-20"));

  // ── customers, bills, products lists ─────────────────────────────
  await grab("customers", () => client.get("/customers"));
  await grab("billsPage", () => client.get(`/bills?from=${FROM}&to=${TO}&page=1&limit=5`));
  await grab("products", () => client.get("/products"));
  await grab("shop", () => client.get("/shops"));
  await grab("subscription", () => client.get("/subscription/current"));

  // ── async CSV export job pipeline ────────────────────────────────
  const job = await grab("exportJobCreate", () => client.post("/reports/exports", {
    reportType: "bills_csv", params: { from: "2026-06-01", to: "2026-06-30" },
  }));
  if (job && !job.__error) {
    const jobId = job.id ?? job.job?.id;
    for (let i = 0; i < 12 && jobId; i += 1) {
      const state = await client.get(`/reports/exports/${jobId}`).catch(() => null);
      results.exportJobStatus = state;
      const status = state?.status ?? state?.job?.status;
      if (status && !["queued", "pending", "running", "processing"].includes(status)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await grab("exportJobList", () => client.get("/reports/exports?limit=10"));

  // ── direct CSV exports (streamed, no queue needed) ───────────────
  for (const [label, url] of [
    ["csvBills", `/reports/export/bills?from=2026-06-01&to=2026-06-30`],
    ["csvStock", "/reports/export/stock"],
    ["csvUdhar", "/reports/export/udhar"],
  ]) {
    await grab(label, async () => {
      const csv = await client.get(url);
      const text = typeof csv === "string" ? csv : JSON.stringify(csv);
      fs.writeFileSync(path.join(OUT, `${label}.csv`), text);
      return { bytes: text.length, rows: text.split("\n").length - 1, savedAs: `${label}.csv` };
    });
  }

  // ── diagnostics / sync health ────────────────────────────────────
  await grab("syncStatus", () => client.get("/sync/status"));
  await grab("syncDiagnostics", () => client.get("/sync/diagnostics"));
  await grab("diagnosticsErrors", () => client.get("/diagnostics/errors"));

  fs.writeFileSync(path.join(OUT, "reports.json"), JSON.stringify({ period: { FROM, TO }, results, failures }, null, 2));
  console.log(`\nPulled ${Object.keys(results).length} surfaces, ${failures.length} failed`);
  for (const f of failures) console.log(`  ! ${f}`);

  const sales = results.salesSummaryYear ?? {};
  console.log(`\nYear ${FROM} → ${TO}`);
  console.log(`  bills          ${sales.billCount ?? sales.totalBills ?? "?"}`);
  console.log(`  revenue        ${fmtINR(sales.totalSales ?? sales.revenue ?? 0)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
