import test from "node:test";
import assert from "node:assert/strict";
import { reconcileTaxInvoices, taxReconciliationSchema } from "../src/modules/compliance/tax-reconciliation.js";

const row = { sourceId: "a", supplierGstin: "27AAPFU0939F1ZV", invoiceNumber: "INV-1", invoiceDate: "2026-09-01", documentType: "invoice", taxablePaise: 10000, cgstPaise: 900, sgstPaise: 900, igstPaise: 0, cessPaise: 0 };
const input = (books = [row], statement = [{ ...row, sourceId: "s", itcAvailability: "available" }]) => ({ schemaVersion: "kirana-tax-reconciliation-v1", recipientGstin: row.supplierGstin, period: "2026-09", books, statement });

test("exact matches never become an ITC entitlement or a filed return", () => {
  for (const availability of ["available", "unavailable", "unknown"]) {
    const data = reconcileTaxInvoices(input([row], [{ ...row, sourceId: "s", itcAvailability: availability }]));
    assert.equal(data.counts.matched, 1);
    assert.equal(data.results[0].itcAvailability, availability);
    assert.equal(data.eligibleItcPaise, null);
    assert.equal(data.filingEnabled, false);
  }
});
test("one-paise, tax-component, cess and date differences remain visible", () => {
  const data = reconcileTaxInvoices(input([row], [{ ...row, sourceId: "s", invoiceDate: "2026-09-02", cgstPaise: 899, cessPaise: 1, itcAvailability: "unknown" }]));
  assert.equal(data.counts.mismatch, 1);
  assert.deepEqual(data.results[0].differences.map((d) => d.field), ["invoiceDate", "cgstPaise", "cessPaise"]);
  assert.equal(data.results[0].differences[1].deltaPaise, 1);
});
test("duplicates on either side are ambiguous even if every amount matches", () => {
  for (const side of ["books", "statement"]) {
    const data = input(); data[side].push({ ...data[side][0], sourceId: "duplicate" });
    const result = reconcileTaxInvoices(data);
    assert.equal(result.counts.duplicate_review, 1);
    assert.equal(result.counts.matched, 0);
  }
});
test("invoice and credit note identities never merge; missing documents are directional", () => {
  const data = reconcileTaxInvoices(input([row], [{ ...row, documentType: "credit_note", itcAvailability: "unknown" }]));
  assert.equal(data.counts.missing_in_books, 1);
  assert.equal(data.counts.missing_in_statement, 1);
});
test("punctuation and financial years do not collapse invoice identities", () => {
  for (const change of [{ invoiceNumber: "INV1" }, { invoiceDate: "2025-09-01" }]) {
    const result = reconcileTaxInvoices(input([row], [{ ...row, ...change, itcAvailability: "unknown" }]));
    assert.equal(result.counts.matched, 0);
    assert.equal(result.results.length, 2);
  }
  assert.equal(reconcileTaxInvoices(input([{ ...row, invoiceNumber: " inv-1 " }])).counts.matched, 1);
});
test("reject malformed amounts, dates, duplicate source IDs, unknown special fields and oversize input", () => {
  for (const change of [{ cgstPaise: 1.5 }, { cgstPaise: -1 }, { cgstPaise: "900" }, { taxablePaise: Number.MAX_SAFE_INTEGER }, { invoiceDate: "2026-02-30" }, { invoiceDate: "2026-10-01" }, { supplierGstin: "invalid" }, { amendment: true }]) {
    assert.equal(taxReconciliationSchema.safeParse(input([{ ...row, ...change }])).success, false);
  }
  assert.equal(taxReconciliationSchema.safeParse(input([row, row])).success, false);
  assert.equal(taxReconciliationSchema.safeParse(input(Array.from({ length: 2001 }, (_, index) => ({ ...row, sourceId: String(index) })))).success, false);
});
test("empty datasets are visibly empty and never filing-ready", () => {
  const result = reconcileTaxInvoices(input([], []));
  assert.equal(result.results.length, 0);
  assert.equal(result.filingEnabled, false);
  assert.equal(result.eligibleItcPaise, null);
});
