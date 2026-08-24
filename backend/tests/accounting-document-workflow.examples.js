import assert from "node:assert/strict";
import db from "../src/db.js";
import { approveAccountingDocument, buildPurchaseJournalSuggestion, createPurchaseInvoiceDraft, rejectAccountingDocument } from "../src/modules/finance/accounting-document.service.js";

const shop = await db.shop.create({ data: { name: "Document Test", ownerName: "Owner", city: "Jaipur", address: "Test" } });
const supplier = await db.supplier.create({ data: { shopId: shop.id, name: "Acme Foods", gstin: "08ABCDE1234F1Z5" } });
await db.product.create({ data: { shopId: shop.id, name: "Salt", barcode: "8901", defaultPricePerRateUnit: 60, costPerRateUnit: 50, stockBaseQty: 0 } });

const payload = {
  supplierName: "ACME FOODS PRIVATE LIMITED",
  supplierGstin: "08ABCDE1234F1Z5",
  invoiceNumber: "INV-7",
  invoiceDate: "2026-08-01",
  subtotal: 100,
  taxTotal: 18,
  grandTotal: 118,
  warnings: [],
  lines: [{ description: "Salt", barcode: "8901", quantity: 2, unit: "packet", unitCost: 50, lineTotal: 100, confidence: 0.99 }],
};
const provider = { model: "vision-test", client: { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) } } } };
const image = { buffer: Buffer.from("invoice-image-evidence"), mimeType: "image/png", size: 22 };

const created = await createPurchaseInvoiceDraft(shop.id, image, { id: null }, { database: db, providerOverride: provider });
assert.equal(created.duplicate, false);
assert.equal(created.document.status, "review_required");
assert.equal(created.document.supplierId, supplier.id, "GSTIN must win even when the supplier name differs");
assert.equal(created.document.supplierMatch, "gstin_exact");
assert.equal(created.document.suggestedJournal.readyForApproval, true);
assert.deepEqual(created.document.suggestedJournal.lines.map((line) => [line.accountCode, line.debitPaise, line.creditPaise]), [
  ["1200", 10_000, 0], ["2210", 1_800, 0], ["2000", 0, 11_800],
]);

const duplicate = await createPurchaseInvoiceDraft(shop.id, image, null, { database: db, providerOverride: { client: { chat: { completions: { create: async () => { throw new Error("duplicate must not call OCR"); } } } } } });
assert.equal(duplicate.duplicate, true);
assert.equal(duplicate.document.id, created.document.id);

await assert.rejects(
  approveAccountingDocument(shop.id, created.document.id, { reason: "Invoice and goods receipt checked" }, null, db),
  (error) => error.code === "INPUT_GST_ELIGIBILITY_CONFIRMATION_REQUIRED",
);
const approved = await approveAccountingDocument(shop.id, created.document.id, { reason: "Invoice, goods receipt, and ITC eligibility checked", confirmInputTaxEligibility: true }, null, db);
assert.equal(approved.document.status, "approved");
assert.equal(approved.document.journalEntryId, approved.journal.id);
assert.equal(approved.journal.sourceType, "document_approval");
assert.equal(approved.journal.lines.reduce((sum, line) => sum + Number(line.debitPaise), 0), 11_800);
assert.equal(approved.journal.lines.reduce((sum, line) => sum + Number(line.creditPaise), 0), 11_800);
await assert.rejects(
  approveAccountingDocument(shop.id, created.document.id, { reason: "Try twice" }, null, db),
  (error) => error.code === "ACCOUNTING_DOCUMENT_ALREADY_REVIEWED",
);

const secondImage = { ...image, buffer: Buffer.from("second-invoice-evidence"), size: 23 };
const second = await createPurchaseInvoiceDraft(shop.id, secondImage, null, { database: db, providerOverride: provider });
const rejected = await rejectAccountingDocument(shop.id, second.document.id, { reason: "Duplicate supplier invoice number" }, null, db);
assert.equal(rejected.status, "rejected");
assert.equal(await db.journalEntry.count({ where: { sourceType: "document_approval" } }), 1);

const unsafe = buildPurchaseJournalSuggestion({ supplierId: null, invoiceDate: "bad", subtotal: 100, taxTotal: 18, grandTotal: 119, lines: [] });
assert.equal(unsafe.readyForApproval, false);
assert.equal(unsafe.lines.length, 0);

await db.shop.delete({ where: { id: shop.id } });
await db.$disconnect();
console.log("accounting-document-workflow.examples.js OK");
