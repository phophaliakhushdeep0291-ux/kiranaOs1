// Device licensing is delegated to license.service.js, which stores signatureHash,
// uses LICENSE_SIGNING_SECRET, and rejects removed or blocked devices.
// Backward compatibility note: Removed or blocked devices cannot receive active license.
import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { getEffectivePlan } from "../subscription/subscription.service.js";
import { issueDeviceLicense, refreshDeviceLicense, revokeDeviceLicense } from "./license.service.js";

function isDevelopmentMultiDeviceOverrideEnabled() {
  return env.NODE_ENV === "development" && env.ENABLE_DEV_DEVICE_LIMIT_OVERRIDE && env.DEV_MAX_ACTIVE_DEVICES > 0;
}

function getRuntimeDeviceLimit(planMaxDevices, subscription = null) {
  if (isDevelopmentMultiDeviceOverrideEnabled()) {
    return Math.max(Number(planMaxDevices) || 1, env.DEV_MAX_ACTIVE_DEVICES);
  }
  return Number(planMaxDevices) || 1;
}

export async function listDevices(shopId) {
  return db.device.findMany({ where: { shopId }, orderBy: { createdAt: "asc" } });
}

export async function assertDeviceCanOwnLoginSession(shopId, user, deviceId) {
  if (!shopId || !deviceId) return;

  const existing = await db.device.findUnique({ where: { shopId_deviceId: { shopId, deviceId } } });
  if (existing?.status === "blocked") {
    const err = new AppError("Device is blocked", 403);
    err.code = "DEVICE_BLOCKED";
    throw err;
  }

  // A manually removed device should not silently come back for staff in production.
  // Owner/admin can reactivate it, and any device can log in again if its old session
  // was merely logged out and the same browser device id is reused.
  if (existing?.status === "removed" && env.NODE_ENV === "production" && !["owner", "admin"].includes(user?.role)) {
    const err = new AppError("Removed device reactivation requires owner/admin approval", 403);
    err.code = "DEVICE_REMOVED_REACTIVATION_REQUIRES_OWNER";
    throw err;
  }

  const effective = await getEffectivePlan(shopId);
  const activeSessionDeviceIds = await getActiveSessionDeviceIds(shopId);
  activeSessionDeviceIds.delete(deviceId);

  const allowedMaxDevices = getRuntimeDeviceLimit(effective.limits.maxDevices, effective.subscription);
  if (activeSessionDeviceIds.size >= allowedMaxDevices) {
    const err = new AppError("Device limit exceeded", 403);
    err.code = "DEVICE_LIMIT_EXCEEDED";
    err.meta = {
      activeCount: activeSessionDeviceIds.size,
      maxDevices: effective.limits.maxDevices,
      allowedMaxDevices,
      planCode: effective.planCode,
      developmentOverride: isDevelopmentMultiDeviceOverrideEnabled(),
      mode: "active_login_sessions",
    };
    throw err;
  }
}

async function getActiveSessionDeviceIds(shopId) {
  const sessions = await db.session.findMany({
    where: {
      shopId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      deviceId: { not: null },
    },
    select: { deviceId: true },
  });
  return new Set(sessions.map((session) => session.deviceId).filter(Boolean));
}

export async function assertDeviceHasActiveLoginSession(shopId, user, deviceId) {
  if (!shopId || !deviceId) return;

  const sessionId = user?.sessionId ?? user?.sid ?? null;
  if (sessionId) {
    const session = await db.session.findFirst({
      where: {
        id: sessionId,
        shopId,
        userId: user?.userId ?? user?.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { deviceId: true },
    });

    if (!session) {
      const err = new AppError("Login session is no longer active", 401);
      err.code = "SESSION_INACTIVE";
      throw err;
    }

    if (session.deviceId !== deviceId) {
      const err = new AppError("This login session belongs to another device", 403);
      err.code = "SESSION_DEVICE_MISMATCH";
      throw err;
    }

    return;
  }

  const activeSessionDeviceIds = await getActiveSessionDeviceIds(shopId);
  if (!activeSessionDeviceIds.has(deviceId)) {
    const err = new AppError("Active login session required for this device", 403);
    err.code = "DEVICE_SESSION_REQUIRED";
    throw err;
  }
}

export async function activateDevice(shopId, user, input, req = null) {
  const userId = user?.userId ?? user?.id ?? null;
  const existing = await db.device.findUnique({ where: { shopId_deviceId: { shopId, deviceId: input.deviceId } } });
  const now = new Date();

  // Even already-registered devices must respect the current plan's concurrent-device limit.
  // Without this, an old active Device row could keep working after the shop is already over limit.
  await assertDeviceCanOwnLoginSession(shopId, user, input.deviceId);

  if (existing?.status === "active") {
    const device = await db.device.update({
      where: { id: existing.id },
      data: {
        userId,
        deviceName: input.deviceName ?? existing.deviceName,
        platform: input.platform ?? existing.platform,
        fingerprintHash: input.fingerprintHash ?? existing.fingerprintHash,
        lastActiveAt: now,
      },
    });
    const license = await refreshDeviceLicense(shopId, device.deviceId);
    return withLicense(device, license, { idempotent: true });
  }

  if (existing?.status === "blocked") {
    const err = new AppError("Device is blocked", 403);
    err.code = "DEVICE_BLOCKED";
    throw err;
  }

  if (existing?.status === "removed" && env.NODE_ENV === "production" && !["owner", "admin"].includes(user?.role)) {
    const err = new AppError("Removed device reactivation requires owner/admin approval", 403);
    err.code = "DEVICE_REMOVED_REACTIVATION_REQUIRES_OWNER";
    throw err;
  }

  const device = existing
    ? await db.device.update({
        where: { id: existing.id },
        data: {
          userId,
          deviceName: input.deviceName ?? existing.deviceName ?? "Unknown device",
          platform: input.platform ?? existing.platform ?? "unknown",
          fingerprintHash: input.fingerprintHash ?? existing.fingerprintHash,
          status: "active",
          activatedAt: existing.activatedAt ?? now,
          lastActiveAt: now,
          removedAt: null,
        },
      })
    : await db.device.create({
        data: {
          shopId,
          userId,
          deviceId: input.deviceId,
          deviceName: input.deviceName ?? "Unknown device",
          platform: input.platform ?? "unknown",
          fingerprintHash: input.fingerprintHash,
          status: "active",
          activatedAt: now,
          lastActiveAt: now,
        },
      });

  const license = await issueDeviceLicense(shopId, device.deviceId);
  await auditDeviceAction({ shopId, userId, action: "DEVICE_ACTIVATED", entityId: device.id, metadata: { deviceId: device.deviceId, platform: device.platform, planCode: license.payload.planCode }, req });
  return withLicense(device, license);
}

export async function removeDevice(shopId, deviceId, userId = null, req = null) {
  const device = await findDevice(shopId, deviceId);
  const removedAt = new Date();
  const updated = await db.device.update({ where: { id: device.id }, data: { status: "removed", removedAt } });
  await revokeDeviceLicense(shopId, device.deviceId, "device_removed");
  await auditDeviceAction({ shopId, userId, action: "DEVICE_REMOVED", entityId: device.id, metadata: { deviceId: device.deviceId }, req });
  return updated;
}

export async function blockDevice(shopId, deviceId, userId = null, req = null) {
  const device = await findDevice(shopId, deviceId);
  const updated = await db.device.update({ where: { id: device.id }, data: { status: "blocked" } });
  await revokeDeviceLicense(shopId, device.deviceId, "device_blocked");
  await auditDeviceAction({ shopId, userId, action: "DEVICE_BLOCKED", entityId: device.id, metadata: { deviceId: device.deviceId }, req });
  return updated;
}

export async function unblockDevice(shopId, deviceId, userId = null, req = null) {
  const device = await findDevice(shopId, deviceId);
  if (device.status !== "blocked") return device;
  const updated = await db.device.update({ where: { id: device.id }, data: { status: "removed", removedAt: new Date() } });
  await auditDeviceAction({ shopId, userId, action: "DEVICE_UNBLOCKED", entityId: device.id, metadata: { deviceId: device.deviceId, nextStatus: "removed" }, req });
  return updated;
}

export async function heartbeat(shopId, deviceId) {
  const device = await findDevice(shopId, deviceId);
  if (device.status === "removed") {
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
  return db.device.update({ where: { id: device.id }, data: { lastActiveAt: new Date() } });
}

export async function getDeviceLicense(shopId, deviceId) {
  return refreshDeviceLicense(shopId, deviceId);
}

async function findDevice(shopId, deviceId) {
  if (!deviceId) {
    const err = new AppError("Device id required", 400);
    err.code = "DEVICE_REQUIRED";
    throw err;
  }
  const device = await db.device.findUnique({ where: { shopId_deviceId: { shopId, deviceId } } });
  if (!device) {
    const err = new AppError("Device not found", 404);
    err.code = "DEVICE_NOT_FOUND";
    throw err;
  }
  return device;
}

function withLicense(device, license, extra = {}) {
  return {
    ...device,
    ...extra,
    license,
  };
}

function auditDeviceAction({ shopId, userId, action, entityId, metadata, req }) {
  return createAuditLog({ shopId, userId, action, entityType: "Device", entityId, metadata, req });
}
