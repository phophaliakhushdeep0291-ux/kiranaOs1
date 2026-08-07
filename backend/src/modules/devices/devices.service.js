// Device licensing is delegated to license.service.js, which stores signatureHash,
// uses LICENSE_SIGNING_SECRET, and rejects removed or blocked devices.
// Backward compatibility note: Removed or blocked devices cannot receive active license.
import db from "../../db.js";
import bcrypt from "bcryptjs";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { getEffectivePlan } from "../subscription/subscription.service.js";
import { issueDeviceLicense, refreshDeviceLicense, revokeDeviceLicense } from "./license.service.js";
import jwt from "jsonwebtoken";

const DEVICE_LIMIT_TOKEN_PURPOSE = "DEVICE_REPLACEMENT";
const DEVICE_LIMIT_TOKEN_TTL = "5m";
const SLOT_OCCUPYING_STATUSES = ["active", "logged_out", "blocked"];
const shopDeviceLocks = new Map();

function isDevelopmentMultiDeviceOverrideEnabled() {
  return env.NODE_ENV === "development" && env.ENABLE_DEV_DEVICE_LIMIT_OVERRIDE && env.DEV_MAX_ACTIVE_DEVICES > 0;
}

export function getRuntimeDeviceLimit(planMaxDevices, subscription = null) {
  if (isDevelopmentMultiDeviceOverrideEnabled()) {
    return Math.max(Number(planMaxDevices) || 1, env.DEV_MAX_ACTIVE_DEVICES);
  }
  return Number(planMaxDevices) || 1;
}

export function deviceStatusOccupiesSlot(status) {
  return SLOT_OCCUPYING_STATUSES.includes(normalizeDeviceStatus(status));
}

function normalizeDeviceStatus(status) {
  if (status === "removed") return "revoked";
  return status || "active";
}

function normalizeDeviceMetadata(reqMeta = {}) {
  const supplied = reqMeta.device && typeof reqMeta.device === "object" ? reqMeta.device : {};
  const deviceId = String(supplied.deviceId ?? reqMeta.deviceId ?? "").trim();
  return {
    deviceId,
    deviceName: cleanText(supplied.deviceName, 120) || inferDeviceName(reqMeta.userAgent),
    deviceType: cleanText(supplied.deviceType, 24) || "desktop",
    operatingSystem: cleanText(supplied.operatingSystem, 60),
    browser: cleanText(supplied.browser, 60),
    appVersion: cleanText(supplied.appVersion, 40),
    platform: cleanText(supplied.platform, 50) || "web",
    userAgent: cleanText(reqMeta.userAgent, 500),
    ipAddress: cleanText(reqMeta.ipAddress, 120),
  };
}

function cleanText(value, maxLength) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

async function acquireShopRegistrationLock(tx, shopId) {
  if (/^postgres(?:ql)?:\/\//i.test(env.DATABASE_URL || "")) {
    // PostgreSQL reports pg_advisory_xact_lock as `void`. Cast it so Prisma can
    // deserialize the result instead of failing every device lifecycle request.
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS lock_result", shopId);
  }
}

async function withProcessShopLock(shopId, work) {
  const previous = shopDeviceLocks.get(shopId) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  shopDeviceLocks.set(shopId, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (shopDeviceLocks.get(shopId) === tail) shopDeviceLocks.delete(shopId);
  }
}

export async function withDeviceLifecycleTransaction(shopId, work) {
  return withProcessShopLock(shopId, () => db.$transaction(async (tx) => {
    await acquireShopRegistrationLock(tx, shopId);
    return work(tx);
  }));
}

/**
 * Registers/reactivates the installation and creates its refresh session as one
 * critical operation. The in-process lock protects SQLite/tests; PostgreSQL's
 * advisory transaction lock protects concurrent registrations across servers.
 */
export async function createDeviceBoundLoginSession({ user, reqMeta, sessionData }) {
  const metadata = normalizeDeviceMetadata(reqMeta);
  if (!metadata.deviceId) {
    const err = new AppError("A device id is required to sign in. Please reload the app and try again.", 400);
    err.code = "DEVICE_ID_REQUIRED";
    throw err;
  }
  if (metadata.deviceId.length < 3 || metadata.deviceId.length > 128) {
    throw new AppError("Device id must be between 3 and 128 characters.", 400, "DEVICE_ID_INVALID");
  }

  return withProcessShopLock(user.shopId, async () => {
    const result = await db.$transaction(async (tx) => {
    await acquireShopRegistrationLock(tx, user.shopId);
    const effective = await getEffectivePlan(user.shopId, tx);
    const shopState = await tx.shop.findUniqueOrThrow({ where: { id: user.shopId }, select: { dataEpoch: true } });
    const allowedMaxDevices = getRuntimeDeviceLimit(effective.limits.maxDevices, effective.subscription);
    const existing = await tx.device.findUnique({
      where: { shopId_deviceId: { shopId: user.shopId, deviceId: metadata.deviceId } },
    });
    const existingStatus = normalizeDeviceStatus(existing?.status);

    if (existingStatus === "blocked") {
      return { blocked: true };
    }

    const registeredDeviceCount = await tx.device.count({
      where: { shopId: user.shopId, status: { in: SLOT_OCCUPYING_STATUSES } },
    });
    const needsSlot = !existing || existingStatus === "revoked";
    if (needsSlot && registeredDeviceCount >= allowedMaxDevices) {
      return {
        limitReached: true,
        registeredDeviceCount,
        allowedMaxDevices,
        planCode: effective.planCode,
        metadata,
      };
    }

    const now = new Date();
    const device = existing
      ? await tx.device.update({
          where: { id: existing.id },
          data: {
            userId: user.id,
            deviceName: metadata.deviceName ?? existing.deviceName,
            platform: metadata.platform ?? existing.platform,
            deviceType: metadata.deviceType ?? existing.deviceType,
            operatingSystem: metadata.operatingSystem ?? existing.operatingSystem,
            browser: metadata.browser ?? existing.browser,
            userAgent: metadata.userAgent ?? existing.userAgent,
            appVersion: metadata.appVersion ?? existing.appVersion,
            lastIpAddress: metadata.ipAddress ?? existing.lastIpAddress,
            status: "active",
            activatedAt: existing.activatedAt ?? now,
            lastActiveAt: now,
            lastLoginAt: now,
            lastSeenAt: now,
            dataEpoch: shopState.dataEpoch,
            removedAt: null,
            revokedAt: null,
            revokedByUserId: null,
            revokeReason: null,
            ...(existingStatus === "revoked" ? { sessionVersion: { increment: 1 } } : {}),
          },
        })
      : await tx.device.create({
          data: {
            shopId: user.shopId,
            userId: user.id,
            deviceId: metadata.deviceId,
            deviceName: metadata.deviceName,
            platform: metadata.platform,
            deviceType: metadata.deviceType,
            operatingSystem: metadata.operatingSystem,
            browser: metadata.browser,
            userAgent: metadata.userAgent,
            appVersion: metadata.appVersion,
            lastIpAddress: metadata.ipAddress,
            status: "active",
            activatedAt: now,
            lastActiveAt: now,
            lastLoginAt: now,
            lastSeenAt: now,
            dataEpoch: shopState.dataEpoch,
          },
        });

    const session = await tx.session.create({
      data: {
        ...sessionData,
        userId: user.id,
        shopId: user.shopId,
        deviceId: metadata.deviceId,
        deviceRecordId: device.id,
        deviceSessionVersion: device.sessionVersion,
        lastUsedAt: now,
      },
    });
    return { device, session };
    }, { maxWait: 5_000, timeout: 15_000 });

  if (result.blocked) {
    throw new AppError("This device has been blocked by the shop owner.", 403, "DEVICE_BLOCKED");
  }
  if (result.limitReached) {
    const challenge = await createReplacementChallenge(user, result.metadata);
    const activeDevices = await listSafeDevices(user.shopId, { currentDeviceId: result.metadata.deviceId });
    const message = `Your current plan allows only ${result.allowedMaxDevices} registered device${result.allowedMaxDevices === 1 ? "" : "s"}.`;
    const err = new AppError(message, 403, "DEVICE_LIMIT_EXCEEDED");
    err.publicData = {
      deviceLimit: result.allowedMaxDevices,
      registeredDeviceCount: result.registeredDeviceCount,
      requiresDeviceReplacement: true,
      activeDevices,
      devices: activeDevices,
      plan: { code: result.planCode, maxDevices: result.allowedMaxDevices, allowedMaxDevices: result.allowedMaxDevices },
      deviceLimitToken: challenge.token,
      replacementToken: challenge.token,
    };
    await auditDeviceAction({
      shopId: user.shopId,
      userId: user.id,
      action: "DEVICE_LIMIT_LOGIN_REJECTED",
      entityId: result.metadata.deviceId,
      metadata: { registeredDeviceCount: result.registeredDeviceCount, deviceLimit: result.allowedMaxDevices },
    });
    throw err;
  }

  await auditDeviceAction({
    shopId: user.shopId,
    userId: user.id,
    action: "DEVICE_LOGIN",
    entityId: result.device.id,
    metadata: { deviceId: result.device.deviceId, status: result.device.status },
  });
    return result;
  });
}

async function createReplacementChallenge(user, metadata) {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const challenge = await db.deviceReplacementChallenge.create({
    data: {
      shopId: user.shopId,
      userId: user.id,
      newDeviceId: metadata.deviceId,
      deviceJson: JSON.stringify(metadata),
      expiresAt,
    },
  });
  const token = jwt.sign(
    { purpose: DEVICE_LIMIT_TOKEN_PURPOSE, challengeId: challenge.id, userId: user.id, shopId: user.shopId },
    env.JWT_SECRET,
    { expiresIn: DEVICE_LIMIT_TOKEN_TTL },
  );
  return { challenge, token };
}

export async function listDevices(shopId, { currentDeviceId = null } = {}) {
  return listSafeDevices(shopId, { currentDeviceId });
}

export async function listSafeDevices(shopId, { currentDeviceId = null } = {}) {
  const rows = await db.device.findMany({
    where: { shopId },
    include: { user: { select: { id: true, name: true, role: true } } },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((device) => serializeDevice(device, currentDeviceId));
}

export async function getDeviceManagementSnapshot(shopId, currentDeviceId = null) {
  const effective = await getEffectivePlan(shopId);
  const deviceLimit = getRuntimeDeviceLimit(effective.limits.maxDevices, effective.subscription);
  const devices = await listSafeDevices(shopId, { currentDeviceId });
  const devicesUsed = devices.filter((device) => deviceStatusOccupiesSlot(device.status)).length;
  return {
    plan: { code: effective.planCode, name: effective.plan?.name ?? effective.planCode, deviceLimit },
    devicesUsed,
    remainingSlots: Math.max(0, deviceLimit - devicesUsed),
    overLimit: devicesUsed > deviceLimit,
    devices,
  };
}

function serializeDevice(device, currentDeviceId = null) {
  const lastSeenAt = device.lastSeenAt ?? device.lastActiveAt ?? device.lastLoginAt ?? device.createdAt;
  const age = Date.now() - new Date(lastSeenAt).getTime();
  const activity = age <= 10 * 60 * 1000 ? "online" : age <= 24 * 60 * 60 * 1000 ? "recent" : "offline";
  return {
    id: device.id,
    deviceId: device.deviceId,
    deviceName: device.deviceName || inferDeviceName(device.userAgent),
    deviceType: device.deviceType || "desktop",
    operatingSystem: device.operatingSystem || null,
    browser: device.browser || null,
    platform: device.platform || null,
    status: normalizeDeviceStatus(device.status),
    isTrusted: Boolean(device.isTrusted),
    registeredAt: device.createdAt,
    lastActiveAt: device.lastActiveAt ?? lastSeenAt,
    lastLoginAt: device.lastLoginAt ?? device.activatedAt ?? null,
    lastSeenAt,
    lastSyncAt: device.lastSyncAt ?? null,
    lastUserName: device.user?.name ?? null,
    lastUserRole: device.user?.role ?? null,
    isCurrentDevice: Boolean(currentDeviceId && device.deviceId === currentDeviceId),
    current: Boolean(currentDeviceId && device.deviceId === currentDeviceId),
    isOnline: activity === "online",
    activity,
  };
}

export async function listActiveDevices(shopId, { currentDeviceId = null } = {}) {
  const devices = await listSafeDevices(shopId, { currentDeviceId });
  return devices
    .filter((device) => deviceStatusOccupiesSlot(device.status))
    .map((device) => ({
      ...device,
      userName: device.lastUserName,
      userRole: device.lastUserRole,
      current: device.isCurrentDevice,
    }));
}

export async function assertDeviceCanOwnLoginSession(shopId, user, deviceId) {
  if (!shopId || !deviceId) return;

  const existing = await db.device.findUnique({ where: { shopId_deviceId: { shopId, deviceId } } });
  const existingStatus = normalizeDeviceStatus(existing?.status);
  if (existingStatus === "blocked") {
    const err = new AppError("Device is blocked", 403);
    err.code = "DEVICE_BLOCKED";
    throw err;
  }

  // A manually removed device should not silently come back for staff in production.
  // Owner/admin can reactivate it, and any device can log in again if its old session
  // was merely logged out and the same browser device id is reused.
  if (existingStatus === "revoked" && env.NODE_ENV === "production" && !["owner", "admin"].includes(user?.role)) {
    const err = new AppError("Removed device reactivation requires owner/admin approval", 403);
    err.code = "DEVICE_REMOVED_REACTIVATION_REQUIRES_OWNER";
    throw err;
  }

  const effective = await getEffectivePlan(shopId);
  const allowedMaxDevices = getRuntimeDeviceLimit(effective.limits.maxDevices, effective.subscription);
  const registeredDeviceCount = await db.device.count({ where: { shopId, status: { in: SLOT_OCCUPYING_STATUSES } } });
  if ((!existing || existingStatus === "revoked") && registeredDeviceCount >= allowedMaxDevices) {
    const activeDevices = await listActiveDevices(shopId, { currentDeviceId: deviceId });
    const message = `Your plan allows only ${allowedMaxDevices} registered devices. Remove an old device to continue.`;
    const err = new AppError(message, 403);
    err.code = "DEVICE_LIMIT_EXCEEDED";
    const publicData = {
      activeDevices,
      plan: {
        code: effective.planCode,
        maxDevices: effective.limits.maxDevices,
        allowedMaxDevices,
      },
    };
    err.meta = {
      activeCount: registeredDeviceCount,
      maxDevices: effective.limits.maxDevices,
      allowedMaxDevices,
      planCode: effective.planCode,
      developmentOverride: isDevelopmentMultiDeviceOverrideEnabled(),
      mode: "registered_devices",
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
    select: { deviceId: true, deviceRecordId: true, deviceSessionVersion: true },
  });
  const sessionDeviceIds = [...new Set(sessions.map((session) => session.deviceId).filter(Boolean))];
  if (!sessionDeviceIds.length) return new Set();

  const inactiveDevices = await db.device.findMany({
    where: {
      shopId,
      deviceId: { in: sessionDeviceIds },
      status: { in: ["blocked", "removed", "revoked", "logged_out"] },
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

  const device = await db.device.findUnique({ where: { shopId_deviceId: { shopId, deviceId } } });
  if (!device || device.status !== "active") {
    throw new AppError("An active registered device is required for this login session.", 403, "DEVICE_SESSION_REQUIRED");
  }

  if (session.deviceId === deviceId) {
    if (session.deviceRecordId !== device.id || session.deviceSessionVersion !== device.sessionVersion) {
      await db.session.update({
        where: { id: sessionId },
        data: { deviceRecordId: device.id, deviceSessionVersion: device.sessionVersion },
      });
    }
    user.deviceId = deviceId;
    user.deviceRecordId = device.id;
    user.sessionVersion = device.sessionVersion;
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
    data: { deviceId, deviceRecordId: device.id, deviceSessionVersion: device.sessionVersion },
  });

  if (result.count !== 1) {
    await assertDeviceHasActiveLoginSession(shopId, user, deviceId);
    return;
  }

  user.deviceId = deviceId;
  user.deviceRecordId = device.id;
  user.sessionVersion = device.sessionVersion;
}

export async function activateDevice(shopId, user, input, req = null) {
  const userId = user?.userId ?? user?.id ?? null;
  const existing = await db.device.findUnique({ where: { shopId_deviceId: { shopId, deviceId: input.deviceId } } });
  const now = new Date();
  const shopState = await db.shop.findUniqueOrThrow({ where: { id: shopId }, select: { dataEpoch: true } });

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
        dataEpoch: shopState.dataEpoch,
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

  if (["removed", "revoked"].includes(normalizeDeviceStatus(existing?.status)) && env.NODE_ENV === "production" && !["owner", "admin"].includes(user?.role)) {
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
          dataEpoch: shopState.dataEpoch,
          removedAt: null,
          revokedAt: null,
          revokedByUserId: null,
          revokeReason: null,
          sessionVersion: { increment: 1 },
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
          dataEpoch: shopState.dataEpoch,
        },
      });

  await bindLoginSessionToDevice(shopId, user, device.deviceId);
  const license = await issueDeviceLicense(shopId, device.deviceId);
  await auditDeviceAction({ shopId, userId, action: "DEVICE_ACTIVATED", entityId: device.id, metadata: { deviceId: device.deviceId, platform: device.platform, planCode: license.payload.planCode }, req });
  return withLicense(device, license);
}

export async function completeDeviceReplacement({ replacementToken, targetDeviceId, ownerPin, reqMeta, sessionData }) {
  const payload = verifyReplacementToken(replacementToken);
  const challenge = await db.deviceReplacementChallenge.findFirst({
    where: {
      id: payload.challengeId,
      shopId: payload.shopId,
      userId: payload.userId,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!challenge) {
    throw new AppError("Device replacement session expired or was already used.", 401, "DEVICE_REPLACEMENT_TOKEN_EXPIRED");
  }

  const user = await db.user.findFirst({
    where: { id: challenge.userId, shopId: challenge.shopId, disabledAt: null },
    include: { shop: true },
  });
  if (!user || !["owner", "admin"].includes(user.role)) {
    throw new AppError("Only the shop owner or an authorized administrator can replace devices.", 403, "DEVICE_ACCESS_DENIED");
  }
  if (!/^\d{4}$/.test(String(ownerPin || ""))) {
    throw new AppError("Enter the 4-digit owner PIN to continue.", 403, "OWNER_VERIFICATION_REQUIRED");
  }
  const owner = await db.user.findFirst({
    where: { shopId: user.shopId, role: "owner", disabledAt: null },
    select: { pinHash: true },
  });
  const ownerVerified = Boolean(owner?.pinHash && await bcrypt.compare(String(ownerPin), owner.pinHash));
  if (!ownerVerified) {
    await auditDeviceAction({
      shopId: user.shopId,
      userId: user.id,
      action: "DEVICE_OWNER_VERIFICATION_FAILED",
      entityId: targetDeviceId,
      metadata: { challengeId: challenge.id },
    });
    throw new AppError("Owner verification failed.", 403, "OWNER_VERIFICATION_FAILED");
  }

  const metadata = parseDeviceMetadata(challenge.deviceJson, challenge.newDeviceId, reqMeta);
  const result = await withProcessShopLock(user.shopId, () => db.$transaction(async (tx) => {
    await acquireShopRegistrationLock(tx, user.shopId);
    const freshChallenge = await tx.deviceReplacementChallenge.findFirst({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!freshChallenge) return { challengeUsed: true };

    const target = await tx.device.findFirst({
      where: { shopId: user.shopId, OR: [{ id: targetDeviceId }, { deviceId: targetDeviceId }] },
    });
    if (!target || !deviceStatusOccupiesSlot(target.status)) return { targetUnavailable: true };
    if (target.deviceId === metadata.deviceId) return { targetIsIncoming: true };

    const effective = await getEffectivePlan(user.shopId, tx);
    const replacementShopState = await tx.shop.findUniqueOrThrow({ where: { id: user.shopId }, select: { dataEpoch: true } });
    const deviceLimit = getRuntimeDeviceLimit(effective.limits.maxDevices, effective.subscription);
    const registeredDeviceCount = await tx.device.count({
      where: { shopId: user.shopId, status: { in: SLOT_OCCUPYING_STATUSES } },
    });
    if (registeredDeviceCount > deviceLimit) return { overLimit: true };

    const now = new Date();
    await tx.device.update({
      where: { id: target.id },
      data: {
        status: "revoked",
        sessionVersion: { increment: 1 },
        revokedAt: now,
        removedAt: now,
        revokedByUserId: user.id,
        revokeReason: "device_replaced_during_login",
      },
    });
    await tx.session.updateMany({
      where: { shopId: user.shopId, OR: [{ deviceRecordId: target.id }, { deviceId: target.deviceId }], revokedAt: null },
      data: { revokedAt: now, revokedReason: "DEVICE_REPLACED" },
    });
    await tx.deviceLicense.updateMany({
      where: { shopId: user.shopId, deviceId: target.deviceId, revokedAt: null },
      data: { revokedAt: now },
    });

    const existingIncoming = await tx.device.findUnique({
      where: { shopId_deviceId: { shopId: user.shopId, deviceId: metadata.deviceId } },
    });
    const incoming = existingIncoming
      ? await tx.device.update({
          where: { id: existingIncoming.id },
          data: {
            userId: user.id,
            deviceName: metadata.deviceName,
            platform: metadata.platform,
            deviceType: metadata.deviceType,
            operatingSystem: metadata.operatingSystem,
            browser: metadata.browser,
            userAgent: metadata.userAgent,
            appVersion: metadata.appVersion,
            lastIpAddress: metadata.ipAddress,
            status: "active",
            sessionVersion: { increment: 1 },
            activatedAt: existingIncoming.activatedAt ?? now,
            lastActiveAt: now,
            lastLoginAt: now,
            lastSeenAt: now,
            dataEpoch: replacementShopState.dataEpoch,
            removedAt: null,
            revokedAt: null,
            revokedByUserId: null,
            revokeReason: null,
          },
        })
      : await tx.device.create({
          data: {
            shopId: user.shopId,
            userId: user.id,
            deviceId: metadata.deviceId,
            deviceName: metadata.deviceName,
            platform: metadata.platform,
            deviceType: metadata.deviceType,
            operatingSystem: metadata.operatingSystem,
            browser: metadata.browser,
            userAgent: metadata.userAgent,
            appVersion: metadata.appVersion,
            lastIpAddress: metadata.ipAddress,
            status: "active",
            activatedAt: now,
            lastActiveAt: now,
            lastLoginAt: now,
            lastSeenAt: now,
            dataEpoch: replacementShopState.dataEpoch,
          },
        });

    const postReplacementCount = await tx.device.count({
      where: { shopId: user.shopId, status: { in: SLOT_OCCUPYING_STATUSES } },
    });
    if (postReplacementCount > deviceLimit) {
      throw new AppError("The shop is still above its device limit. Remove another device first.", 409, "DEVICE_LIMIT_EXCEEDED");
    }

    const consumed = await tx.deviceReplacementChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) return { challengeUsed: true };
    const session = await tx.session.create({
      data: {
        ...sessionData,
        userId: user.id,
        shopId: user.shopId,
        deviceId: incoming.deviceId,
        deviceRecordId: incoming.id,
        deviceSessionVersion: incoming.sessionVersion,
        lastUsedAt: now,
      },
    });
    return { target, incoming, session };
  }));

  if (result.challengeUsed) throw new AppError("This replacement request was already used.", 409, "DEVICE_REPLACEMENT_ALREADY_USED");
  if (result.targetUnavailable) throw new AppError("The selected device is no longer available for replacement.", 409, "DEVICE_NOT_FOUND");
  if (result.targetIsIncoming) throw new AppError("Select a different registered device.", 400, "DEVICE_REPLACEMENT_TARGET_INVALID");
  if (result.overLimit) throw new AppError("The shop is still above its device limit. Remove another device first.", 409, "DEVICE_LIMIT_EXCEEDED");

  await auditDeviceAction({
    shopId: user.shopId,
    userId: user.id,
    action: "DEVICE_REPLACED",
    entityId: result.target.id,
    metadata: { removedDeviceId: result.target.deviceId, newDeviceId: result.incoming.deviceId },
  });
  return { user, shop: user.shop, device: result.incoming, session: result.session, removedDeviceName: result.target.deviceName };
}

function parseDeviceMetadata(deviceJson, fallbackDeviceId, reqMeta) {
  try {
    return normalizeDeviceMetadata({ ...reqMeta, device: { ...JSON.parse(deviceJson || "{}"), deviceId: fallbackDeviceId } });
  } catch {
    return normalizeDeviceMetadata({ ...reqMeta, device: { deviceId: fallbackDeviceId } });
  }
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
  const revokedAt = new Date();
  const lifecycle = await withDeviceLifecycleTransaction(shopId, async (tx) => {
    const activeSessions = await tx.session.findMany({
      where: {
        shopId,
        deviceId: targetDeviceId,
        revokedAt: null,
        expiresAt: { gt: revokedAt },
        ...(canManageShopDevices ? {} : { userId: actorUserId }),
      },
      select: { id: true },
    });
    if (activeSessions.length === 0) return null;

    const revoked = await tx.session.updateMany({
      where: { id: { in: activeSessions.map((session) => session.id) } },
      data: { revokedAt, revokedReason: reason },
    });
    const devices = await tx.device.updateMany({
      where: { shopId, deviceId: targetDeviceId, status: { not: "revoked" } },
      data: {
        status: "logged_out",
        sessionVersion: { increment: 1 },
        lastActiveAt: revokedAt,
        lastSeenAt: revokedAt,
      },
    });
    return { revokedSessions: revoked.count, updatedDevices: devices.count };
  });

  if (!lifecycle) {
    const err = new AppError("No active session found for this device", 404);
    err.code = "ACTIVE_DEVICE_SESSION_NOT_FOUND";
    throw err;
  }

  await auditDeviceAction({
    shopId,
    userId: actorUserId,
    action: "DEVICE_SESSION_REVOKED",
    entityId: targetDeviceId,
    metadata: {
      deviceId: targetDeviceId,
      revokedSessions: lifecycle.revokedSessions,
      reason,
      managedShopDevices: canManageShopDevices,
    },
    req,
  });

  return {
    success: true,
    deviceId: targetDeviceId,
    revokedSessions: lifecycle.revokedSessions,
    activeDevices: await listActiveDevices(shopId, { currentDeviceId }),
  };
}

export async function removeDevice(shopId, deviceId, userId = null, req = null, { allowCurrentDevice = false } = {}) {
  const device = await findDevice(shopId, deviceId);
  const currentDeviceId = cleanText(req?.headers?.["x-device-id"], 128) || cleanText(req?.user?.deviceId, 128);
  const removingCurrentDevice = Boolean(currentDeviceId && currentDeviceId === device.deviceId);
  if (removingCurrentDevice && !allowCurrentDevice) {
    throw new AppError("Use Log out and remove this device for the device you are currently using.", 400, "CURRENT_DEVICE_REMOVE_REQUIRES_LOGOUT");
  }
  const removedAt = new Date();
  const updated = await db.$transaction(async (tx) => {
    const revoked = await tx.device.update({
      where: { id: device.id },
      data: {
        status: "revoked",
        sessionVersion: { increment: 1 },
        removedAt,
        revokedAt: removedAt,
        revokedByUserId: userId,
        revokeReason: "owner_removed_device",
      },
    });
    await tx.session.updateMany({
      where: { shopId, OR: [{ deviceRecordId: device.id }, { deviceId: device.deviceId }], revokedAt: null },
      data: { revokedAt: removedAt, revokedReason: "DEVICE_REMOVED" },
    });
    return revoked;
  });
  await revokeDeviceLicense(shopId, device.deviceId, "device_removed");
  await auditDeviceAction({ shopId, userId, action: "DEVICE_REMOVED", entityId: device.id, metadata: { deviceId: device.deviceId }, req });
  return {
    ...serializeDevice(updated, currentDeviceId),
    removedCurrentDevice: removingCurrentDevice,
  };
}

export async function blockDevice(shopId, deviceId, userId = null, req = null) {
  const device = await findDevice(shopId, deviceId);
  const now = new Date();
  const updated = await db.$transaction(async (tx) => {
    const blocked = await tx.device.update({
      where: { id: device.id },
      data: { status: "blocked", sessionVersion: { increment: 1 }, revokedByUserId: userId, revokeReason: "owner_blocked_device" },
    });
    await tx.session.updateMany({
      where: { shopId, OR: [{ deviceRecordId: device.id }, { deviceId: device.deviceId }], revokedAt: null },
      data: { revokedAt: now, revokedReason: "DEVICE_BLOCKED" },
    });
    return blocked;
  });
  await revokeDeviceLicense(shopId, device.deviceId, "device_blocked");
  await auditDeviceAction({ shopId, userId, action: "DEVICE_BLOCKED", entityId: device.id, metadata: { deviceId: device.deviceId }, req });
  return serializeDevice(updated, req?.headers?.["x-device-id"] ?? null);
}

export async function unblockDevice(shopId, deviceId, userId = null, req = null) {
  const device = await findDevice(shopId, deviceId);
  if (device.status !== "blocked") return serializeDevice(device, req?.headers?.["x-device-id"] ?? null);
  const updated = await db.device.update({
    where: { id: device.id },
    data: { status: "logged_out", sessionVersion: { increment: 1 }, revokedAt: null, removedAt: null, revokedByUserId: null, revokeReason: "device_reactivated_requires_login" },
  });
  await auditDeviceAction({ shopId, userId, action: "DEVICE_REACTIVATED", entityId: device.id, metadata: { deviceId: device.deviceId, nextStatus: "logged_out" }, req });
  return serializeDevice(updated, req?.headers?.["x-device-id"] ?? null);
}

export async function renameDevice(shopId, deviceId, deviceName, userId = null, req = null) {
  const device = await findDevice(shopId, deviceId);
  const updated = await db.device.update({ where: { id: device.id }, data: { deviceName: cleanText(deviceName, 120) } });
  await auditDeviceAction({ shopId, userId, action: "DEVICE_RENAMED", entityId: device.id, metadata: { deviceId: device.deviceId }, req });
  return serializeDevice(updated, req?.headers?.["x-device-id"] ?? null);
}

export async function getCurrentDevice(shopId, deviceId) {
  const device = await findDevice(shopId, deviceId);
  return serializeDevice(device, deviceId);
}

export async function heartbeat(shopId, deviceId) {
  const device = await findDevice(shopId, deviceId);
  if (["removed", "revoked"].includes(device.status)) {
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
  const now = new Date();
  const updated = await db.device.update({ where: { id: device.id }, data: { lastActiveAt: now, lastSeenAt: now } });
  return serializeDevice(updated, deviceId);
}

export async function markDeviceSynced(shopId, deviceId) {
  if (!shopId || !deviceId) return;
  const now = new Date();
  await db.device.updateMany({
    where: { shopId, deviceId, status: "active" },
    data: { lastSyncAt: now, lastSeenAt: now, lastActiveAt: now },
  });
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
  const device = await db.device.findFirst({ where: { shopId, OR: [{ id: deviceId }, { deviceId }] } });
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

function verifyReplacementToken(token) {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (payload?.purpose !== DEVICE_LIMIT_TOKEN_PURPOSE || !payload.shopId || !payload.userId || !payload.challengeId) {
      throw new Error("invalid purpose");
    }
    return payload;
  } catch {
    throw new AppError("Device replacement session expired. Please sign in again.", 401, "DEVICE_REPLACEMENT_TOKEN_EXPIRED");
  }
}
