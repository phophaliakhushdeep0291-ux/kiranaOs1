import * as svc from "./units.service.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

/** What an audit entry keeps of a unit. Identifiers are the point of the record, so they stay. */
function auditSnapshot(unit) {
  return {
    id: unit.id,
    productName: unit.productName,
    imei: unit.imei,
    serialNumber: unit.serialNumber,
    status: unit.status,
    condition: unit.condition,
    billNumber: unit.billNumber,
    soldAt: unit.soldAtKey,
    warrantyUntil: unit.warrantyUntilKey,
  };
}

export async function list(req, res, next) {
  try {
    const data = await svc.listUnits(req.shopId, {
      status: req.query.status,
      productId: req.query.productId,
      condition: req.query.condition,
      search: req.query.search ? String(req.query.search).trim() : undefined,
      from: req.query.from,
      to: req.query.to,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function summary(req, res, next) {
  try { res.json({ success: true, data: await svc.getUnitSummary(req.shopId) }); }
  catch (err) { next(err); }
}

/**
 * The counter lookup. A code nobody recognises answers 200 with null rather than
 * 404: "we have no record of this handset" is a real answer about a unit bought
 * elsewhere, not a failed request.
 */
export async function lookup(req, res, next) {
  try {
    const unit = await svc.lookupUnit(req.shopId, req.params.code);
    res.json({ success: true, data: unit });
  } catch (err) { next(err); }
}

export async function forProduct(req, res, next) {
  try {
    const data = await svc.getUnitsForProduct(req.shopId, String(req.params.productId), {
      status: req.query.status ? String(req.query.status) : "held",
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function detail(req, res, next) {
  try { res.json({ success: true, data: await svc.getUnit(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}

export async function receive(req, res, next) {
  try {
    const units = await svc.receiveUnits(req.shopId, req.body, { userId: req.user?.userId });
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "PRODUCT_UNITS_RECEIVED",
      entityType: "ProductUnit", entityId: units[0]?.id ?? null,
      after: { productName: units[0]?.productName, count: units.length, identifiers: units.map((u) => u.imei || u.serialNumber) },
      req,
    });
    res.status(201).json({
      success: true,
      message: `${units.length} unit${units.length === 1 ? "" : "s"} added to stock`,
      data: units,
    });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    // Read first so the audit log shows what the identifiers said before. A
    // serial corrected silently is a unit that can no longer be traced.
    const before = await svc.getUnit(req.shopId, req.params.id);
    const unit = await svc.updateUnit(req.shopId, req.params.id, req.body);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "PRODUCT_UNIT_CORRECTED",
      entityType: "ProductUnit", entityId: unit.id,
      before: auditSnapshot(before), after: auditSnapshot(unit), req,
    });
    res.json({ success: true, data: unit });
  } catch (err) { next(err); }
}

export async function sell(req, res, next) {
  try {
    const unit = await svc.sellUnit(req.shopId, req.params.id, req.body ?? {});
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "PRODUCT_UNIT_SOLD",
      entityType: "ProductUnit", entityId: unit.id,
      after: auditSnapshot(unit), req,
    });
    res.json({ success: true, message: "Recorded against this unit", data: unit });
  } catch (err) { next(err); }
}

export async function takeBack(req, res, next) {
  try {
    const unit = await svc.returnUnit(req.shopId, req.params.id, req.body ?? {});
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "PRODUCT_UNIT_RETURNED",
      entityType: "ProductUnit", entityId: unit.id,
      after: auditSnapshot(unit), req,
    });
    res.json({ success: true, message: "Unit taken back into stock", data: unit });
  } catch (err) { next(err); }
}

export async function toService(req, res, next) {
  try {
    const unit = await svc.sendUnitToService(req.shopId, req.params.id, req.body ?? {});
    res.json({ success: true, message: "Marked as away with the service centre", data: unit });
  } catch (err) { next(err); }
}

export async function fromService(req, res, next) {
  try {
    const unit = await svc.returnUnitFromService(req.shopId, req.params.id, req.body ?? {});
    res.json({ success: true, message: "Back from service", data: unit });
  } catch (err) { next(err); }
}

export async function writeOff(req, res, next) {
  try {
    const unit = await svc.writeOffUnit(req.shopId, req.params.id, req.body ?? {});
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "PRODUCT_UNIT_WRITTEN_OFF",
      entityType: "ProductUnit", entityId: unit.id,
      after: auditSnapshot(unit), req,
    });
    res.json({ success: true, message: `Unit marked ${unit.status}`, data: unit });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const unit = await svc.softDeleteUnit(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "PRODUCT_UNIT_DELETED",
      entityType: "ProductUnit", entityId: unit.id,
      after: auditSnapshot(unit), metadata: { softDelete: true }, req,
    });
    res.json({ success: true, message: "Unit moved to recycle bin", data: unit });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try { res.json({ success: true, message: "Unit restored", data: await svc.restoreUnit(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}
