import * as svc from "./book-lists.service.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

function auditSnapshot(list) {
  return {
    id: list.id,
    label: list.label,
    schoolName: list.schoolName,
    className: list.className,
    academicYear: list.academicYear,
    items: list.itemCount,
    isActive: list.isActive,
  };
}

export async function list(req, res, next) {
  try {
    const data = await svc.listBookLists(req.shopId, {
      schoolName: req.query.schoolName,
      className: req.query.className,
      academicYear: req.query.academicYear,
      search: req.query.search ? String(req.query.search).trim() : undefined,
      includeInactive: String(req.query.includeInactive ?? "") === "true",
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function options(req, res, next) {
  try { res.json({ success: true, data: await svc.getListOptions(req.shopId) }); }
  catch (err) { next(err); }
}

export async function summary(req, res, next) {
  try { res.json({ success: true, data: await svc.getBookListSummary(req.shopId) }); }
  catch (err) { next(err); }
}

/** What to order across every list — the reorder sheet for the weeks before term. */
export async function shortfall(req, res, next) {
  try {
    res.json({ success: true, data: await svc.getShortfallReport(req.shopId, { academicYear: req.query.academicYear }) });
  } catch (err) { next(err); }
}

export async function detail(req, res, next) {
  try { res.json({ success: true, data: await svc.getBookList(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const list = await svc.createBookList(req.shopId, req.body);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "BOOK_LIST_CREATED",
      entityType: "BookList", entityId: list.id, after: auditSnapshot(list), req,
    });
    res.status(201).json({ success: true, message: `${list.label} saved`, data: list });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const before = await svc.getBookList(req.shopId, req.params.id);
    const list = await svc.updateBookList(req.shopId, req.params.id, req.body);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "BOOK_LIST_UPDATED",
      entityType: "BookList", entityId: list.id,
      before: auditSnapshot(before), after: auditSnapshot(list), req,
    });
    res.json({ success: true, data: list });
  } catch (err) { next(err); }
}

export async function copy(req, res, next) {
  try {
    const list = await svc.copyBookList(req.shopId, req.params.id, req.body ?? {});
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "BOOK_LIST_COPIED",
      entityType: "BookList", entityId: list.id,
      after: { ...auditSnapshot(list), copiedFrom: req.params.id }, req,
    });
    res.status(201).json({ success: true, message: `Copied to ${list.label}`, data: list });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const list = await svc.deleteBookList(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "BOOK_LIST_DELETED",
      entityType: "BookList", entityId: list.id,
      after: auditSnapshot(list), metadata: { softDelete: true }, req,
    });
    res.json({ success: true, message: "List moved to recycle bin", data: list });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try { res.json({ success: true, message: "List restored", data: await svc.restoreBookList(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}
