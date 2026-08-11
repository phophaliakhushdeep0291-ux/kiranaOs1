import * as svc from "./inventory.service.js";
import { requestLocationId } from "../stores/location-context.service.js";
import { scheduleAuditEvaluation } from "../assurance/assurance.hooks.js";
import { ENTITY_TYPES } from "../assurance/assurance.constants.js";

function movementIdentity(req) {
  const deviceHeader = req.headers?.["x-device-id"];
  return {
    idempotencyKey: req.body.idempotencyKey,
    clientMovementId: req.body.clientMovementId ?? req.body.idempotencyKey,
    sourceDeviceId: Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader ?? null,
    locationId: requestLocationId(req),
    userId: req.user?.userId ?? null,
    req,
  };
}

export async function getInventory(req, res, next) {
  try {
    const data = await svc.getInventory(req.shopId, requestLocationId(req));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getLowStock(req, res, next) {
  try {
    const data = await svc.getLowStock(req.shopId, requestLocationId(req));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function purchase(req, res, next) {
  try {
    const data = await svc.recordPurchase(
      req.shopId,
      { ...req.body, locationId: requestLocationId(req) },
      movementIdentity(req),
    );
    res.status(data.idempotentReplay ? 200 : 201).json({ success: true, data });
    if (!data.idempotentReplay) {
      scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.PRODUCT, data.productId, { userId: req.user?.userId });
      if (data.purchaseHistoryId) scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.PURCHASE, data.purchaseHistoryId, { userId: req.user?.userId });
    }
  } catch (err) { next(err); }
}

export async function damage(req, res, next) {
  try {
    const data = await svc.recordDamage(
      req.shopId,
      { ...req.body, locationId: requestLocationId(req) },
      movementIdentity(req),
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function correction(req, res, next) {
  try {
    const data = await svc.correctStock(
      req.shopId,
      { ...req.body, locationId: requestLocationId(req) },
      movementIdentity(req),
    );
    res.json({ success: true, data });
    scheduleAuditEvaluation(req.shopId, ENTITY_TYPES.PRODUCT, data.productId, { userId: req.user?.userId });
  } catch (err) { next(err); }
}

export async function getLedger(req, res, next) {
  try {
    const data = await svc.getLedger(req.shopId, { ...req.query, locationId: requestLocationId(req) });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
