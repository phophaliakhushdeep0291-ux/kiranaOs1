import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const reports = read("src/modules/reports/reports.routes.js");
const pricing = read("src/modules/pricing/pricing.routes.js");
const offers = read("src/modules/offers/offers.routes.js");
const auth = read("src/modules/auth/auth.routes.js");
const reminders = read("src/modules/reminders/reminders.routes.js");

for (const feature of ["payment_mode_reports", "advanced_udhar_reports", "advanced_inventory", "staff_performance_report", "gst_reports", "profit_estimate", "monthly_reports", "csv_import_export"]) {
  assert.ok(reports.includes(`requireFeature("${feature}")`), `reports route must enforce ${feature}`);
}
assert.ok(pricing.match(/router\.post\("\/rules"[^\n]*requireFeature\("dynamic_customer_pricing"\)/), "pricing rule creation must enforce Growth access");
assert.ok(offers.includes('requireFeature("dynamic_customer_pricing")'), "offer mutations must enforce Growth access");
assert.ok(auth.includes('requireFeature("staff_login")'), "staff APIs must enforce Growth access");
assert.ok(reminders.includes('requireFeature("whatsapp_reminders")'), "reminders must enforce Business access");

console.log("Plan enforcement examples passed");
