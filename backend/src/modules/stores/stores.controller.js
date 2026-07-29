import * as service from "./stores.service.js";
import { createAuditLog } from "../audit/audit.service.js";

function locationAuditSnapshot(location) {
  if (!location) return null;
  return {
    code: location.code,
    name: location.name,
    address: location.address,
    city: location.city,
    gstNumber: location.gstNumber,
    gstStateCode: location.gstStateCode,
    gstLegalName: location.gstLegalName,
    gstTradeName: location.gstTradeName,
    gstRegistrationType: location.gstRegistrationType,
    phone: location.phone,
    active: location.active,
    isPrimary: location.isPrimary,
  };
}

export async function listLocations(req, res, next) {
  try { res.json({ success: true, data: await service.listLocations(req.shopId, req.user) }); } catch (error) { next(error); }
}

export async function createLocation(req, res, next) {
  try {
    const data = await service.createLocation(req.shopId, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "STORE_LOCATION_CREATED",
      entityType: "StoreLocation",
      entityId: data.id,
      after: locationAuditSnapshot(data),
      metadata: { registrationFormatValidated: data.taxRegistration?.formatValid === true, portalVerified: false },
      req,
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function updateLocation(req, res, next) {
  try {
    const before = await service.getLocationForAudit(req.shopId, req.params.id);
    const data = await service.updateLocation(req.shopId, req.params.id, req.body);
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "STORE_LOCATION_UPDATED",
      entityType: "StoreLocation",
      entityId: data.id,
      before: locationAuditSnapshot(before),
      after: locationAuditSnapshot(data),
      metadata: { registrationFormatValidated: data.taxRegistration?.formatValid === true, portalVerified: false },
      req,
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function inventory(req, res, next) {
  try { res.json({ success: true, data: await service.getLocationInventory(req.shopId, req.params.id) }); } catch (error) { next(error); }
}

export async function transfers(req, res, next) {
  try { res.json({ success: true, data: await service.listTransfers(req.shopId, req.query, req.user) }); } catch (error) { next(error); }
}

export async function createTransfer(req, res, next) {
  try {
    const data = await service.createTransfer(req.shopId, req.body, req.user?.userId, req.user?.role);
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "STOCK_TRANSFER_COMPLETED",
      entityType: "StockTransfer",
      entityId: data.id,
      metadata: {
        referenceNo: data.referenceNo,
        fromLocationId: data.fromLocationId,
        toLocationId: data.toLocationId,
        itemCount: data.items.length,
        gstTreatment: data.gstTreatment,
        documentType: data.documentType,
        documentNumber: data.documentNumber,
        taxableValuePaise: data.taxableValuePaise?.toString?.() ?? null,
        taxTotalPaise: data.taxTotalPaise?.toString?.() ?? null,
        consignmentValuePaise: data.consignmentValuePaise?.toString?.() ?? null,
        eWayReviewRequired: data.eWayReviewRequired,
        legalSubmissionStatus: data.legalSubmissionStatus,
      },
      req,
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}
export async function reviewTransferCompliance(req, res, next) {
  try {
    const data = await service.reviewTransferCompliance(req.shopId, req.params.id, req.body, req.user?.userId, req.user?.role, req);
    res.json({ success: true, data });
  } catch (error) { next(error); }
}