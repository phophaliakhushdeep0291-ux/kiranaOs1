// Device licensing is delegated to license.service.js, which stores signatureHash,
// uses LICENSE_SIGNING_SECRET, and rejects removed or blocked devices.
// Backward compatibility note: Removed or blocked devices cannot receive active license.
import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { getEffectivePlan } from "../subscription/subscription.service.js";
import { issueDeviceLicense, refreshDeviceLicense, revokeDeviceLicense } from "./license.service.js";
import jwt from "jsonwebtoken";

const DEVICE_LIMIT_TOKEN_PURPOSE = "device_limit_management";
const DEVICE_LIMIT_TOKEN_TTL = "10m";

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

export async function listActiveDevices(shopId, { currentDeviceId = null } = {}) {
  const rows = await getActiveDeviceSessionRows(shopId);
  const deviceIds = [...new Set(rows.map((row) => row.deviceId).filter(Boolean))];
  const devices = deviceIds.length
    ? await db.device.findMany({ where: { shopId, deviceId: { in: deviceIds } } })
    : [];
  const deviceById = new Map(devices.map((device) => [device.deviceId, device]));
  return serializeActiveDeviceRows(rows, currentDeviceId, deviceById);
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
    const activeDevices = await listActiveDevices(shopId, { currentDeviceId: deviceId });
    const message = `Your plan allows only ${allowedMaxDevices} active devices. Logout from another device to continue.`;
    const err = new AppError(message, 403);
    err.code = "DEVICE_LIMIT_EXCEEDED";
    const publicData = {
      activeDevices,
      plan: {
        code: effective.planCode,
        maxDevices: effective.limits.maxDevices,
        allowedMaxDevices,
      },
      deviceLimitToken: createDeviceLimitToken({
        shopId,
        userId: user?.userId ?? user?.id ?? null,
        role: user?.role ?? null,
        currentDeviceId: deviceId,
      }),
    };
    err.meta = {
      activeCount: activeSessionDeviceIds.size,
      maxDevices: effective.limits.maxDevices,
      allowedMaxDevices,
      planCode: effective.planCode,
      developmentOverride: isDevelopmentMultiDeviceOverrideEnabled(),
      mode: "active_login_sessions",
      activeDevices,
    };
    err.publicData = publicData;
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
  const sessionDeviceIds = [...new Set(sessions.map((session) => session.deviceId).filter(Boolean))];
  if (!sessionDeviceIds.length) return new Set();

  const inactiveDevices = await db.device.findMany({
    where: {
      shopId,
      deviceId: { in: sessionDeviceIds },
      status: { in: ["blocked", "removed"] },
    },
    select: { deviceId: true },
  });
  const inactiveDeviceIds = new Set(inactiveDevices.map((device) => device.deviceId));
  return new Set(sessionDeviceIds.filter((deviceId) => !inactiveDeviceIds.has(deviceId)));
}

async function getActiveDeviceSessionRows(shopId) {
  return db.session.findMany({
    where: {
      shopId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      deviceId: { not: null },
    },
    select: {
      id: true,
      userId: true,
      deviceId: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      user: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

function serializeActiveDeviceRows(rows, currentDeviceId = null, deviceById = new Map()) {
  const byDevice = new Map();
  for (const row of rows) {
    const deviceId = row.deviceId;
    if (!deviceId) continue;
    const device = deviceById.get(deviceId);
    const existing = byDevice.get(deviceId);
    if (!existing) {
      byDevice.set(deviceId, {
        deviceId,
        deviceName: device?.deviceName ?? inferDeviceName(row.userAgent),
        platform: device?.platform ?? null,
        lastSeenAt: device?.lastActiveAt ?? row.createdAt,
        current: Boolean(currentDeviceId && deviceId === currentDeviceId),
        userId: row.userId,
        userName: row.user?.name ?? null,
        userRole: row.user?.role ?? null,
        sessionCount: 1,
      });
    } else {
      existing.sessionCount += 1;
      if (new Date(row.createdAt).getTime() > new Date(existing.lastSeenAt).getTime()) {
        existing.lastSeenAt = row.createdAt;
      }
      if (currentDeviceId && deviceId === currentDeviceId) existing.current = true;
    }
  }
  return [...byDevice.values()].sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
}

function inferDeviceName(userAgent) {
  const ua = String(userAgent || "");
  if (/Android/i.test(ua)) return "Android browser";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS browser";
  if (/Windows/i.test(ua)) return "Windows browser";
  if (/Mac/i.test(ua)) return "Mac browser";
  return "Browser device";
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

export async function bindLoginSessionToDevice(shopId, user, deviceId) {
  if (!shopId || !deviceId) return;

  const sessionId = user?.sessionId ?? user?.sid ?? null;
  const userId = user?.userId ?? user?.id ?? null;
  if (!sessionId || !userId) return;

  const session = await db.session.findFirst({
    where: {
      id: sessionId,
      shopId,
      userId,
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

  if (session.deviceId && session.deviceId !== deviceId) {
    const err = new AppError("This login session belongs to another device", 403);
    err.code = "SESSION_DEVICE_MISMATCH";
    throw err;
  }

  if (session.deviceId === deviceId) {
    user.deviceId = deviceId;
    return;
  }

  const result = await db.session.updateMany({
    where: {
      id: sessionId,
      shopId,
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      deviceId: null,
    },
    data: { deviceId },
  });

  if (result.count !== 1) {
    await assertDeviceHasActiveLoginSession(shopId, user, deviceId);
    return;
  }

  user.deviceId = deviceId;
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
    await bindLoginSessionToDevice(shopId, user, device.deviceId);
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

  await bindLoginSessionToDevice(shopId, user, device.deviceId);
  const license = await issueDeviceLicense(shopId, device.deviceId);
  await auditDeviceAction({ shopId, userId, action: "DEVICE_ACTIVATED", entityId: device.id, metadata: { deviceId: device.deviceId, platform: device.platform, planCode: license.payload.planCode }, req });
  return withLicense(device, license);
}

export async function logoutActiveDeviceWithChallenge({ deviceLimitToken, targetDeviceId, currentDeviceId = null }, req = null) {
  const payload = verifyDeviceLimitToken(deviceLimitToken);
  if (currentDeviceId && payload.currentDeviceId && currentDeviceId !== payload.currentDeviceId) {
    const err = new AppError("Device context changed. Please sign in again.", 409);
    err.code = "DEVICE_LIMIT_CONTEXT_CHANGED";
    throw err;
  }
  return revokeActiveDeviceSessions({
    shopId: payload.shopId,
    actorUserId: payload.userId,
    actorRole: payload.role,
    targetDeviceId,
    currentDeviceId: payload.currentDeviceId,
    req,
    reason: "device_limit_login_replaced",
  });
}

export async function logoutActiveDeviceForUser(shopId, user, targetDeviceId, currentDeviceId = null, req = null) {
  return revokeActiveDeviceSessions({
    shopId,
    actorUserId: user?.userId ?? user?.id ?? null,
    actorRole: user?.role ?? null,
    targetDeviceId,
    currentDeviceId,
    req,
    reason: "device_logout_requested",
  });
}

async function revokeActiveDeviceSessions({ shopId, actorUserId, actorRole, targetDeviceId, currentDeviceId, req, reason }) {
  if (!shopId || !actorUserId) {
    const err = new AppError("Device logout context is invalid", 401);
    err.code = "DEVICE_LOGOUT_CONTEXT_INVALID";
    throw err;
  }
  if (!targetDeviceId) {
    const err = new AppError("Target device is required", 400);
    err.code = "DEVICE_REQUIRED";
    throw err;
  }
  if (currentDeviceId && targetDeviceId === currentDeviceId) {
    const err = new AppError("Choose another device to logout before continuing.", 400);
    err.code = "CANNOT_LOGOUT_CURRENT_DEVICE_DURING_LOGIN";
    throw err;
  }

  const canManageShopDevices = ["owner", "admin"].includes(actorRole);
  const where = {
    shopId,
    deviceId: targetDeviceId,
    revokedAt: null,
    expiresAt: { gt: new Date() },
    ...(canManageShopDevices ? {} : { userId: actorUserId }),
  };
  const activeSessions = await db.session.findMany({
    where,
    select: { id: true, userId: true, deviceId: true },
  });
  if (activeSessions.length === 0) {
    const err = new AppError("No active session found for this device", 404);
    err.code = "ACTIVE_DEVICE_SESSION_NOT_FOUND";
    throw err;
  }

  const revokedAt = new Date();
  const result = await db.session.updateMany({
    where: { id: { in: activeSessions.map((session) => session.id) } },
    data: { revokedAt, revokedReason: reason },
  });

  await db.device.updateMany({
    where: { shopId, deviceId: targetDeviceId },
    data: { lastActiveAt: revokedAt },
  });

  await auditDeviceAction({
    shopId,
    userId: actorUserId,
    action: "DEVICE_SESSION_REVOKED",
    entityId: targetDeviceId,
    metadata: {
      deviceId: targetDeviceId,
      revokedSessions: result.count,
      reason,
      managedShopDevices: canManageShopDevices,
    },
    req,
  });

  return {
    success: true,
    deviceId: targetDeviceId,
    revokedSessions: result.count,
    activeDevices: await listActiveDevices(shopId, { currentDeviceId }),
  };
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

function createDeviceLimitToken({ shopId, userId, role, currentDeviceId }) {
  return jwt.sign(
    {
      purpose: DEVICE_LIMIT_TOKEN_PURPOSE,
      shopId,
      userId,
      role,
      currentDeviceId,
    },
    env.JWT_SECRET,
    { expiresIn: DEVICE_LIMIT_TOKEN_TTL }
  );
}

function verifyDeviceLimitToken(token) {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (payload?.purpose !== DEVICE_LIMIT_TOKEN_PURPOSE || !payload.shopId || !payload.userId) {
      throw new Error("invalid purpose");
    }
    return payload;
  } catch {
    const err = new AppError("Device management session expired. Please sign in again.", 401);
    err.code = "DEVICE_LIMIT_TOKEN_INVALID";
    throw err;
  }
}
