import * as service from "./stores.service.js";
import { runUnattendedReplenishment } from "./replenishment.service.js";

const actor = (req) => ({ userId: req.user?.userId ?? null, deviceId: req.user?.deviceId ?? undefined, req });

export async function listLocations(req, res, next) {
  try { res.json({ success: true, data: await service.listLocations(req.shopId, req.user) }); } catch (error) { next(error); }
}

export async function createLocation(req, res, next) {
  try {
    const data = await service.createLocation(req.shopId, req.body, actor(req));
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function updateLocation(req, res, next) {
  try {
    const data = await service.updateLocation(req.shopId, req.params.id, req.body, actor(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function inventory(req, res, next) {
  try { res.json({ success: true, data: await service.getLocationInventory(req.shopId, req.params.id) }); } catch (error) { next(error); }
}

export async function replenishmentSuggestions(req, res, next) {
  try { res.json({ success: true, data: await service.getBranchReplenishmentSuggestions(req.shopId, req.user) }); } catch (error) { next(error); }
}

export async function runReplenishment(req, res, next) {
  try {
    const data = await runUnattendedReplenishment(req.shopId, { dryRun: req.body.dryRun === true });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function transfers(req, res, next) {
  try { res.json({ success: true, data: await service.listTransfers(req.shopId, req.query, req.user) }); } catch (error) { next(error); }
}

export async function createTransfer(req, res, next) {
  try {
    const data = await service.createTransfer(req.shopId, req.body, req.user?.userId, req.user?.role, req);
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}
export async function receiveTransfer(req, res, next) {
  try {
    const data = await service.receiveTransfer(req.shopId, req.params.id, req.body, req.user?.userId, req.user?.role, req);
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function cancelTransfer(req, res, next) {
  try {
    const data = await service.cancelTransfer(req.shopId, req.params.id, req.body, req.user?.userId, req.user?.role, req);
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function reviewTransferCompliance(req, res, next) {
  try {
    const data = await service.reviewTransferCompliance(req.shopId, req.params.id, req.body, req.user?.userId, req.user?.role, req);
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
