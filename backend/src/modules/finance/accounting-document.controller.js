import { approveAccountingDocument, getAccountingDocument, listAccountingDocuments, rejectAccountingDocument } from "./accounting-document.service.js";

const safe = (value) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? Number(item) : item));
const actor = (req) => ({ ...req.user, req });

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
    const data = safe(await approveAccountingDocument(req.shopId, req.params.id, req.body, actor(req)));
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function reject(req, res, next) {
  try {
    const data = await rejectAccountingDocument(req.shopId, req.params.id, req.body, actor(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
