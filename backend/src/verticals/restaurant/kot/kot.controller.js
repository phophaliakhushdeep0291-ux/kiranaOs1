import * as svc from "./kot.service.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

function auditSnapshot(ticket) {
  return {
    id: ticket.id,
    ticketNo: ticket.ticketNo,
    tableName: ticket.tableName,
    billId: ticket.billId,
    status: ticket.status,
    lineCount: ticket.lines?.length ?? 0,
  };
}

export async function list(req, res, next) {
  try {
    const data = await svc.listTickets(req.shopId, {
      status: req.query.status ? String(req.query.status) : undefined,
      billId: req.query.billId ? String(req.query.billId) : undefined,
      since: req.query.since ? String(req.query.since) : undefined,
      includeServed: String(req.query.includeServed ?? "") === "true",
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function detail(req, res, next) {
  try { res.json({ success: true, data: await svc.getTicket(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}

export async function fire(req, res, next) {
  try {
    const { ticket, created } = await svc.fireTicket(req.shopId, req.body, {
      locationId: req.locationId,
    });
    // A retry is not a new ticket, so it is not audited as one — otherwise a
    // flaky connection would fill the log with sends that never happened.
    if (created) {
      await createAuditLog({
        shopId: req.shopId, userId: req.user?.id, action: "kitchen_ticket_fired",
        entityType: "kitchen_ticket", entityId: ticket.id, after: auditSnapshot(ticket), req,
      });
    }
    res.status(created ? 201 : 200).json({ success: true, data: ticket });
  } catch (err) { next(err); }
}

export async function updateStatus(req, res, next) {
  try {
    const before = await svc.getTicket(req.shopId, req.params.id);
    const ticket = await svc.setTicketStatus(req.shopId, req.params.id, req.body.status);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "kitchen_ticket_status_changed",
      entityType: "kitchen_ticket", entityId: ticket.id,
      before: auditSnapshot(before), after: auditSnapshot(ticket), req,
    });
    res.json({ success: true, data: ticket });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const before = await svc.getTicket(req.shopId, req.params.id);
    const data = await svc.removeTicket(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "kitchen_ticket_voided",
      entityType: "kitchen_ticket", entityId: before.id, before: auditSnapshot(before), req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
