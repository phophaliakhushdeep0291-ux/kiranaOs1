import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { env } from "../../config/env.js";
import { getEffectivePlan, isSubscriptionActive } from "../subscription/subscription.service.js";
import { activateDevice, assertDeviceHasActiveLoginSession } from "./devices.service.js";
import { revokeDeviceLicense } from "./license.service.js";

export function requireDeviceActivated() {
  return async (req, _res, next) => {
    try {
      req.device = await assertRequestDevice(req);
      next();
    } catch (err) { next(err); }
  };
}

export function requireDeviceAllowedForSync() {
  return async (req, _res, next) => {
    try {
      req.device = await assertRequestDevice(req);
      const effective = await getEffectivePlan(req.shopId);
      if (!isSubscriptionActive(effective.subscription)) {
        const err = new AppError("Active or grace subscription required for cloud sync", 402);
        err.code = "SYNC_SUBSCRIPTION_INACTIVE";
        err.meta = { status: effective.subscription.status, planCode: effective.planCode };
        throw err;
      }
      if (!effective.features.includes("cloud_backup") && !effective.features.includes("auto_two_way_sync")) {
        const err = new AppError("Cloud sync is not included in current plan", 403);
        err.code = "SYNC_FEATURE_NOT_INCLUDED";
        err.meta = { planCode: effective.planCode };
        throw err;
      }
      next();
    } catch (err) { next(err); }
  };
}

export function requireDeviceAllowedForPremiumAction() {
  return async (req, _res, next) => {
    try {
      req.device = await assertRequestDevice(req);
      const effective = await getEffectivePlan(req.shopId);
      if (!isSubscriptionActive(effective.subscription)) {
        const err = new AppError("Active subscription required for premium action", 402);
        err.code = "PREMIUM_SUBSCRIPTION_INACTIVE";
        throw err;
      }
      next();
    } catch (err) { next(err); }
  };
}

export async function assertRequestDevice(req) {
  const deviceId = getRequestDeviceId(req);
  if (!deviceId) {
    const err = new AppError("Device id required", 400);
    err.code = "DEVICE_REQUIRED";
    throw err;
  }
  const device = await db.device.findUnique({ where: { shopId_deviceId: { shopId: req.shopId, deviceId } } });
  if (!device) {
    if (env.NODE_ENV === "production") {
      throw new AppError("Registered device not found for this session.", 401, "DEVICE_SESSION_REVOKED");
    }
    return activateMissingRequestDevice(req, deviceId);
  }
  if (["removed", "revoked"].includes(device.status)) {
    // In local development, the same shop is often opened in Chrome, Vite preview,
    // and an embedded browser at the same time. A revoked dev device should be able
    // to rejoin automatically so multi-session testing does not deadlock with 403s.
    // Production still rejects revoked devices until owner/admin reactivates them.
    if (env.NODE_ENV !== "production") {
      return activateMissingRequestDevice(req, deviceId);
    }
    const err = new AppError("Device has been removed", 403);
    err.code = "DEVICE_REMOVED";
    throw err;
  }
  if (device.status === "blocked") {
    const err = new AppError("Device is blocked", 403);
    err.code = "DEVICE_BLOCKED";
    throw err;
  }
  if (device.status !== "active") {
    const err = new AppError("Device is not active", 403);
    err.code = "DEVICE_NOT_ACTIVE";
    throw err;
  }
  if (req.user?.deviceRecordId && req.user.deviceRecordId !== device.id) {
    throw new AppError("Device context does not match this session.", 401, "DEVICE_SESSION_REVOKED");
  }
  if (req.user?.sessionVersion !== null && req.user?.sessionVersion !== undefined && req.user.sessionVersion !== device.sessionVersion) {
    throw new AppError("This device session was revoked.", 401, "DEVICE_SESSION_REVOKED");
  }
  await assertDeviceHasActiveLoginSession(req.shopId, req.user, deviceId);
  return device;
}

async function activateMissingRequestDevice(req, deviceId) {
  const user = req.user ?? {};
  const userId = user?.userId ?? user?.id ?? null;
  if (!req.shopId) {
    const err = new AppError("Shop context required before device activation", 400);
    err.code = "DEVICE_SHOP_CONTEXT_REQUIRED";
    throw err;
  }
  if (!userId) {
    const err = new AppError("Authenticated user required before device activation", 401);
    err.code = "DEVICE_USER_CONTEXT_REQUIRED";
    throw err;
  }

  // Fresh browser origins/dev servers can have a valid login token but a new
  // x-device-id that has not been registered yet. Auto-activate that device
  // through the same service used by /api/devices/activate so plan device
  // limits, blocked/removed rules, license issuing, and audit logging still
  // apply. This avoids protected reads returning misleading 404s and lets a
  // freshly opened frontend bootstrap cloud data from the backend.
  const input = {
    deviceId,
    deviceName: getRequestHeader(req, "x-device-name") || "Auto-registered browser device",
    platform: getRequestHeader(req, "x-device-platform") || "web",
    fingerprintHash: getRequestHeader(req, "x-device-fingerprint") || undefined,
  };

  try {
    return await activateDevice(req.shopId, { ...user, userId }, input, req);
  } catch (err) {
    // Local development often uses multiple browser origins (Chrome app, Vite dev,
    // preview builds). Starter allows one production device, but during dev this
    // can block cloud bootstrap with DEVICE_LIMIT_EXCEEDED. In non-production only,
    // reclaim the oldest active device for the same user/shop and retry. Production
    // still enforces the plan limit strictly.
    if (err?.code === "DEVICE_LIMIT_EXCEEDED" && env.NODE_ENV !== "production" && env.ENABLE_DEV_DEVICE_LIMIT_OVERRIDE) {
      await reclaimOldestDevelopmentDevice(req.shopId, userId, deviceId);
      return activateDevice(req.shopId, { ...user, userId }, input, req);
    }
    if (err?.statusCode) throw err;
    throw err;
  }
}

async function reclaimOldestDevelopmentDevice(shopId, userId, incomingDeviceId) {
  const oldDevice = await db.device.findFirst({
    where: {
      shopId,
      status: "active",
      deviceId: { not: incomingDeviceId },
      OR: [{ userId }, { userId: null }],
    },
    orderBy: [{ lastActiveAt: "asc" }, { createdAt: "asc" }],
  }) ?? await db.device.findFirst({
    where: { shopId, status: "active", deviceId: { not: incomingDeviceId } },
    orderBy: [{ lastActiveAt: "asc" }, { createdAt: "asc" }],
  });

  if (!oldDevice) return;
  const revokedAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.device.update({
      where: { id: oldDevice.id },
      data: {
        status: "revoked",
        sessionVersion: { increment: 1 },
        removedAt: revokedAt,
        revokedAt,
        revokeReason: "development_device_reclaimed",
      },
    });
    await tx.session.updateMany({
      where: {
        shopId,
        OR: [{ deviceRecordId: oldDevice.id }, { deviceId: oldDevice.deviceId }],
        revokedAt: null,
      },
      data: { revokedAt, revokedReason: "DEVELOPMENT_DEVICE_RECLAIMED" },
    });
  });
  await revokeDeviceLicense(shopId, oldDevice.deviceId, "development_device_reclaimed");
}

function getRequestHeader(req, name) {
  const raw = req.headers?.[name];
  if (Array.isArray(raw)) return String(raw[0] || "").trim();
  return raw === undefined || raw === null ? "" : String(raw).trim();
}

export function getRequestDeviceId(req) {
  const header = req.headers?.["x-device-id"];
  const body = req.body?.deviceId;
  const query = req.query?.deviceId;
  const raw = header ?? body ?? query;
  if (Array.isArray(raw)) return String(raw[0] || "").trim();
  return raw === undefined || raw === null ? "" : String(raw).trim();
}
