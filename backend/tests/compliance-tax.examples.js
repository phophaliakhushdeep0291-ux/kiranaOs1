import assert from "node:assert/strict";
import fs from "node:fs";
import { buildInvoiceTaxSnapshot, calculateLineTaxBreakdown, validateGstin, validateHsn } from "../src/modules/compliance/compliance.service.js";

const intrastateInclusive = calculateLineTaxBreakdown({ lineTotal: 118, gstRate: 18 }, "inclusive", "27", "27");
assert.equal(intrastateInclusive.taxableValue, 100);
assert.equal(intrastateInclusive.cgst, 9);
assert.equal(intrastateInclusive.sgst, 9);
assert.equal(intrastateInclusive.igst, 0);
assert.equal(intrastateInclusive.lineTotal, 118);

const interstateExclusive = calculateLineTaxBreakdown({ lineTotal: 100, gstRate: 18 }, "exclusive", "27", "29");
assert.equal(interstateExclusive.taxableValue, 100);
assert.equal(interstateExclusive.cgst, 0);
assert.equal(interstateExclusive.sgst, 0);
assert.equal(interstateExclusive.igst, 18);
assert.equal(interstateExclusive.lineTotal, 118);

const discounted = buildInvoiceTaxSnapshot({
  gstMode: "inclusive",
  buyerStateCode: "27",
  discount: 10,
  items: [
    { lineTotal: 118, gstRate: 18 },
    { lineTotal: 105, gstRate: 5 },
  ],
}, "27");
assert.equal(discounted.taxableValue, 200);
assert.equal(discounted.tax, 23);
assert.equal(discounted.grossInvoiceValue, 223);
assert.equal(discounted.discount, 10);
assert.equal(discounted.netInvoiceValue, 213);
assert.equal(discounted.lines.reduce((sum, row) => sum + row.discount, 0), 10);

assert.equal(validateGstin("27AAPFU0939F1ZV").valid, true);
assert.equal(validateHsn("1905").valid, true);
assert.equal(validateHsn("19").valid, false);

const routes = fs.readFileSync(new URL("../src/modules/compliance/compliance.routes.js", import.meta.url), "utf8");
assert.match(routes, /gstr1-working/);
assert.match(routes, /hsn-summary/);
assert.match(routes, /requireRole\("owner", "admin"\)/);

console.log("Compliance tax and HSN examples passed");
