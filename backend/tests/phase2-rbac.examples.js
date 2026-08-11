/**
 * phase2-rbac.examples.js
 *
 * Static assertions for Phase 2 RBAC hardening and billing safety guard:
 *   A. Customer delete requires owner PIN.
 *   A. Customer with outstanding udhar is blocked from deletion (CUSTOMER_HAS_OUTSTANDING_UDHAR).
 *   A. Customer delete produces an audit log (CUSTOMER_DELETED / CUSTOMER_DELETE_BLOCKED).
 *   B. Product POST with sensitive price/cost/stock fields requires owner PIN.
 *   B. Product create with sensitive fields produces an audit log.
 *   C. P&L report route is owner-only (requireRole("owner")).
 *   C. Monthly-breakdown route is owner-only.
 *   C. Top-products route is owner-only (includes profit).
 *   C. Payment-summary route remains accessible to all (no profit data).
 *   D. waivedAmount > grandTotal is rejected with INVALID_WAIVED_AMOUNT.
 *   D. Existing normal billing (waivedAmount == 0 or < grandTotal) still works.
 */

import assert from "node:assert/strict";
import fs from "node:fs";

const customerRoutes  = fs.readFileSync("src/modules/customers/customers.routes.js", "utf8");
const customerService = fs.readFileSync("src/modules/customers/customers.service.js", "utf8");
const customerCtrl    = fs.readFileSync("src/modules/customers/customers.controller.js", "utf8");
const productRoutes   = fs.readFileSync("src/modules/products/products.routes.js", "utf8");
const productCtrl     = fs.readFileSync("src/modules/products/products.controller.js", "utf8");
const productService  = fs.readFileSync("src/modules/products/products.service.js", "utf8");
const reportRoutes    = fs.readFileSync("src/modules/reports/reports.routes.js", "utf8");
const billsService    = fs.readFileSync("src/modules/bills/bills.service.js", "utf8");
const packageJson     = JSON.parse(fs.readFileSync("package.json", "utf8"));

// ── A. Customer delete — owner PIN required ───────────────────────────────

assert.match(
  customerRoutes,
  /requireOwnerPin/,
  "customers.routes.js must import and use requireOwnerPin"
);

assert.match(
  customerRoutes,
  /router\.delete\("\/\:id",\s*requireOwnerPin,\s*ctrl\.remove\)/,
  "customer DELETE /:id must be protected by requireOwnerPin"
);

// ── A. Customer delete — outstanding udhar blocks deletion ─────────────────

assert.match(
  customerService,
  /CUSTOMER_HAS_OUTSTANDING_UDHAR/,
  "softDeleteCustomer must throw CUSTOMER_HAS_OUTSTANDING_UDHAR when udharAmount > 0"
);

assert.match(
  customerService,
  /udharAmount\s*>\s*0/,
  "softDeleteCustomer must check udharAmount before allowing soft delete"
);

assert.doesNotMatch(
  customerService,
  /db\.customer\.delete\(/,
  "customers service must never hard-delete — only soft-delete via deletedAt"
);

// ── A. Customer delete — audit logs ────────────────────────────────────────

assert.match(
  customerService,
  /CUSTOMER_DELETED/,
  "softDeleteCustomer must emit CUSTOMER_DELETED audit log on success"
);

assert.match(
  customerService,
  /CUSTOMER_DELETE_BLOCKED/,
  "softDeleteCustomer must emit CUSTOMER_DELETE_BLOCKED audit log when udhar blocks"
);

assert.match(
  customerService,
  /createAuditLog/,
  "customers service must import and call createAuditLog"
);

// Controller passes actor context to service
assert.match(
  customerCtrl,
  /actorUserId:\s*req\.user\?\.userId/,
  "customer remove controller must pass actorUserId to softDeleteCustomer"
);

// ── B. Product create — sensitive fields require owner PIN ─────────────────

assert.match(
  productRoutes,
  /requireOwnerPinForFields\(protectedProductFields\),\s*validate\(createProductSchema\)/,
  "product POST route must run requireOwnerPinForFields before validation"
);

// The list of protected fields must be defined and used for both POST and PATCH
assert.match(
  productRoutes,
  /protectedProductFields\s*=\s*\[/,
  "products.routes.js must define protectedProductFields array"
);

assert.match(
  productRoutes,
  /defaultPricePerRateUnit/,
  "protectedProductFields must include defaultPricePerRateUnit"
);

assert.match(
  productRoutes,
  /costPerRateUnit/,
  "protectedProductFields must include costPerRateUnit"
);

// ── B. Product create — audit log for sensitive fields ─────────────────────

assert.match(
  productService,
  /PRODUCT_CREATED_WITH_SENSITIVE_FIELDS/,
  "product create service must emit PRODUCT_CREATED_WITH_SENSITIVE_FIELDS in the transaction"
);

assert.match(
  productService,
  /sensitiveFields/,
  "product create audit must include which sensitive fields were present"
);

assert.match(
  productService,
  /writeRequiredProductAudit[\s\S]*?PRODUCT_AUDIT_WRITE_FAILED/,
  "product mutations must fail closed when their audit row cannot be stored"
);

// Owner can still create a product without a PIN if no sensitive fields are sent
// (requireOwnerPinForFields returns next() when no protected fields in body)
assert.match(
  productRoutes,
  /requireOwnerPinForFields/,
  "product POST uses requireOwnerPinForFields (not full requireOwnerPin) so non-sensitive creates work"
);

assert.doesNotMatch(
  productRoutes,
  /router\.post\("\/",\s*requireOwnerPin,/,
  "product POST must NOT use requireOwnerPin (hard gate) — must use requireOwnerPinForFields so staff can create name-only products"
);

// ── C. Report routes — owner-only for profit/revenue data ─────────────────

assert.match(
  reportRoutes,
  /requireRole/,
  "reports.routes.js must import requireRole"
);

assert.match(
  reportRoutes,
  /\/pnl".*requireRole\("owner"\)/,
  "P&L route must require owner role"
);

assert.match(
  reportRoutes,
  /\/monthly-breakdown".*requireRole\("owner"\)/,
  "monthly-breakdown route must require owner role"
);

assert.match(
  reportRoutes,
  /\/top-products".*requireRole\("owner"\)/,
  "top-products route must require owner role (includes per-product profit)"
);

// Payment summary must NOT be behind requireRole — staff need it for day-to-day ops
assert.doesNotMatch(
  reportRoutes,
  /\/payment-summary".*requireRole/,
  "payment-summary must not require owner role — it only shows cash/upi totals, no profit"
);

// Export routes remain owner-PIN protected (not changed)
assert.match(
  reportRoutes,
  /\/export\/bills.*requireOwnerPin/,
  "export/bills must still require owner PIN"
);

assert.match(
  reportRoutes,
  /\/export\/udhar.*requireOwnerPin/,
  "export/udhar must still require owner PIN"
);

// ── D. waivedAmount billing guard ─────────────────────────────────────────

assert.match(
  billsService,
  /INVALID_WAIVED_AMOUNT/,
  "confirmBill must set err.code = INVALID_WAIVED_AMOUNT when waived exceeds total"
);

assert.match(
  billsService,
  /waivedAmount\s*>\s*grandTotal/,
  "confirmBill must compare waivedAmount > grandTotal and throw"
);

assert.match(
  billsService,
  /Waived amount.*cannot exceed bill total/,
  "INVALID_WAIVED_AMOUNT error must include a clear human-readable message"
);

// Estimates are full sales now, so the waivedAmount guard applies to every bill type —
// the old estimate-only skip must be gone.
assert.doesNotMatch(
  billsService,
  /!isEstimate.*waivedAmount\s*>\s*grandTotal/,
  "waivedAmount guard must apply to estimates too (no estimate skip)"
);

// Existing payment coverage validation is still present
assert.match(
  billsService,
  /moneyEquals\(paymentCoverage, grandTotal\)/,
  "confirmBill must still validate that payment+credit+waived covers grandTotal"
);

// Existing buyerPaidAmount guard is still present
assert.match(
  billsService,
  /buyerPaidAmount\s*>\s*grandTotal/,
  "confirmBill must still check buyerPaidAmount does not exceed grandTotal"
);

// ── E. Test is included in the test chain ─────────────────────────────────

assert.ok(
  packageJson.scripts["test:billing"].includes("phase2-rbac.examples.js"),
  "test:billing must include phase2-rbac.examples.js"
);

console.log("Phase 2 RBAC examples passed");
