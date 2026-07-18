import assert from "node:assert/strict";
import fs from "node:fs";
import { buildGstr1WorkingFromRegister, buildInvoiceTaxSnapshot, calculateLineTaxBreakdown, validateGstin, validateHsn } from "../src/modules/compliance/compliance.service.js";
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

const returnedIntrastate = calculateLineTaxBreakdown({ lineTotal: -118, gstRate: 18 }, "inclusive", "27", "27");
assert.equal(returnedIntrastate.taxableValue, -100);
assert.equal(returnedIntrastate.cgst, -9);
assert.equal(returnedIntrastate.sgst, -9);
assert.equal(returnedIntrastate.igst, 0);
assert.equal(returnedIntrastate.lineTotal, -118);

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

const register = {
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-07-31T23:59:59.999Z",
  rows: [
    { invoiceNumber: "INV-1", invoiceDate: "2026-07-01", documentType: "invoice", customerName: "Registered", buyerGstin: "27AAPFU0939F1ZV", placeOfSupply: "27", supplyType: "intrastate", originalInvoiceValue: 0, hsn: "1905", description: "Biscuits", quantity: 1, unit: "piece", gstRate: 18, taxableValue: 100, cgst: 9, sgst: 9, igst: 0, discount: 0, lineTotal: 118 },
    { invoiceNumber: "RET-1", invoiceDate: "2026-07-02", documentType: "credit_note", originalInvoiceNumber: "INV-1", originalInvoiceDate: "2026-07-01", originalInvoiceValue: 118, customerName: "Registered", buyerGstin: "27AAPFU0939F1ZV", placeOfSupply: "27", supplyType: "intrastate", hsn: "1905", description: "Biscuits", quantity: -0.5, unit: "piece", gstRate: 18, taxableValue: -50, cgst: -4.5, sgst: -4.5, igst: 0, discount: 0, lineTotal: -59 },
    { invoiceNumber: "INV-2", invoiceDate: "2026-07-03", documentType: "invoice", customerName: "Walk-in", buyerGstin: "", placeOfSupply: "27", supplyType: "intrastate", originalInvoiceValue: 0, hsn: "1905", description: "Biscuits", quantity: 1, unit: "piece", gstRate: 18, taxableValue: 100, cgst: 9, sgst: 9, igst: 0, discount: 0, lineTotal: 118 },
    { invoiceNumber: "RET-2", invoiceDate: "2026-07-04", documentType: "credit_note", originalInvoiceNumber: "INV-2", originalInvoiceDate: "2026-07-03", originalInvoiceValue: 118, customerName: "Walk-in", buyerGstin: "", placeOfSupply: "27", supplyType: "intrastate", hsn: "1905", description: "Biscuits", quantity: -0.5, unit: "piece", gstRate: 18, taxableValue: -50, cgst: -4.5, sgst: -4.5, igst: 0, discount: 0, lineTotal: -59 },
    { invoiceNumber: "RET-3", invoiceDate: "2026-07-05", documentType: "credit_note", originalInvoiceNumber: "INV-3", originalInvoiceDate: "2026-06-20", originalInvoiceValue: 150000, customerName: "Interstate consumer", buyerGstin: "", placeOfSupply: "29", supplyType: "interstate", hsn: "1905", description: "Biscuits", quantity: -1, unit: "piece", gstRate: 18, taxableValue: -100, cgst: 0, sgst: 0, igst: -18, discount: 0, lineTotal: -118 },
  ],
};
const working = buildGstr1WorkingFromRegister(register);
assert.equal(working.b2b.length, 1);
assert.equal(working.cdnr.length, 1);
assert.equal(working.cdnr[0].noteValue, 59);
assert.equal(working.cdnr[0].taxableValue, 50);
assert.equal(working.cdnur.length, 1);
assert.equal(working.cdnur[0].noteValue, 118);
assert.equal(working.b2cs[0].invoiceValue, 59, "small B2C returns must net against B2CS rather than becoming CDNUR");

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
