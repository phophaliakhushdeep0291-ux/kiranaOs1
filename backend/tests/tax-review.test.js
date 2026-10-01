import test from "node:test";
import assert from "node:assert/strict";
import { buildTaxReview } from "../src/modules/compliance/tax-review.engine.js";
import { taxReviewQuery } from "../src/modules/compliance/tax-review.schema.js";
import { getTaxReview } from "../src/modules/compliance/tax-review.service.js";

const row = { sellerGstin: "27AAPFU0939F1ZV", invoiceNumber: "S1", documentType: "invoice", hsn: "1006", taxableValue: 100, cgst: 2.5, sgst: 2.5, igst: 0 };
const register = (rows = []) => ({ rows, from: "2026-08-31T18:30:00.000Z", to: "2026-09-30T18:29:59.999Z" });

test("empty or clean books never imply filing readiness or eligible ITC", () => {
  for (const rows of [[], [row]]) {
    const result = buildTaxReview({ register: register(rows) });
    assert.equal(result.filingEnabled, false);
    assert.equal(result.status, "review_required");
    assert.equal(result.findings.length, 0);
    assert.ok(result.requiredReviews.includes("gst2b_itc"));
    assert.ok(result.itrChecklist.includes("other_income"));
    assert.equal(result.taxPayable, undefined);
  }
});
test("invoice checks deduplicate lines but distinguish seller registrations", () => {
  const bad = { ...row, sellerGstin: "", hsn: "", buyerGstin: "bad" };
  const result = buildTaxReview({ register: register([bad, bad, row]) });
  assert.equal(result.coverage.invoiceCount, 2);
  assert.equal(result.findings.find((f) => f.code === "seller_registration").count, 1);
  assert.equal(result.findings.find((f) => f.code === "buyer_registration").count, 1);
  assert.equal(result.findings.find((f) => f.code === "hsn_review").count, 2);
});
test("credit notes require reference and non-finite money is flagged", () => {
  const result = buildTaxReview({ register: register([{ ...row, documentType: "credit_note", cgst: NaN }]) });
  assert.deepEqual(result.findings.map((f) => f.code), ["return_reference", "invalid_amount"]);
});
test("possible duplicate purchases are scoped to supplier, never auto-merged", () => {
  const purchase = { supplierId: "supplier-a", supplierInvoiceNumber: " INV-1 ", supplierInvoiceAmount: 0, matchStatus: "matched" };
  const purchases = [{ ...purchase, id: "a" }, { ...purchase, id: "b", supplierInvoiceNumber: "inv-1" }, { ...purchase, id: "c", supplierId: "supplier-b" }, { id: "d", matchStatus: "invoice_pending" }];
  const result = buildTaxReview({ register: register(), purchases });
  assert.equal(purchases.length, 4);
  assert.equal(result.findings.find((f) => f.code === "repeated_purchase_invoice").count, 1);
  assert.equal(result.findings.find((f) => f.code === "purchase_invoice").count, 1);
  assert.equal(result.findings.find((f) => f.code === "purchase_match").count, 1);
});
test("evidence list is capped without undercounting findings", () => {
  const result = buildTaxReview({ register: register(), expenses: Array.from({ length: 30 }, (_, id) => ({ id, vendor: " " })) });
  assert.equal(result.findings[0].count, 30);
  assert.equal(result.findings[0].sources.length, 25);
});
test("period validation rejects rollover dates, reversed ranges and overlong periods", () => {
  for (const query of [{ from: "2026-02-30", to: "2026-03-01" }, { from: "2026-09-02", to: "2026-09-01" }, { from: "2024-01-01", to: "2026-09-01" }, { from: "2026-01-01", to: "2026-02-01", sellerGstin: row.sellerGstin }]) {
    assert.equal(taxReviewQuery.safeParse(query).success, false);
  }
  assert.equal(taxReviewQuery.safeParse({ from: "2024-04-01", to: "2025-03-31" }).success, true);
});
test("service queries preserve tenant, location, date range and soft-deletion scopes", async () => {
  const calls = {};
  const result = await getTaxReview("shop-a", { from: "2026-09-01", to: "2026-09-30", locationId: "location-a" }, {
    getGstInvoiceRegister: async (shopId, query) => { calls.register = { shopId, query }; return register([row]); },
    db: {
      purchaseReceipt: { findMany: async (query) => { calls.purchases = query; return []; } },
      expense: { findMany: async (query) => { calls.expenses = query; return []; } },
    },
  });
  assert.equal(calls.register.shopId, "shop-a");
  assert.equal(calls.register.query.range, "custom");
  for (const query of [calls.purchases, calls.expenses]) {
    assert.equal(query.where.shopId, "shop-a");
    assert.equal(query.where.locationId, "location-a");
  }
  assert.equal(calls.expenses.where.deletedAt, null);
  assert.equal(calls.purchases.where.createdAt.gte.toISOString(), register().from);
  assert.equal(calls.expenses.where.spentAt.lte.toISOString(), register().to);
  assert.equal(result.scope.locationId, "location-a");
});
