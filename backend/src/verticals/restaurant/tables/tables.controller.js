import * as svc from "./tables.service.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

function auditSnapshot(table) {
  return {
    id: table.id,
    code: table.code,
    name: table.name,
    section: table.section,
    seats: table.seats,
    selfOrderEnabled: table.selfOrderEnabled,
  };
}

export async function list(req, res, next) {
  try {
    const data = await svc.listTables(req.shopId, {
      locationId: req.query.locationId ? String(req.query.locationId) : undefined,
      includeInactive: String(req.query.includeInactive ?? "") === "true",
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function detail(req, res, next) {
  try { res.json({ success: true, data: await svc.getTable(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const table = await svc.createTable(req.shopId, req.body);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "restaurant_table_created",
      entityType: "restaurant_table", entityId: table.id, after: auditSnapshot(table), req,
    });
    res.status(201).json({ success: true, data: table });
  } catch (err) { next(err); }
}

/**
 * Lay out the whole floor at once — also how a till's device-local plan is
 * lifted to the server the first time a restaurant prints table QR codes.
 */
export async function replaceFloor(req, res, next) {
  try {
    const before = await svc.listTables(req.shopId, { includeInactive: true });
    const tables = await svc.replaceFloorPlan(req.shopId, req.body.tables ?? []);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "restaurant_floor_replaced",
      entityType: "restaurant_table", entityId: null,
      before: { count: before.length }, after: { count: tables.length }, req,
    });
    res.json({ success: true, data: tables });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const before = await svc.getTable(req.shopId, req.params.id);
    const table = await svc.updateTable(req.shopId, req.params.id, req.body);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "restaurant_table_updated",
      entityType: "restaurant_table", entityId: table.id,
      before: auditSnapshot(before), after: auditSnapshot(table), req,
    });
    res.json({ success: true, data: table });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const before = await svc.getTable(req.shopId, req.params.id);
    const data = await svc.removeTable(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "restaurant_table_removed",
      entityType: "restaurant_table", entityId: before.id, before: auditSnapshot(before), req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try {
    const table = await svc.restoreTable(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "restaurant_table_restored",
      entityType: "restaurant_table", entityId: table.id, after: auditSnapshot(table), req,
    });
    res.json({ success: true, data: table });
  } catch (err) { next(err); }
}
