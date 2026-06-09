import * as service from "./devices.service.js";

export async function list(req, res, next) {
  try { res.json({ success: true, data: await service.listDevices(req.shopId) }); }
  catch (err) { next(err); }
}

export async function activate(req, res, next) {
  try { res.status(201).json({ success: true, data: await service.activateDevice(req.shopId, req.user, req.body, req) }); }
  catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try { res.json({ success: true, data: await service.removeDevice(req.shopId, req.params.deviceId, req.user?.userId ?? req.user?.id, req) }); }
  catch (err) { next(err); }
}

export async function block(req, res, next) {
  try { res.json({ success: true, data: await service.blockDevice(req.shopId, req.params.deviceId, req.user?.userId ?? req.user?.id, req) }); }
  catch (err) { next(err); }
}

export async function unblock(req, res, next) {
  try { res.json({ success: true, data: await service.unblockDevice(req.shopId, req.params.deviceId, req.user?.userId ?? req.user?.id, req) }); }
  catch (err) { next(err); }
}

export async function heartbeat(req, res, next) {
  try { res.json({ success: true, data: await service.heartbeat(req.shopId, req.body.deviceId) }); }
  catch (err) { next(err); }
}

export async function license(req, res, next) {
  try {
    const deviceId = req.query.deviceId ?? req.headers["x-device-id"];
    res.json({ success: true, data: await service.getDeviceLicense(req.shopId, deviceId) });
  } catch (err) { next(err); }
}
