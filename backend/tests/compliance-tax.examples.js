import assert from "node:assert/strict";
import fs from "node:fs";
import { buildGstr1WorkingFromRegister, buildInvoiceTaxSnapshot, buildMultiGstinFilingRun, calculateLineTaxBreakdown, filingRunToCsv, validateGstin, validateHsn } from "../src/modules/compliance/compliance.service.js";
import { createCustomerSchema, updateCustomerSchema } from "../src/modules/customers/customers.schema.js";
import { cancelTransferSchema, createLocationSchema, createTransferSchema, receiveTransferSchema, transferComplianceReviewSchema, updateLocationSchema } from "../src/modules/stores/stores.schema.js";
import { billSellerIdentity, locationSellerIdentity } from "../src/utils/gstIdentity.js";

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
assert.equal(discounted.taxableValue, 191.03);
assert.equal(discounted.tax, 21.97);
assert.equal(discounted.grossInvoiceValue, 223);
assert.equal(discounted.discount, 10);
assert.equal(discounted.netInvoiceValue, 213);
assert.equal(discounted.lines.reduce((sum, row) => sum + row.discount, 0), 10);
assert.equal(discounted.lines.reduce((sum, row) => sum + row.tax.taxableValue, 0), 191.03);

assert.equal(validateGstin("27AAPFU0939F1ZV").valid, true);
assert.equal(validateHsn("1905").valid, true);
assert.equal(validateHsn("19").valid, false);

const b2bCustomer = createCustomerSchema.parse({ name: "B2B Buyer", gstNumber: "27AAPFU0939F1ZV" });
assert.equal(b2bCustomer.stateCode, "27", "customer state code must be derived from a valid GSTIN");
assert.equal(b2bCustomer.gstNumber, "27AAPFU0939F1ZV");
assert.equal(createCustomerSchema.safeParse({ name: "Bad checksum", gstNumber: "27AAPFU0939F1ZA" }).success, false);
assert.equal(createCustomerSchema.safeParse({ name: "Wrong state", gstNumber: "27AAPFU0939F1ZV", stateCode: "29" }).success, false);
assert.equal(updateCustomerSchema.parse({ gstNumber: "29AAPFU0939F1ZR" }).stateCode, "29");
const registeredLocation = createLocationSchema.parse({
  name: "Karnataka Branch",
  code: "kar01",
  gstNumber: "29aapfu0939f1zr",
  gstLegalName: "Karnataka Branch Private Limited",
});
assert.equal(registeredLocation.code, "KAR01");
assert.equal(registeredLocation.gstNumber, "29AAPFU0939F1ZR");
assert.equal(registeredLocation.gstStateCode, "29");
assert.equal(createLocationSchema.safeParse({ name: "Bad GST", code: "BAD01", gstNumber: "29AAPFU0939F1ZA" }).success, false);
assert.deepEqual(updateLocationSchema.parse({ gstNumber: null }), { gstNumber: null, gstStateCode: null });
assert.equal(createTransferSchema.safeParse({ fromLocationId: "a", toLocationId: "b", documentNumber: "12345678901234567", items: [{ productId: "p", quantityBaseQty: 1 }] }).success, false);
assert.equal(createTransferSchema.safeParse({ fromLocationId: "a", toLocationId: "b", documentDate: "2026-02-31", items: [{ productId: "p", quantityBaseQty: 1 }] }).success, false);
assert.equal(createTransferSchema.parse({ fromLocationId: "a", toLocationId: "b", items: [{ productId: "p", quantityBaseQty: 1, declaredTaxableValue: 100 }] }).movementReason, "branch_transfer");
assert.equal(createTransferSchema.parse({ fromLocationId: "a", toLocationId: "b", items: [{ productId: "p", quantityBaseQty: 1 }] }).fulfillmentMode, "instant");
assert.equal(createTransferSchema.safeParse({ fromLocationId: "a", toLocationId: "b", fulfillmentMode: "shipment", trackingNumber: "bad<script>", items: [{ productId: "p", quantityBaseQty: 1 }] }).success, false);
assert.equal(receiveTransferSchema.safeParse({ items: [{ transferItemId: "line-1", quantityBaseQty: 0 }] }).success, false);
assert.equal(receiveTransferSchema.safeParse({ items: [{ transferItemId: "line-1", quantityBaseQty: 2 }] }).success, true);
assert.equal(cancelTransferSchema.safeParse({ reason: "short" }).success, false);
assert.equal(cancelTransferSchema.safeParse({ reason: "Carrier shipment was cancelled" }).success, true);
assert.equal(transferComplianceReviewSchema.safeParse({ decision: "external_reference_recorded", reason: "Generated by provider", eWayBillNumber: "1234", eWayBillDate: "2026-07-29" }).success, false);
assert.equal(transferComplianceReviewSchema.safeParse({ decision: "external_reference_recorded", reason: "Generated by provider", eWayBillNumber: "181000609270", eWayBillDate: "2026-07-29" }).success, true);
assert.equal(transferComplianceReviewSchema.safeParse({ decision: "not_required_after_review", reason: "Reviewed exemption evidence", eWayBillNumber: "181000609270", eWayBillDate: "2026-07-29" }).success, false);
assert.equal(transferComplianceReviewSchema.safeParse({ decision: "not_required_after_review", reason: "Reviewed exemption evidence" }).success, true);

const shopIdentity = { name: "Main Legal Name", gstNumber: "27AAPFU0939F1ZV", address: "Main Road", city: "Pune" };
const explicitUnregistered = locationSellerIdentity({ name: "Unregistered Branch", gstNumber: null, address: "Branch Road" }, shopIdentity);
assert.equal(explicitUnregistered.sellerGstin, null, "an explicit unregistered branch must never silently inherit the shop GSTIN");
assert.equal(explicitUnregistered.registrationValid, false);
const billSnapshot = billSellerIdentity({ sellerGstin: "29AAPFU0939F1ZR", sellerLegalName: "Historical Legal Name", sellerAddress: "Old address" }, shopIdentity);
assert.equal(billSnapshot.sellerGstin, "29AAPFU0939F1ZR");
assert.equal(billSnapshot.sellerStateCode, "29");
assert.equal(billSnapshot.sellerLegalName, "Historical Legal Name");
const unregisteredBillSnapshot = billSellerIdentity({ sellerGstin: null, sellerLegalName: "Unregistered Seller" }, shopIdentity);
assert.equal(unregisteredBillSnapshot.sellerGstin, null, "a null seller snapshot must not be replaced with the mutable shop GSTIN");

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

// Regression: a 0%-rated B2C return used to fall through every table — excluded from
// Table 8 as a credit note, excluded from B2CS as nil-rated, and not CDNR/CDNUR because
// the buyer is unregistered. Exempt turnover was overstated and Table 8 contradicted both
// the HSN summary and GSTR-3B, which already netted returns.
const nilRegister = {
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-07-31T23:59:59.999Z",
  rows: [
    { invoiceNumber: "NIL-1", invoiceDate: "2026-07-01", documentType: "invoice", customerName: "Walk-in", buyerGstin: "", placeOfSupply: "27", supplyType: "intrastate", originalInvoiceValue: 0, hsn: "", description: "Maggi Noodles", quantity: 5, unit: "piece", gstRate: 0, taxableValue: 70, cgst: 0, sgst: 0, igst: 0, discount: 0, lineTotal: 70 },
    { invoiceNumber: "NIL-RET-1", invoiceDate: "2026-07-02", documentType: "credit_note", originalInvoiceNumber: "NIL-1", originalInvoiceDate: "2026-07-01", originalInvoiceValue: 70, customerName: "Walk-in", buyerGstin: "", placeOfSupply: "27", supplyType: "intrastate", hsn: "", description: "Maggi Noodles", quantity: -2, unit: "piece", gstRate: 0, taxableValue: -28, cgst: 0, sgst: 0, igst: 0, discount: 0, lineTotal: -28 },
  ],
};
const nilWorking = buildGstr1WorkingFromRegister(nilRegister);
const nilBucketTotal = nilWorking.nilRated.reduce((sum, row) => sum + row.nilRatedOrExempt, 0);
const nilHsnTotal = nilWorking.hsn.reduce((sum, row) => sum + row.totalValue, 0);
assert.equal(nilBucketTotal, 42, "a nil-rated B2C return must net into Table 8 (70 - 28)");
assert.equal(nilHsnTotal, 42, "the HSN summary must still net the same return");
assert.equal(nilBucketTotal, nilHsnTotal, "Table 8 and the HSN summary must reconcile");
assert.equal(nilWorking.b2cs.length, 0, "nil-rated supplies must never leak into the taxable B2CS summary");
assert.equal(nilWorking.cdnr.length, 0, "an unregistered nil-rated return is not a CDNR note");
assert.equal(nilWorking.cdnur.length, 0, "a small intrastate nil-rated return is not a CDNUR note");

// Regression: products with no HSN all collapse into one bucket keyed on a blank code.
// The row kept only the FIRST product's name, so it read as that single product while the
// quantity spanned several — and a blank HSN is not filable.
const noHsnWorking = buildGstr1WorkingFromRegister({
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-07-31T23:59:59.999Z",
  rows: [
    { invoiceNumber: "NH-1", invoiceDate: "2026-07-01", documentType: "invoice", customerName: "Walk-in", buyerGstin: "", placeOfSupply: "27", supplyType: "intrastate", originalInvoiceValue: 0, hsn: "", description: "Parle-G Biscuit", quantity: 2, unit: "piece", gstRate: 0, taxableValue: 20, cgst: 0, sgst: 0, igst: 0, discount: 0, lineTotal: 20 },
    { invoiceNumber: "NH-1", invoiceDate: "2026-07-01", documentType: "invoice", customerName: "Walk-in", buyerGstin: "", placeOfSupply: "27", supplyType: "intrastate", originalInvoiceValue: 0, hsn: "", description: "Amul Milk 500ml", quantity: 1, unit: "piece", gstRate: 0, taxableValue: 33, cgst: 0, sgst: 0, igst: 0, discount: 0, lineTotal: 33 },
    { invoiceNumber: "NH-1", invoiceDate: "2026-07-01", documentType: "invoice", customerName: "Walk-in", buyerGstin: "", placeOfSupply: "27", supplyType: "intrastate", originalInvoiceValue: 0, hsn: "", description: "Maggi Noodles", quantity: 5, unit: "piece", gstRate: 0, taxableValue: 70, cgst: 0, sgst: 0, igst: 0, discount: 0, lineTotal: 70 },
  ],
});
const blankRow = noHsnWorking.hsn.find((r) => !String(r.hsn || "").trim());
assert.ok(blankRow, "products without HSN must still be disclosed as a row");
assert.equal(blankRow.missingHsn, true, "a blank-HSN row must announce that it needs a code");
assert.equal(blankRow.productCount, 3);
assert.equal(blankRow.quantity, 8, "the grouped quantity spans all three products");
assert.match(blankRow.description, /3 products without HSN/, "the row must not masquerade as one product");
assert.equal(blankRow.productNames, undefined, "the internal name set must not leak into the payload");

// Several products can legitimately share one real HSN — that row must NOT be labelled
// as missing a code.
const sharedHsnWorking = buildGstr1WorkingFromRegister({
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-07-31T23:59:59.999Z",
  rows: [
    { invoiceNumber: "SH-1", invoiceDate: "2026-07-01", documentType: "invoice", customerName: "Walk-in", buyerGstin: "", placeOfSupply: "27", supplyType: "intrastate", originalInvoiceValue: 0, hsn: "1905", description: "Parle-G Biscuit", quantity: 1, unit: "piece", gstRate: 18, taxableValue: 100, cgst: 9, sgst: 9, igst: 0, discount: 0, lineTotal: 118 },
    { invoiceNumber: "SH-1", invoiceDate: "2026-07-01", documentType: "invoice", customerName: "Walk-in", buyerGstin: "", placeOfSupply: "27", supplyType: "intrastate", originalInvoiceValue: 0, hsn: "1905", description: "Britannia Marie", quantity: 1, unit: "piece", gstRate: 18, taxableValue: 100, cgst: 9, sgst: 9, igst: 0, discount: 0, lineTotal: 118 },
  ],
});
const sharedRow = sharedHsnWorking.hsn.find((r) => r.hsn === "1905");
assert.equal(sharedRow.missingHsn, false);
assert.equal(sharedRow.productCount, 2);
assert.doesNotMatch(sharedRow.description, /without HSN/, "a real shared HSN must not be reported as missing");

// A registered-buyer nil-rated return stays in CDNR and must NOT also reduce Table 8,
// or the reduction would be counted twice.
const nilRegisteredRegister = {
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-07-31T23:59:59.999Z",
  rows: [
    { invoiceNumber: "NIL-2", invoiceDate: "2026-07-01", documentType: "invoice", customerName: "Registered", buyerGstin: "27AAPFU0939F1ZV", placeOfSupply: "27", supplyType: "intrastate", originalInvoiceValue: 0, hsn: "", description: "Maggi Noodles", quantity: 5, unit: "piece", gstRate: 0, taxableValue: 70, cgst: 0, sgst: 0, igst: 0, discount: 0, lineTotal: 70 },
    { invoiceNumber: "NIL-RET-2", invoiceDate: "2026-07-02", documentType: "credit_note", originalInvoiceNumber: "NIL-2", originalInvoiceDate: "2026-07-01", originalInvoiceValue: 70, customerName: "Registered", buyerGstin: "27AAPFU0939F1ZV", placeOfSupply: "27", supplyType: "intrastate", hsn: "", description: "Maggi Noodles", quantity: -2, unit: "piece", gstRate: 0, taxableValue: -28, cgst: 0, sgst: 0, igst: 0, discount: 0, lineTotal: -28 },
  ],
};
const nilRegisteredWorking = buildGstr1WorkingFromRegister(nilRegisteredRegister);
assert.equal(nilRegisteredWorking.cdnr.length, 1, "a registered nil-rated return belongs in CDNR");
assert.equal(
  nilRegisteredWorking.nilRated.reduce((sum, row) => sum + row.nilRatedOrExempt, 0),
  70,
  "a return already disclosed in CDNR must not reduce Table 8 as well",
);

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
for (const schema of [prismaSchema, postgresSchema]) {
  assert.match(schema, /model Bill \{[\s\S]*?sellerGstin\s+String\?/);
  assert.match(schema, /model StoreLocation \{[\s\S]*?gstStateCode\s+String\?/);
  assert.match(schema, /model StockTransfer \{[\s\S]*?gstTreatment\s+String/);
  assert.match(schema, /model TransferDocumentCounter \{/);
  assert.match(schema, /@@unique\(\[shopId, documentType, documentNumber\]\)/);
    assert.match(schema, /eWayReviewStatus\s+String\s+@default\("not_required"\)/);
    assert.match(schema, /@@unique\(\[shopId, eWayBillNumber\]\)/);
    assert.match(schema, /fulfillmentMode\s+String\s+@default\("instant"\)/);
    assert.match(schema, /model StockTransferItem \{[\s\S]*?receivedBaseQty\s+Float\s+@default\(0\)/);
  }
const storeService = fs.readFileSync(new URL("../src/modules/stores/stores.service.js", import.meta.url), "utf8");
const complianceService = fs.readFileSync(new URL("../src/modules/compliance/compliance.service.js", import.meta.url), "utf8");
assert.match(storeService, /distinct_registration_supply/);
assert.match(storeService, /TRANSFER_TAX_INVOICE_REQUIRED/);
assert.match(storeService, /external_reference_recorded_not_verified/);
assert.match(storeService, /STOCK_TRANSFER_COMPLIANCE_REVIEWED/);
assert.match(storeService, /CONCURRENT_TRANSFER_REVIEW/);
assert.match(complianceService, /SELLER_GSTIN_SCOPE_REQUIRED/);
assert.match(complianceService, /billSellerIdentity/);
assert.equal(fs.existsSync(new URL("../prisma/migrations/20260728180000_location_tax_registration_snapshots/migration.sql", import.meta.url)), true);
assert.equal(fs.existsSync(new URL("../prisma-postgres/migrations/000071_location_tax_registration_snapshots/migration.sql", import.meta.url)), true);
assert.equal(fs.existsSync(new URL("../prisma/migrations/20260729200000_transfer_eway_review_evidence/migration.sql", import.meta.url)), true);
assert.equal(fs.existsSync(new URL("../prisma-postgres/migrations/000072_transfer_eway_review_evidence/migration.sql", import.meta.url)), true);
assert.equal(fs.existsSync(new URL("../prisma/migrations/20260810183000_stock_transfer_lifecycle/migration.sql", import.meta.url)), true);
assert.equal(fs.existsSync(new URL("../prisma-postgres/migrations/000102_stock_transfer_lifecycle/migration.sql", import.meta.url)), true);


// Multi-GSTIN filing orchestration. A shop registered in two states files two
// GSTR-1s and two GSTR-3Bs, so the register has to split by seller GSTIN without
// losing or double-counting a single line.
const filingRow = (sellerGstin, invoiceNumber, overrides = {}) => ({
  invoiceNumber,
  invoiceDate: "2026-08-05",
  invoiceType: "gst_invoice",
  documentType: "invoice",
  sellerGstin,
  sellerStateCode: sellerGstin.slice(0, 2),
  sellerLegalName: sellerGstin ? `${sellerGstin} Legal` : "",
  sellerTradeName: sellerGstin ? `${sellerGstin} Trade` : "",
  customerName: "Walk-in",
  buyerGstin: "",
  placeOfSupply: sellerGstin.slice(0, 2),
  supplyType: "intrastate",
  hsn: "1905",
  description: "Biscuits",
  quantity: 1,
  unit: "pcs",
  gstRate: 18,
  taxableValue: 100,
  cgst: 9,
  sgst: 9,
  igst: 0,
  grossLineTotal: 118,
  discount: 0,
  lineTotal: 118,
  paymentModes: "cash",
  ...overrides,
});

const MAHARASHTRA_GSTIN = "27AAPFU0939F1ZV";
const KARNATAKA_GSTIN = "29AAPFU0939F1ZR";
const filingRegister = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-31T23:59:59.999Z",
  rows: [
    filingRow(MAHARASHTRA_GSTIN, "MH-1"),
    filingRow(MAHARASHTRA_GSTIN, "MH-2"),
    filingRow(KARNATAKA_GSTIN, "KA-1"),
    filingRow("", "NOGST-1"),
  ],
  documents: [
    { invoiceNumber: "MH-1", sellerGstin: MAHARASHTRA_GSTIN, cancelled: false },
    { invoiceNumber: "MH-2", sellerGstin: MAHARASHTRA_GSTIN, cancelled: false },
    { invoiceNumber: "MH-3", sellerGstin: MAHARASHTRA_GSTIN, cancelled: true },
    { invoiceNumber: "KA-1", sellerGstin: KARNATAKA_GSTIN, cancelled: false },
    { invoiceNumber: "NOGST-1", sellerGstin: "", cancelled: false },
  ],
};

const filingRun = buildMultiGstinFilingRun(filingRegister);
assert.equal(filingRun.registrationCount, 2, "each seller GSTIN files its own return");
assert.deepEqual(filingRun.registrations.map((row) => row.sellerGstin), [MAHARASHTRA_GSTIN, KARNATAKA_GSTIN]);
assert.equal(filingRun.registrations[0].invoiceCount, 2);
assert.equal(filingRun.registrations[1].invoiceCount, 1);

// The split must be lossless: every priced line lands in exactly one bucket.
const bucketedRows = filingRun.registrations.reduce((sum, row) => sum + row.totals.rowCount, 0) + filingRun.unregistered.rowCount;
assert.equal(bucketedRows, filingRegister.rows.length, "no register row may be dropped or counted twice");
assert.equal(filingRun.reconciliation.balanced, true);
assert.equal(filingRun.reconciliation.differences.rowCount, 0);
assert.equal(filingRun.reconciliation.differences.totalTax, 0);
assert.equal(filingRun.reconciliation.register.taxableValue, 400);
assert.equal(filingRun.reconciliation.register.totalTax, 72);
assert.equal(filingRun.reconciliation.summed.totalTax, filingRun.reconciliation.register.totalTax);

// Each return is scoped to its own registration, never the whole register.
assert.equal(filingRun.registrations[0].gstr3b.outwardSupplies["3.1(a)"].taxableValue, 200);
assert.equal(filingRun.registrations[0].gstr3b.taxPayable.total, 36);
assert.equal(filingRun.registrations[1].gstr3b.outwardSupplies["3.1(a)"].taxableValue, 100);
assert.equal(filingRun.registrations[1].gstr3b.taxPayable.total, 18);
assert.equal(filingRun.registrations[0].totals.totalTax + filingRun.registrations[1].totals.totalTax + filingRun.unregistered.totals.totalTax, 72);

// Table 13 stays per registration and still counts the cancelled document.
const maharashtraSeries = filingRun.registrations[0].documentSeries.find((entry) => entry.prefix === "MH-");
assert.equal(maharashtraSeries.totalIssued, 3);
assert.equal(maharashtraSeries.cancelled, 1);
assert.equal(maharashtraSeries.net, 2);
assert.equal(filingRun.registrations[1].documentSeries.some((entry) => entry.prefix === "MH-"), false, "one registration must not see another's series");

// A bill with no seller GSTIN belongs to no return, so it is quarantined and blocks filing.
assert.equal(filingRun.unregistered.rowCount, 1);
assert.deepEqual(filingRun.unregistered.invoiceNumbers, ["NOGST-1"]);
assert.match(filingRun.unregistered.warning, /cannot be filed/);
assert.equal(filingRun.filingReady, false, "unassignable invoices must block the run");

const cleanFilingRun = buildMultiGstinFilingRun({
  ...filingRegister,
  rows: filingRegister.rows.filter((row) => row.sellerGstin),
  documents: filingRegister.documents.filter((document) => document.sellerGstin),
});
assert.equal(cleanFilingRun.filingReady, true);
assert.equal(cleanFilingRun.unregistered.rowCount, 0);
assert.equal(cleanFilingRun.unregistered.warning, null);
assert.equal(cleanFilingRun.reconciliation.balanced, true);

// A structurally invalid GSTIN is reported rather than silently filed under.
const malformedFilingRun = buildMultiGstinFilingRun({
  ...filingRegister,
  rows: [filingRow("27AAPFU0939F1ZA", "BAD-1")],
  documents: [{ invoiceNumber: "BAD-1", sellerGstin: "27AAPFU0939F1ZA", cancelled: false }],
});
assert.equal(malformedFilingRun.registrations[0].formatValid, false);
assert.ok(malformedFilingRun.registrations[0].formatReason);
assert.equal(malformedFilingRun.filingReady, false, "an invalid registration must block the run");

// An empty period has nothing to file, so it must not report itself ready.
const emptyFilingRun = buildMultiGstinFilingRun({ from: filingRegister.from, to: filingRegister.to, rows: [], documents: [] });
assert.equal(emptyFilingRun.registrationCount, 0);
assert.equal(emptyFilingRun.reconciliation.balanced, true);
assert.equal(emptyFilingRun.filingReady, false, "an empty period is not a filable run");

const filingCsv = filingRunToCsv(filingRun);
assert.match(filingCsv, /Seller GSTIN,Legal Name/);
assert.match(filingCsv, new RegExp(MAHARASHTRA_GSTIN));
assert.match(filingCsv, new RegExp(KARNATAKA_GSTIN));
assert.match(filingCsv, /\(no seller GSTIN\)/);
assert.match(filingCsv, /Register total/);
assert.match(filingCsv, /Reconciliation: balanced/);

// The run must never be narrowed to one registration by a stray query parameter.
assert.match(complianceService, /const \{ sellerGstin, \.\.\.unscoped \} = query/);
assert.match(complianceService, /artha-gst-filing-run-v1/);

console.log("Compliance tax and HSN examples passed");
