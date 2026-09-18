import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const reports = read("src/modules/reports/reports.routes.js");
const pricing = read("src/modules/pricing/pricing.routes.js");
const offers = read("src/modules/offers/offers.routes.js");
const auth = read("src/modules/auth/auth.routes.js");
const reminders = read("src/modules/reminders/reminders.routes.js");
const featureGates = read("src/modules/feature-gates/featureGate.service.js");

for (const feature of ["payment_mode_reports", "advanced_udhar_reports", "advanced_inventory", "staff_performance_report", "gst_reports", "profit_estimate", "monthly_reports"]) {
  assert.ok(reports.includes(`requireFeature("${feature}")`), `reports route must enforce ${feature}`);
}

// Report exports are gated too, but not with requireFeature. They go through
// requireContinuityAction("export_data"), which resolves to the same
// csv_import_export entitlement for a paying shop AND deliberately keeps working
// after the subscription lapses: a shop that stops paying can still take its own
// data with it. This file used to demand the literal
// `requireFeature("csv_import_export")` on this route and had been failing ever
// since the narrower gate replaced it — unnoticed, because no npm script ran it.
assert.ok(
  reports.match(/router\.post\("\/exports"[^\n]*requireContinuityAction\("export_data"\)/),
  "creating a report export must go through the export_data continuity gate",
);
assert.ok(
  featureGates.includes('featureName === "complete_sale" ? "basic_billing" : "csv_import_export"'),
  "and that gate must still resolve to the csv_import_export entitlement",
);
assert.ok(pricing.match(/router\.post\("\/rules"[^\n]*requireFeature\("dynamic_customer_pricing"\)/), "pricing rule creation must enforce Growth access");
assert.ok(offers.includes('requireFeature("dynamic_customer_pricing")'), "offer mutations must enforce Growth access");
assert.ok(auth.includes('requireFeature("staff_login")'), "staff APIs must enforce Growth access");
assert.ok(reminders.includes('requireFeature("whatsapp_reminders")'), "reminders must enforce Business access");

console.log("Plan enforcement examples passed");
