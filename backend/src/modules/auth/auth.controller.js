import * as authService from "./auth.service.js";

function requestMeta(req) {
  return {
    userAgent: req.get("user-agent") || null,
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    deviceId: getRequestDeviceId(req),
  };
}

function getRequestDeviceId(req) {
  const raw = req.get("x-device-id") || req.body?.deviceId || req.query?.deviceId || null;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export async function register(req, res, next) {
  try { res.status(201).json({ success: true, data: await authService.registerShop(req.body, requestMeta(req)) }); }
  catch (err) { next(err); }
}

export async function login(req, res, next) {
  try { res.json({ success: true, data: await authService.login(req.body, requestMeta(req)) }); }
  catch (err) { next(err); }
}

export async function verifyEmail(req, res, next) {
  try { res.json({ success: true, data: await authService.verifyEmail(req.body.token) }); }
  catch (err) { next(err); }
}

export async function resendVerification(req, res, next) {
  try { res.json({ success: true, data: await authService.resendEmailVerification(req.body) }); }
  catch (err) { next(err); }
}

export async function forgotPassword(req, res, next) {
  try { res.json({ success: true, data: await authService.requestPasswordReset(req.body) }); }
  catch (err) { next(err); }
}

export async function resetPassword(req, res, next) {
  try { res.json({ success: true, data: await authService.resetPassword(req.body) }); }
  catch (err) { next(err); }
}

export async function refresh(req, res, next) {
  try { res.json({ success: true, data: await authService.refreshSession(req.body.refreshToken, requestMeta(req)) }); }
  catch (err) { next(err); }
}

export async function logout(req, res, next) {
  try { res.json({ success: true, data: await authService.logout(req.body.refreshToken, req.user ?? null) }); }
  catch (err) { next(err); }
}

export async function me(req, res, next) {
  try { res.json({ success: true, data: await authService.getMe(req.user.userId, req.user.shopId) }); }
  catch (err) { next(err); }
}

export async function setPin(req, res, next) {
  try {
    const data = await authService.setPin(req.user.userId, req.user.shopId, req.body.pin);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function verifyPin(req, res, next) {
  try {
    const data = await authService.verifyPin(req.user.shopId, req.body.pin);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function checkPin(req, res, next) {
  try {
    const data = await authService.hasPin(req.user.shopId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function listStaff(req, res, next) {
  try { res.json({ success: true, data: await authService.listStaff(req.user.shopId) }); }
  catch (err) { next(err); }
}

export async function inviteStaff(req, res, next) {
  try {
    const data = await authService.inviteStaff(req.user.shopId, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function updateStaffRole(req, res, next) {
  try {
    const data = await authService.updateStaffRole(req.user.shopId, req.params.id, req.body.role);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function removeStaff(req, res, next) {
  try {
    const data = await authService.removeStaff(req.user.shopId, req.params.id, req.user.userId, { req });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function changePassword(req, res, next) {
  try {
    const data = await authService.changePassword(req.user.userId, req.user.shopId, req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
