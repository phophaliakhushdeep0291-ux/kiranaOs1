import { AUDIT_MODULES, createAuditLog } from "../audit/audit.service.js";
import { approveAccountingDocument, getAccountingDocument, listAccountingDocuments, rejectAccountingDocument } from "./accounting-document.service.js";

const safe = (value) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? Number(item) : item));
const actorId = (req) => req.user?.userId ?? req.user?.id ?? null;

async function audit(req, action, document, metadata) {
  await createAuditLog({ shopId: req.shopId, userId: actorId(req), module: AUDIT_MODULES.FINANCE, action, entityType: "AccountingDocument", entityId: document.id, after: document, metadata, req });
}

export async function documents(req, res, next) {
  try { res.json({ success: true, data: await listAccountingDocuments(req.shopId, req.query) }); }
  catch (error) { next(error); }
}

export async function document(req, res, next) {
  try { res.json({ success: true, data: await getAccountingDocument(req.shopId, req.params.id) }); }
  catch (error) { next(error); }
}

export async function approve(req, res, next) {
  try {
    const data = safe(await approveAccountingDocument(req.shopId, req.params.id, req.body, req.user));
    await audit(req, "LEDGER_DOCUMENT_APPROVED", data.document, { journalEntryId: data.journal.id, reason: req.body.reason });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function reject(req, res, next) {
  try {
    const data = await rejectAccountingDocument(req.shopId, req.params.id, req.body, req.user);
    await audit(req, "LEDGER_DOCUMENT_REJECTED", data, { reason: req.body.reason });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
