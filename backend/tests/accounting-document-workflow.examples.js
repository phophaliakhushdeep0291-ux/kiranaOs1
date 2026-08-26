import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import db from "../src/db.js";
import { approveAccountingDocument, buildPurchaseJournalSuggestion, createPurchaseInvoiceDraft, getAccountingDocument, rejectAccountingDocument } from "../src/modules/finance/accounting-document.service.js";

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
assert.equal(created.document.supplierMatch, "exact");
assert.equal(created.document.extracted.supplierMatchMethod, "gstin");
assert.equal(created.document.suggestedJournal.readyForApproval, true);
assert.equal(await db.auditLog.count({ where: { shopId: shop.id, action: "LEDGER_DOCUMENT_EXTRACTED", entityId: created.document.id } }), 1);
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
assert.equal(await db.auditLog.count({ where: { shopId: shop.id, action: "LEDGER_DOCUMENT_APPROVED", entityId: created.document.id } }), 1);
await assert.rejects(
  approveAccountingDocument(shop.id, created.document.id, { reason: "Try twice" }, null, db),
  (error) => error.code === "ACCOUNTING_DOCUMENT_ALREADY_REVIEWED",
);

const secondImage = { ...image, buffer: Buffer.from("second-invoice-evidence"), size: 23 };
const second = await createPurchaseInvoiceDraft(shop.id, secondImage, null, { database: db, providerOverride: provider });
const rejected = await rejectAccountingDocument(shop.id, second.document.id, { reason: "Duplicate supplier invoice number" }, null, db);
assert.equal(rejected.status, "rejected");
assert.equal(await db.auditLog.count({ where: { shopId: shop.id, action: "LEDGER_DOCUMENT_REJECTED", entityId: second.document.id, result: "success" } }), 1, "a deliberate rejection is a successfully audited review decision");
assert.equal(await db.journalEntry.count({ where: { sourceType: "document_approval" } }), 1);

const otherShop = await db.shop.create({ data: { name: "Other Document Shop", ownerName: "Other Owner", city: "Kota", address: "Other" } });
await assert.rejects(
  getAccountingDocument(otherShop.id, created.document.id, db),
  (error) => error.code === "ACCOUNTING_DOCUMENT_NOT_FOUND",
  "a document id must not cross the tenant boundary",
);
await assert.rejects(
  approveAccountingDocument(otherShop.id, created.document.id, { reason: "Cross-tenant attempt", confirmInputTaxEligibility: true }, null, db),
  (error) => error.code === "ACCOUNTING_DOCUMENT_NOT_FOUND",
);

const failedAuditImage = { ...image, buffer: Buffer.from("audit-failure-invoice-evidence"), size: 30 };
const failedAuditDraft = await createPurchaseInvoiceDraft(shop.id, failedAuditImage, null, { database: db, providerOverride: provider });
await db.$executeRawUnsafe(`
  CREATE TRIGGER force_accounting_document_approval_audit_failure
  BEFORE INSERT ON AuditLog
  WHEN NEW.action = 'LEDGER_DOCUMENT_APPROVED'
  BEGIN
    SELECT RAISE(ABORT, 'forced accounting document approval audit failure');
  END
`);
const journalsBeforeAuditFailure = await db.journalEntry.count({ where: { shopId: shop.id, sourceType: "document_approval" } });
try {
  await assert.rejects(
    approveAccountingDocument(shop.id, failedAuditDraft.document.id, { reason: "Audit rollback proof", confirmInputTaxEligibility: true }, null, db),
    (error) => error.code === "ACCOUNTING_DOCUMENT_AUDIT_WRITE_FAILED",
  );
} finally {
  await db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_accounting_document_approval_audit_failure");
}
const afterAuditFailure = await getAccountingDocument(shop.id, failedAuditDraft.document.id, db);
assert.equal(afterAuditFailure.status, "review_required", "failed required audit must roll the document claim back");
assert.equal(afterAuditFailure.journalEntryId, null);
assert.equal(await db.journalEntry.count({ where: { shopId: shop.id, sourceType: "document_approval" } }), journalsBeforeAuditFailure, "failed required audit must roll the journal and its lines back");
assert.equal(await db.accountingDocumentEvent.count({ where: { documentId: failedAuditDraft.document.id, action: "approved_and_posted" } }), 0);

await db.$executeRawUnsafe(`
  CREATE TRIGGER force_accounting_document_extraction_audit_failure
  BEFORE INSERT ON AuditLog
  WHEN NEW.action = 'LEDGER_DOCUMENT_EXTRACTED'
  BEGIN
    SELECT RAISE(ABORT, 'forced accounting document extraction audit failure');
  END
`);
const extractionFailureImage = { ...image, buffer: Buffer.from("extraction-audit-failure"), size: 24 };
try {
  await assert.rejects(
    createPurchaseInvoiceDraft(shop.id, extractionFailureImage, null, { database: db, providerOverride: provider }),
    (error) => error.code === "ACCOUNTING_DOCUMENT_AUDIT_WRITE_FAILED",
  );
} finally {
  await db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_accounting_document_extraction_audit_failure");
}
const extractionFailureHash = createHash("sha256").update(extractionFailureImage.buffer).digest("hex");
assert.equal(await db.accountingDocument.count({ where: { shopId: shop.id, sourceHash: extractionFailureHash } }), 0, "an extracted document cannot persist without its required audit");

const reviewRaceImage = { ...image, buffer: Buffer.from("review-race-invoice-evidence"), size: 28 };
const reviewRace = await createPurchaseInvoiceDraft(shop.id, reviewRaceImage, null, { database: db, providerOverride: provider });
const raceResults = await Promise.allSettled([
  approveAccountingDocument(shop.id, reviewRace.document.id, { reason: "Concurrent approval", confirmInputTaxEligibility: true }, null, db),
  rejectAccountingDocument(shop.id, reviewRace.document.id, { reason: "Concurrent rejection" }, null, db),
]);
assert.equal(raceResults.filter((result) => result.status === "fulfilled").length, 1, "exactly one concurrent reviewer owns the terminal decision");
assert.equal(raceResults.filter((result) => result.status === "rejected").length, 1);
assert.ok(["ACCOUNTING_DOCUMENT_ALREADY_REVIEWED", "ACCOUNTING_DOCUMENT_REVIEW_CONFLICT"].includes(raceResults.find((result) => result.status === "rejected").reason.code));
const racedDocument = await getAccountingDocument(shop.id, reviewRace.document.id, db);
assert.ok(["approved", "rejected"].includes(racedDocument.status));
assert.equal(await db.accountingDocumentEvent.count({ where: { documentId: reviewRace.document.id, action: { in: ["approved_and_posted", "rejected"] } } }), 1);
assert.equal(await db.auditLog.count({ where: { shopId: shop.id, entityId: reviewRace.document.id, action: { in: ["LEDGER_DOCUMENT_APPROVED", "LEDGER_DOCUMENT_REJECTED"] } } }), 1);
assert.equal(await db.journalEntry.count({ where: { shopId: shop.id, sourceType: "document_approval", sourceId: reviewRace.document.id } }), racedDocument.status === "approved" ? 1 : 0);

const duplicateRaceImage = { ...image, buffer: Buffer.from("duplicate-race-invoice-evidence"), size: 31 };
const duplicateRace = await Promise.all([
  createPurchaseInvoiceDraft(shop.id, duplicateRaceImage, null, { database: db, providerOverride: provider }),
  createPurchaseInvoiceDraft(shop.id, duplicateRaceImage, null, { database: db, providerOverride: provider }),
]);
assert.equal(new Set(duplicateRace.map((result) => result.document.id)).size, 1, "concurrent uploads converge on one immutable document");
assert.deepEqual(duplicateRace.map((result) => result.duplicate).sort(), [false, true]);
assert.equal(await db.auditLog.count({ where: { shopId: shop.id, action: "LEDGER_DOCUMENT_EXTRACTED", entityId: duplicateRace[0].document.id } }), 1, "concurrent duplicate upload writes one extraction audit");

const unsafe = buildPurchaseJournalSuggestion({ supplierId: null, invoiceDate: "bad", subtotal: 100, taxTotal: 18, grandTotal: 119, lines: [] });
assert.equal(unsafe.readyForApproval, false);
assert.equal(unsafe.lines.length, 0);

await db.$disconnect();
console.log("accounting-document-workflow.examples.js OK");
