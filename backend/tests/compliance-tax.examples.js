import assert from "node:assert/strict";
import fs from "node:fs";
import { buildInvoiceTaxSnapshot, calculateLineTaxBreakdown, validateGstin, validateHsn } from "../src/modules/compliance/compliance.service.js";
import { createCustomerSchema, updateCustomerSchema } from "../src/modules/customers/customers.schema.js";

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

const b2bCustomer = createCustomerSchema.parse({ name: "B2B Buyer", gstNumber: "27AAPFU0939F1ZV" });
assert.equal(b2bCustomer.stateCode, "27", "customer state code must be derived from a valid GSTIN");
assert.equal(b2bCustomer.gstNumber, "27AAPFU0939F1ZV");
assert.equal(createCustomerSchema.safeParse({ name: "Bad checksum", gstNumber: "27AAPFU0939F1ZA" }).success, false);
assert.equal(createCustomerSchema.safeParse({ name: "Wrong state", gstNumber: "27AAPFU0939F1ZV", stateCode: "29" }).success, false);
assert.equal(updateCustomerSchema.parse({ gstNumber: "29AAPFU0939F1ZR" }).stateCode, "29");

const routes = fs.readFileSync(new URL("../src/modules/compliance/compliance.routes.js", import.meta.url), "utf8");
assert.match(routes, /gstr1-working/);
assert.match(routes, /hsn-summary/);
assert.match(routes, /requireRole\("owner", "admin"\)/);

const prismaSchema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const postgresSchema = fs.readFileSync(new URL("../prisma-postgres/schema.prisma", import.meta.url), "utf8");
const billService = fs.readFileSync(new URL("../src/modules/bills/bills.service.js", import.meta.url), "utf8");
assert.match(prismaSchema, /model BillItem \{[\s\S]*?\bhsn\s+String\?/);
assert.match(postgresSchema, /model BillItem \{[\s\S]*?\bhsn\s+String\?/);
assert.match(billService, /hsn: product\?\.hsn \?\? item\.hsn \?\? null/);
assert.equal(fs.existsSync(new URL("../prisma/migrations/20260718070000_bill_item_hsn_snapshot/migration.sql", import.meta.url)), true);
assert.equal(fs.existsSync(new URL("../prisma-postgres/migrations/000062_bill_item_hsn_snapshot/migration.sql", import.meta.url)), true);

console.log("Compliance tax and HSN examples passed");
