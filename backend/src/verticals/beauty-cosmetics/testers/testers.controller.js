import * as svc from "./testers.service.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

function auditSnapshot(tester) {
  return {
    id: tester.id,
    productName: tester.productName,
    variant: tester.variant,
    status: tester.status,
    openedOn: tester.openedOnKey,
    costValue: tester.costValue,
    movedStock: Boolean(tester.stockLedgerId),
  };
}

export async function list(req, res, next) {
  try {
    const data = await svc.listTesters(req.shopId, {
      status: req.query.status,
      productId: req.query.productId,
      search: req.query.search ? String(req.query.search).trim() : undefined,
      dueOnly: String(req.query.dueOnly ?? "") === "true",
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function summary(req, res, next) {
  try { res.json({ success: true, data: await svc.getTesterSummary(req.shopId) }); }
  catch (err) { next(err); }
}

/** What testers cost the shop over a period — the number this module exists to produce. */
export async function cost(req, res, next) {
  try {
    res.json({ success: true, data: await svc.getTesterCost(req.shopId, { from: req.query.from, to: req.query.to }) });
  } catch (err) { next(err); }
}

export async function forProduct(req, res, next) {
  try { res.json({ success: true, data: await svc.getTestersForProduct(req.shopId, String(req.params.productId)) }); }
  catch (err) { next(err); }
}

export async function detail(req, res, next) {
  try { res.json({ success: true, data: await svc.getTester(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}

export async function open(req, res, next) {
  try {
    const tester = await svc.openTester(req.shopId, req.body, { userId: req.user?.userId });
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "TESTER_OPENED",
      entityType: "TesterUnit", entityId: tester.id, after: auditSnapshot(tester), req,
    });
    res.status(201).json({
      success: true,
      message: tester.stockLedgerId ? "Tester opened and taken out of stock" : "Tester recorded",
      data: tester,
    });
  } catch (err) { next(err); }
}

export async function close(req, res, next) {
  try {
    const tester = await svc.closeTester(req.shopId, req.params.id, req.body ?? {});
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "TESTER_CLOSED",
      entityType: "TesterUnit", entityId: tester.id, after: auditSnapshot(tester), req,
    });
    res.json({
      success: true,
      message: tester.status === "replaced" ? "Marked replaced — open the new one to keep counting" : "Marked discarded",
      data: tester,
    });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try { res.json({ success: true, data: await svc.updateTester(req.shopId, req.params.id, req.body) }); }
  catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const tester = await svc.softDeleteTester(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "TESTER_DELETED",
      entityType: "TesterUnit", entityId: tester.id,
      after: auditSnapshot(tester), metadata: { softDelete: true }, req,
    });
    res.json({
      success: true,
      // Deleting the record does not put the unit back: the stock movement is a
      // separate fact, and silently reversing it would be worse than saying so.
      message: "Tester record moved to recycle bin. The stock it used is unchanged.",
      data: tester,
    });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try { res.json({ success: true, message: "Tester restored", data: await svc.restoreTester(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}
