import { createHash } from "node:crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { extractPurchaseInvoice } from "../ai/invoice-ocr.service.js";
import { createManualJournal, ensureSystemAccounts } from "./general-ledger.service.js";

const json = (value) => JSON.stringify(value);
const parse = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
const actorId = (actor) => actor?.userId ?? actor?.id ?? null;
const toPaise = (amount) => Number.isFinite(amount) ? Math.round(amount * 100) : null;

function fail(message, status, code) { throw new AppError(message, status, code); }

export function buildPurchaseJournalSuggestion(draft) {
  const subtotalPaise = toPaise(draft.subtotal);
  const taxPaise = toPaise(draft.taxTotal);
  const totalPaise = toPaise(draft.grandTotal);
  const invoiceDate = /^\d{4}-\d{2}-\d{2}$/.test(draft.invoiceDate ?? "")
    ? `${draft.invoiceDate}T00:00:00.000Z`
    : null;
  const amountsPresent = [subtotalPaise, taxPaise, totalPaise].every((value) => value != null && value >= 0);
  const balanced = amountsPresent && subtotalPaise + taxPaise === totalPaise && totalPaise > 0;
  const lines = balanced ? [
    ...(subtotalPaise ? [{ accountCode: "1200", debitPaise: subtotalPaise, creditPaise: 0, memo: "Inventory purchase before GST" }] : []),
    ...(taxPaise ? [{ accountCode: "2210", debitPaise: taxPaise, creditPaise: 0, memo: "Input GST from supplier invoice" }] : []),
    { accountCode: "2000", debitPaise: 0, creditPaise: totalPaise, memo: "Supplier payable" },
  ] : [];
  const confidence = Math.min(1, Math.max(0, draft.lines?.length
    ? draft.lines.reduce((sum, line) => sum + Number(line.confidence ?? 0), 0) / draft.lines.length
    : 0));
  const blockers = [
    !invoiceDate && "A valid invoice date is required",
    !balanced && "Subtotal plus tax must equal a positive grand total",
    !draft.supplierId && "An exact supplier match is required",
    draft.mathChecks?.linesToSubtotal?.status === "inconsistent" && "Invoice line totals do not reconcile",
  ].filter(Boolean);
  return {
    version: 1,
    treatment: "inventory_purchase_on_credit",
    businessDate: invoiceDate,
    description: `Supplier invoice ${draft.invoiceNumber ?? "(number unavailable)"} — ${draft.supplierName ?? "unknown supplier"}`,
    lines,
    confidence,
    autoPostAllowed: false,
    approvalRequired: true,
    blockers,
    readyForApproval: blockers.length === 0,
  };
}

function publicDocument(row) {
  if (!row) return null;
  return {
    ...row,
    extracted: parse(row.extractedJson, {}),
    validation: parse(row.validationJson, {}),
    suggestedJournal: parse(row.suggestedJournalJson, {}),
    evidence: parse(row.evidenceJson, {}),
    extractedJson: undefined,
    validationJson: undefined,
    suggestedJournalJson: undefined,
    evidenceJson: undefined,
    events: row.events?.map((event) => ({ ...event, payload: parse(event.payloadJson, {}), payloadJson: undefined })),
  };
}

export async function createPurchaseInvoiceDraft(shopId, image, actor, { database = db, providerOverride } = {}) {
  const sourceHash = createHash("sha256").update(image.buffer).digest("hex");
  const duplicate = await database.accountingDocument.findUnique({ where: { shopId_sourceHash: { shopId, sourceHash } }, include: { events: { orderBy: { createdAt: "asc" } } } });
  if (duplicate) return { document: publicDocument(duplicate), duplicate: true };
  const draft = await extractPurchaseInvoice(shopId, image, { database, providerOverride });
  const suggestion = buildPurchaseJournalSuggestion(draft);
  const validation = {
    version: 1,
    headerChecks: draft.headerChecks,
    mathChecks: draft.mathChecks,
    warnings: draft.warnings,
    blockers: suggestion.blockers,
  };
  const evidence = {
    version: 1,
    extractionMode: "vision_ocr",
    sourceHashAlgorithm: "sha256",
    sourceHash,
    sourceMimeType: image.mimeType,
    sourceBytes: image.size,
    reviewOnly: true,
  };
  const created = await database.accountingDocument.create({ data: {
    shopId,
    documentType: "purchase_invoice",
    sourceHash,
    sourceMimeType: image.mimeType,
    sourceBytes: image.size,
    supplierId: draft.supplierId,
    supplierMatch: draft.supplierMatch,
    extractedJson: json(draft),
    validationJson: json(validation),
    suggestedJournalJson: json(suggestion),
    evidenceJson: json(evidence),
    createdByUserId: actorId(actor),
    events: { create: { shopId, action: "extracted", actorUserId: actorId(actor), payloadJson: json({ suggestionReady: suggestion.readyForApproval, blockers: suggestion.blockers }) } },
  }, include: { events: { orderBy: { createdAt: "asc" } } } });
  return { document: publicDocument(created), duplicate: false };
}

export async function listAccountingDocuments(shopId, { status, limit = 50 } = {}, database = db) {
  const rows = await database.accountingDocument.findMany({
    where: { shopId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, Number(limit) || 50)),
  });
  return rows.map(publicDocument);
}

export async function getAccountingDocument(shopId, id, database = db) {
  const row = await database.accountingDocument.findFirst({ where: { id, shopId }, include: { events: { orderBy: { createdAt: "asc" } } } });
  if (!row) fail("Accounting document not found", 404, "ACCOUNTING_DOCUMENT_NOT_FOUND");
  return publicDocument(row);
}

export async function approveAccountingDocument(shopId, id, input, actor, database = db) {
  return database.$transaction(async (tx) => {
    const row = await tx.accountingDocument.findFirst({ where: { id, shopId } });
    if (!row) fail("Accounting document not found", 404, "ACCOUNTING_DOCUMENT_NOT_FOUND");
    if (row.status !== "review_required") fail("Only a review-required document can be approved", 409, "ACCOUNTING_DOCUMENT_ALREADY_REVIEWED");
    const suggestion = parse(row.suggestedJournalJson, {});
    const supplierId = input.supplierId ?? row.supplierId;
    if (!supplierId) fail("Select a supplier before approval", 400, "ACCOUNTING_DOCUMENT_SUPPLIER_REQUIRED");
    const supplier = await tx.supplier.findFirst({ where: { id: supplierId, shopId, deletedAt: null } });
    if (!supplier) fail("Supplier not found in this shop", 400, "ACCOUNTING_DOCUMENT_SUPPLIER_INVALID");
    const lines = input.lines ?? suggestion.lines;
    const businessDate = input.businessDate ?? suggestion.businessDate;
    if (!businessDate || !Array.isArray(lines) || lines.length < 2) fail("The document does not contain an approvable balanced journal", 400, "ACCOUNTING_DOCUMENT_JOURNAL_INCOMPLETE");
    if (lines.some((line) => line.accountCode === "2210" && Number(line.debitPaise) > 0) && !input.confirmInputTaxEligibility) {
      fail("Confirm input GST eligibility or replace the suggested tax line before approval", 400, "INPUT_GST_ELIGIBILITY_CONFIRMATION_REQUIRED");
    }
    await ensureSystemAccounts(shopId, tx);
    const journal = await createManualJournal(shopId, {
      reference: row.id,
      businessDate,
      description: input.description ?? suggestion.description ?? "Approved purchase invoice",
      lines,
    }, { sourceType: "document_approval", actorUserId: actorId(actor), client: tx });
    await tx.journalEntry.update({ where: { id: journal.id }, data: { evidenceJson: json({
      version: 1,
      actorUserId: actorId(actor),
      manuallyApproved: true,
      accountingDocumentId: row.id,
      sourceHash: row.sourceHash,
      supplierId,
      suggestionVersion: suggestion.version ?? null,
      originalSuggestion: suggestion,
      approvedLines: lines,
      inputTaxEligibilityConfirmed: input.confirmInputTaxEligibility,
    }) } });
    const reviewedAt = new Date();
    const updated = await tx.accountingDocument.update({ where: { id: row.id }, data: {
      status: "approved",
      supplierId,
      reviewedByUserId: actorId(actor),
      reviewedAt,
      reviewReason: input.reason,
      journalEntryId: journal.id,
    } });
    await tx.accountingDocumentEvent.create({ data: { shopId, documentId: row.id, action: "approved_and_posted", actorUserId: actorId(actor), payloadJson: json({ journalEntryId: journal.id, supplierId, reason: input.reason }) } });
    return { document: publicDocument(updated), journal };
  });
}

export async function rejectAccountingDocument(shopId, id, input, actor, database = db) {
  return database.$transaction(async (tx) => {
    const row = await tx.accountingDocument.findFirst({ where: { id, shopId } });
    if (!row) fail("Accounting document not found", 404, "ACCOUNTING_DOCUMENT_NOT_FOUND");
    if (row.status !== "review_required") fail("Only a review-required document can be rejected", 409, "ACCOUNTING_DOCUMENT_ALREADY_REVIEWED");
    const updated = await tx.accountingDocument.update({ where: { id: row.id }, data: { status: "rejected", reviewedByUserId: actorId(actor), reviewedAt: new Date(), reviewReason: input.reason } });
    await tx.accountingDocumentEvent.create({ data: { shopId, documentId: row.id, action: "rejected", actorUserId: actorId(actor), payloadJson: json({ reason: input.reason }) } });
    return publicDocument(updated);
  });
}

export const __accountingDocumentInternals = { toPaise, publicDocument };
