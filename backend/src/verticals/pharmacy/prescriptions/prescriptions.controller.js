import * as svc from "./prescriptions.service.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

/** What an audit entry keeps of a register row — never the patient's address or the slip image. */
function auditSnapshot(prescription) {
  return {
    id: prescription.id,
    registerNumber: prescription.registerNumber,
    status: prescription.status,
    scheduleType: prescription.scheduleType,
    doctorName: prescription.doctorName,
    patientName: prescription.patientName,
    prescribedOn: prescription.prescribedOnKey,
    dispensedAt: prescription.dispensedAtKey,
    billNumber: prescription.billNumber,
    refillsUsed: prescription.refillsUsed,
    items: prescription.items?.length ?? 0,
  };
}

export async function list(req, res, next) {
  try {
    const data = await svc.listPrescriptions(req.shopId, {
      status: req.query.status,
      scheduleType: req.query.scheduleType,
      from: req.query.from,
      to: req.query.to,
      search: req.query.search ? String(req.query.search).trim() : undefined,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function summary(req, res, next) {
  try { res.json({ success: true, data: await svc.getPrescriptionSummary(req.shopId) }); }
  catch (err) { next(err); }
}

export async function forProduct(req, res, next) {
  try {
    const data = await svc.getPrescriptionsForProduct(req.shopId, String(req.params.productId), {
      limit: req.query.limit,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function detail(req, res, next) {
  try { res.json({ success: true, data: await svc.getPrescription(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const prescription = await svc.createPrescription(req.shopId, req.body, { userId: req.user?.userId });
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "PRESCRIPTION_RECORDED",
      entityType: "Prescription", entityId: prescription.id,
      after: auditSnapshot(prescription), req,
    });
    res.status(201).json({ success: true, data: prescription });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    // Read the row first so the audit log can show what the entry said before.
    // A register that can be corrected silently is not evidence of anything.
    const before = await svc.getPrescription(req.shopId, req.params.id);
    const prescription = await svc.updatePrescription(req.shopId, req.params.id, req.body);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "PRESCRIPTION_CORRECTED",
      entityType: "Prescription", entityId: prescription.id,
      before: auditSnapshot(before), after: auditSnapshot(prescription), req,
    });
    res.json({ success: true, data: prescription });
  } catch (err) { next(err); }
}

export async function dispense(req, res, next) {
  try {
    const prescription = await svc.dispensePrescription(req.shopId, req.params.id, req.body ?? {});
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "PRESCRIPTION_DISPENSED",
      entityType: "Prescription", entityId: prescription.id,
      after: auditSnapshot(prescription), req,
    });
    res.json({ success: true, message: "Recorded in the prescription register", data: prescription });
  } catch (err) { next(err); }
}

export async function cancel(req, res, next) {
  try {
    const prescription = await svc.cancelPrescription(req.shopId, req.params.id, req.body ?? {});
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "PRESCRIPTION_CANCELLED",
      entityType: "Prescription", entityId: prescription.id,
      after: auditSnapshot(prescription), req,
    });
    res.json({ success: true, message: "Prescription cancelled", data: prescription });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const prescription = await svc.softDeletePrescription(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.userId, action: "PRESCRIPTION_DELETED",
      entityType: "Prescription", entityId: prescription.id,
      after: auditSnapshot(prescription), metadata: { softDelete: true }, req,
    });
    res.json({ success: true, message: "Prescription moved to recycle bin", data: prescription });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try { res.json({ success: true, message: "Prescription restored", data: await svc.restorePrescription(req.shopId, req.params.id) }); }
  catch (err) { next(err); }
}
