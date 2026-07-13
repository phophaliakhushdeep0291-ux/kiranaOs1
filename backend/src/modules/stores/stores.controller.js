import * as service from "./stores.service.js";
import { createAuditLog } from "../audit/audit.service.js";

export async function listLocations(req, res, next) {
  try { res.json({ success: true, data: await service.listLocations(req.shopId) }); } catch (error) { next(error); }
}

export async function createLocation(req, res, next) {
  try {
    const data = await service.createLocation(req.shopId, req.body);
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function updateLocation(req, res, next) {
  try { res.json({ success: true, data: await service.updateLocation(req.shopId, req.params.id, req.body) }); } catch (error) { next(error); }
}

export async function inventory(req, res, next) {
  try { res.json({ success: true, data: await service.getLocationInventory(req.shopId, req.params.id) }); } catch (error) { next(error); }
}

export async function transfers(req, res, next) {
  try { res.json({ success: true, data: await service.listTransfers(req.shopId, req.query) }); } catch (error) { next(error); }
}

export async function createTransfer(req, res, next) {
  try {
    const data = await service.createTransfer(req.shopId, req.body, req.user?.userId);
    await createAuditLog({ shopId: req.shopId, userId: req.user?.userId, action: "STOCK_TRANSFER_COMPLETED", entityType: "StockTransfer", entityId: data.id, metadata: { referenceNo: data.referenceNo, fromLocationId: data.fromLocationId, toLocationId: data.toLocationId, itemCount: data.items.length }, req });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

