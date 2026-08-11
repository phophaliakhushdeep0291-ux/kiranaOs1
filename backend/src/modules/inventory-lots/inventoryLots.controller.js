import * as service from "./inventoryLots.service.js";
import { requestLocationId } from "../stores/location-context.service.js";

const actor = (req) => ({ userId: req.user?.userId ?? null, deviceId: req.user?.deviceId ?? undefined, req });

export async function list(req, res, next) {
  try { res.json({ success: true, data: await service.listInventoryLots(req.shopId, { ...req.query, locationId: requestLocationId(req) }) }); } catch (error) { next(error); }
}
export async function expiryAlerts(req, res, next) {
  try {
    const data = await service.nearExpiryAlerts(req.shopId, { ...req.query, locationId: requestLocationId(req) });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
export async function sellable(req, res, next) {
  try {
    const data = await service.listSellableBatches(req.shopId, { locationId: requestLocationId(req), productId: req.params.productId });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
export async function tracking(req, res, next) {
  try {
    const data = await service.setProductBatchTracking(req.shopId, req.params.productId, req.body.enabled, actor(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
export async function status(req, res, next) {
  try {
    const data = await service.changeLotStatus(req.shopId, req.params.id, req.body.status, req.body.note, actor(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
