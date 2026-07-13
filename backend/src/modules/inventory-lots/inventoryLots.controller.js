import * as service from "./inventoryLots.service.js";
import { requestLocationId } from "../stores/location-context.service.js";
import { createAuditLog } from "../audit/audit.service.js";

export async function list(req, res, next) {
  try { res.json({ success: true, data: await service.listInventoryLots(req.shopId, { ...req.query, locationId: requestLocationId(req) }) }); } catch (error) { next(error); }
}
export async function tracking(req, res, next) {
  try {
    const data = await service.setProductBatchTracking(req.shopId, req.params.productId, req.body.enabled);
    await createAuditLog({ shopId: req.shopId, userId: req.user?.userId, action: "PRODUCT_BATCH_TRACKING_CHANGED", entityType: "Product", entityId: data.id, after: { batchTrackingEnabled: data.batchTrackingEnabled }, req });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
export async function status(req, res, next) {
  try {
    const data = await service.changeLotStatus(req.shopId, req.params.id, req.body.status, req.body.note);
    await createAuditLog({ shopId: req.shopId, userId: req.user?.userId, action: "INVENTORY_LOT_STATUS_CHANGED", entityType: "InventoryLot", entityId: data.id, after: { status: data.status }, metadata: { note: req.body.note }, req });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
