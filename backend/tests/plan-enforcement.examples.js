import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const reports = read("src/modules/reports/reports.routes.js");
const pricing = read("src/modules/pricing/pricing.routes.js");
const offers = read("src/modules/offers/offers.routes.js");
const auth = read("src/modules/auth/auth.routes.js");
const reminders = read("src/modules/reminders/reminders.routes.js");

for (const feature of ["payment_mode_reports", "advanced_udhar_reports", "advanced_inventory", "staff_performance_report", "gst_reports", "profit_estimate", "monthly_reports"]) {
  assert.ok(reports.includes(`requireFeature("${feature}")`), `reports route must enforce ${feature}`);
}

// csv_import_export is NOT asserted as a requireFeature above, deliberately. Export
// is entitlement-gated through requireContinuityAction("export_data"), which checks
// csv_import_export while the shop is entitled but still lets a LAPSED shop take its
// own data away — a plain requireFeature would trap the data behind the expiry.
//
// Only the routes that PRODUCE data are listed: creating an export job, and the three
// raw CSV endpoints. Job management (listing, polling, cancelling, downloading a job
// the shop already created) is not a second entitlement check. The raw three carried
// no gate at all, which handed the paid export feature to any plan that asked for the
// CSV directly instead of going through the job.
for (const route of [
  'router.post("/exports"',
  'router.get("/export/bills"',
  'router.get("/export/stock"',
  'router.get("/export/udhar"',
]) {
  const line = reports.split("\n").find((l) => l.trim().startsWith(route));
  assert.ok(line, `expected to find the route ${route}`);
  assert.ok(
    line.includes('requireContinuityAction("export_data")'),
    `${route} must enforce csv_import_export via requireContinuityAction: ${line.trim()}`,
  );
}

assert.ok(pricing.match(/router\.post\("\/rules"[^\n]*requireFeature\("dynamic_customer_pricing"\)/), "pricing rule creation must enforce Growth access");
assert.ok(offers.includes('requireFeature("dynamic_customer_pricing")'), "offer mutations must enforce Growth access");
assert.ok(auth.includes('requireFeature("staff_login")'), "staff APIs must enforce Growth access");
assert.ok(reminders.includes('requireFeature("whatsapp_reminders")'), "reminders must enforce Business access");

console.log("Plan enforcement examples passed");
