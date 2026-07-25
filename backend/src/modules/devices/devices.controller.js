import * as service from "./devices.service.js";
import * as healthService from "./deviceHealth.service.js";

function resolveHealthDeviceId(req) {
  const fromSession = req.user?.deviceId;
  const raw = req.headers["x-device-id"] ?? req.body?.deviceId;
  const fromHeader = Array.isArray(raw) ? raw[0] : raw;
  return fromSession ?? (typeof fromHeader === "string" && fromHeader.trim() ? fromHeader.trim() : null);
}

export async function list(req, res, next) {
  try {
    const currentDeviceId = req.headers["x-device-id"] ?? null;
    res.json({ success: true, data: await service.getDeviceManagementSnapshot(req.shopId, currentDeviceId) });
  }
  catch (err) { next(err); }
}

export async function active(req, res, next) {
  try {
    const currentDeviceId = req.query?.currentDeviceId ?? req.headers["x-device-id"] ?? null;
    res.json({ success: true, data: { activeDevices: await service.listActiveDevices(req.shopId, { currentDeviceId }) } });
  } catch (err) { next(err); }
}

export async function activate(req, res, next) {
  try { res.status(201).json({ success: true, data: await service.activateDevice(req.shopId, req.user, req.body, req) }); }
  catch (err) { next(err); }
}

export async function logoutDevice(req, res, next) {
  try {
    const currentDeviceId = req.body.currentDeviceId ?? req.headers["x-device-id"] ?? null;
    const data = await service.logoutActiveDeviceForUser(req.shopId, req.user, req.body.deviceId, currentDeviceId, req);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const data = await service.removeDevice(
      req.shopId,
      req.params.deviceId,
      req.user?.userId ?? req.user?.id,
      req,
      { allowCurrentDevice: req.body?.removeCurrentDevice === true },
    );
    res.json({ success: true, data });
  }
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

export async function rename(req, res, next) {
  try { res.json({ success: true, data: await service.renameDevice(req.shopId, req.params.deviceId, req.body.deviceName, req.user?.userId ?? req.user?.id, req) }); }
  catch (err) { next(err); }
}

export async function current(req, res, next) {
  try {
    const deviceId = req.headers["x-device-id"] ?? req.user?.deviceId ?? null;
    res.json({ success: true, data: await service.getCurrentDevice(req.shopId, deviceId) });
  } catch (err) { next(err); }
}

export async function heartbeat(req, res, next) {
  try { res.json({ success: true, data: await service.heartbeat(req.shopId, req.headers["x-device-id"] ?? req.body.deviceId) }); }
  catch (err) { next(err); }
}

export async function reportHealth(req, res, next) {
  try {
    const deviceId = resolveHealthDeviceId(req);
    const result = await healthService.recordHealth({ ...req.body, shopId: req.shopId, deviceId, userId: req.user?.userId ?? null });
    res.status(202).json({ success: true, data: result ?? { recorded: false } });
  } catch (err) { next(err); }
}

export async function listHealth(req, res, next) {
  try { res.json({ success: true, data: await healthService.listLatestHealthPerDevice({ shopId: req.shopId }) }); }
  catch (err) { next(err); }
}

export async function myHealth(req, res, next) {
  try {
    const deviceId = resolveHealthDeviceId(req);
    res.json({ success: true, data: await healthService.getLatestHealthForDevice({ shopId: req.shopId, deviceId }) });
  } catch (err) { next(err); }
}

export async function license(req, res, next) {
  try {
    const deviceId = req.query.deviceId ?? req.headers["x-device-id"];
    res.json({ success: true, data: await service.getDeviceLicense(req.shopId, deviceId) });
  } catch (err) { next(err); }
}
