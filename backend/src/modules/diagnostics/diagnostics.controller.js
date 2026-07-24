import * as svc from "./diagnostics.service.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";

function headerDeviceId(req) {
  const raw = req.headers["x-device-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Prefer the server-verified device from the session; the header is only a fallback
// (requireAuth already rejects a header that disagrees with the session's device).
function resolveDeviceId(req) {
  return req.user?.deviceId ?? headerDeviceId(req);
}

export async function reportError(req, res, next) {
  try {
    const result = await svc.recordErrorEvent({
      ...req.body,
      source: "frontend",
      shopId: req.shopId ?? null,
      userId: req.user?.userId ?? null,
      deviceId: resolveDeviceId(req),
    });
    // recordErrorEvent never throws; a null result just means the event was dropped.
    res.status(202).json({ success: true, data: result ?? { recorded: false } });
  } catch (err) {
    next(err);
  }
}

export async function createSupportRequest(req, res, next) {
  try {
    let screenshotKey = null;
    if (req.body.screenshot) {
      screenshotKey = await svc.maybeUploadScreenshot(req.body.screenshot, { shopId: req.shopId });
    }
    const request = await svc.createSupportRequest({
      shopId: req.shopId,
      userId: req.user?.userId ?? null,
      deviceId: resolveDeviceId(req),
      description: req.body.description,
      page: req.body.page,
      appVersion: req.body.appVersion,
      context: req.body.context,
      screenshotKey,
    });
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "SUPPORT_REQUEST_CREATED",
      entityType: "SupportRequest",
      entityId: request.id,
      metadata: { page: req.body.page ?? null, hasScreenshot: Boolean(screenshotKey) },
      req,
    });
    res.status(201).json({
      success: true,
      message: "Thanks — your report was sent to support.",
      data: { id: request.id, status: request.status, createdAt: request.createdAt },
    });
  } catch (err) {
    next(err);
  }
}

export async function listErrors(req, res, next) {
  try {
    res.json({
      success: true,
      data: await svc.listErrorGroups({ shopId: req.shopId, status: req.query.status, limit: req.query.limit }),
    });
  } catch (err) {
    next(err);
  }
}

export async function getErrorGroup(req, res, next) {
  try {
    const detail = await svc.getErrorGroupDetail({ shopId: req.shopId, id: req.params.id });
    if (!detail) return next(new AppError("Error group not found", 404, "ERROR_GROUP_NOT_FOUND"));
    res.json({ success: true, data: detail });
  } catch (err) {
    next(err);
  }
}

export async function listSupport(req, res, next) {
  try {
    res.json({
      success: true,
      data: await svc.listSupportRequests({ shopId: req.shopId, status: req.query.status, limit: req.query.limit }),
    });
  } catch (err) {
    next(err);
  }
}
