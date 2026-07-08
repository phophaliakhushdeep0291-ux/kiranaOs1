import assert from "assert";
import fs from "fs";

function read(file) { return fs.readFileSync(file, "utf8"); }
function exists(file) { return fs.existsSync(file); }

for (const file of [
  "src/modules/reports/reports.service.js",
  "src/modules/reports/reports.controller.js",
  "src/modules/reports/reports.routes.js",
  "src/modules/reports/reports.schema.js",
  "src/workers/reports.worker.js",
]) {
  assert(exists(file), `${file} must exist`);
}

const service = read("src/modules/reports/reports.service.js");
const controller = read("src/modules/reports/reports.controller.js");
const routes = read("src/modules/reports/reports.routes.js");
const schema = read("src/modules/reports/reports.schema.js");
const reportsWorker = read("src/workers/reports.worker.js");
const productionCheck = read("scripts/production-check.js");
const packageJson = JSON.parse(read("package.json"));

for (const endpoint of [
  '"/daily-closing"',
  '"/sales-summary"',
  '"/payment-modes"',
  '"/udhar-ageing"',
  '"/top-products"',
  '"/inventory-health"',
  '"/staff-sales"',
]) {
  assert(routes.includes(endpoint), `reports route missing ${endpoint}`);
}

for (const fn of [
  "getDailyClosing",
  "getSalesSummary",
  "getPaymentModeReport",
  "getUdharAgeing",
  "getTopProducts",
  "getInventoryHealth",
  "getStaffSales",
  "generateDailyClosingSnapshot",
  "getDailyClosingSnapshot",
  "refreshDailyClosingSnapshot",
]) {
  assert(service.includes(`export async function ${fn}`), `reports.service missing ${fn}`);
}

for (const field of [
  "totalSalesPaise",
  "cashReceivedPaise",
  "upiReceivedPaise",
  "udharGivenPaise",
  "oldUdharRecoveredPaise",
  "expectedCashPaise",
  "pendingSyncCount",
  "topProducts",
  "lowStock",
]) {
  assert(service.includes(field), `daily closing must include ${field}`);
}

assert(service.includes('status: "active"'), "reports must filter active bills for real sales");
// Estimates count as sales everywhere except the GST report, which keeps its own filter.
assert(service.includes('const GST_BILL_FILTER = { status: "active", billType: { not: "estimate" } }'), "GST report must keep excluding estimates (kacha bills are not tax documents)");
assert(service.includes('status: "cancelled"'), "daily/report logic must count cancelled bills separately");
assert(service.includes("offlineSyncEvent.count"), "daily closing must include pending sync count");

for (const field of [
  "averageBillValuePaise",
  "cashSalesPaise",
  "upiSalesPaise",
  "udharSalesPaise",
  "partialSalesPaise",
  "cancelledSalesPaise",
  "discountsPaise",
  "waivedAmountPaise",
  "grossProfitPaise",
  "dailyBreakdown",
]) {
  assert(service.includes(field), `sales summary must include ${field}`);
}

assert(service.includes("getReportRangeLimit"), "report range must respect subscription plan limits");
assert(service.includes("REPORT_RANGE_LIMIT_EXCEEDED"), "range limit violations must return a stable error code");
assert(schema.includes('"today"') && schema.includes('"7d"') && schema.includes('"30d"'), "sales summary schema must support today/7d/30d");

for (const field of ["cashPaise", "upiPaise", "cardPaise", "creditUdharPaise", "mixedPayments", "oldUdharRecoveredPaise", "refundPaise", "reversalPaise"]) {
  assert(service.includes(field), `payment mode report must include ${field}`);
}
assert(service.includes("new Set(b.payments.map"), "payment mode report should detect mixed payments without double-counting");

for (const bucket of ["0_7_days", "8_30_days", "31_60_days", "60_plus_days"]) {
  assert(service.includes(bucket), `udhar ageing must include bucket ${bucket}`);
}
assert(service.includes("maskPhone"), "udhar ageing should mask customer phone numbers");
assert(service.includes("udharAmount: { gt: 0 }"), "udhar ageing must use authoritative customer balance");

assert(service.includes("quantitySoldBase"), "top products/inventory reports must include sold quantity");
assert(service.includes("MAX_TOP_LIMIT"), "top products must cap maximum result size");
assert(service.includes("lowStockThreshold"), "inventory health must use low-stock threshold");
assert(service.includes("negativeStock"), "inventory health must surface negative stock");
assert(service.includes("deadStock"), "inventory health must surface dead stock");
assert(service.includes("fastMoving") && service.includes("slowMoving"), "inventory health must include movement categories");

assert(service.includes("createdByUserId") && service.includes("Unknown / Legacy"), "staff report must use createdByUserId and include Unknown/Legacy bucket");
assert(routes.includes('requireRole("owner", "admin")'), "staff-sales must remain owner/admin protected");
assert(controller.includes("canViewProfit"), "controller must decide profit/cost visibility centrally");
assert(controller.includes("includeProfit: canViewProfit(req)") && controller.includes("includeCost: canViewProfit(req)"), "staff must not receive profit/cost fields");
assert(routes.includes('router.get("/pnl", requireRole("owner")'), "P&L must remain owner-only");
assert(routes.includes("requireOwnerPin"), "export routes must still require owner PIN");

assert(reportsWorker.includes("generateDailyClosingSnapshot"), "Phase 10 daily closing worker must use Phase 11 report generator");
assert(reportsWorker.includes("dailyClosingSnapshot.service.js") || reportsWorker.includes("DailyClosingSnapshot"), "daily closing worker must use persisted snapshot service");

for (const snippet of ["Phase 11", "daily-closing", "sales-summary", "payment-modes", "udhar-ageing", "inventory-health", "REPORT_RANGE_LIMIT_EXCEEDED", "phase11-shopkeeper-reports.examples.js"]) {
  assert(productionCheck.includes(snippet), `production-check missing Phase 11 snippet: ${snippet}`);
}

assert(packageJson.scripts["test:billing"].includes("phase11-shopkeeper-reports.examples.js"), "Phase 11 report tests must be wired into npm test");

console.log("Phase 11 shopkeeper reports examples passed");
