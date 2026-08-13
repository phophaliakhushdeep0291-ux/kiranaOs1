import crypto from "crypto";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { getEffectivePlan } from "../subscription/subscription.service.js";
import { DEFAULT_GRACE_DAYS } from "../subscription/planConfig.js";

export const LICENSE_VERSION = 1;
export const LICENSE_ALGORITHM = "HMAC-SHA256";

export async function buildLicensePayload(shopId, deviceId, client = db) {
  const device = await getActiveLicenseDevice(shopId, deviceId, client);
  const effective = await getEffectivePlan(shopId, client);
  const issuedAt = new Date();
  const subscription = effective.subscription || {};
  const subscriptionStatus = subscription.status || "trial";
  const currentPeriodEnd = asDate(subscription.currentPeriodEnd || subscription.trialEndsAt);
  const graceEndsAt = asDate(subscription.graceEndsAt);
  const validUntil = calculateValidUntil(subscriptionStatus, currentPeriodEnd, issuedAt);
  const offlineGraceUntil = calculateOfflineGraceUntil(subscriptionStatus, currentPeriodEnd, graceEndsAt, issuedAt);
  const warnings = licenseWarnings(subscriptionStatus, validUntil, offlineGraceUntil, effective.limits.maxDevices);

  return {
    shopId,
    deviceId: device.deviceId,
    planCode: effective.planCode,
    features: [...effective.features].sort(),
    maxDevices: effective.limits.maxDevices,
    maxStores: effective.limits.maxStores,
    maxStaff: effective.limits.maxStaff,
    subscriptionStatus,
    validUntil: validUntil.toISOString(),
    offlineGraceUntil: offlineGraceUntil.toISOString(),
    issuedAt: issuedAt.toISOString(),
    licenseVersion: LICENSE_VERSION,
    warnings,
  };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function signLicensePayload(payload, secret = env.LICENSE_SIGNING_SECRET) {
  if (!secret) {
    if (env.NODE_ENV === "production") {
      const err = new AppError("LICENSE_SIGNING_SECRET is required in production", 500);
      err.code = "LICENSE_SIGNING_SECRET_REQUIRED";
      throw err;
    }
    return null;
  }
  return crypto.createHmac("sha256", secret).update(canonicalJson(payload)).digest("hex");
}

export function verifyLicenseSignature(payload, signature, secret = env.LICENSE_SIGNING_SECRET) {
  if (!secret || !signature) return false;
  const expected = signLicensePayload(payload, secret);
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(String(signature), "hex");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function issueDeviceLicense(shopId, deviceId, client = db) {
  const payload = await buildLicensePayload(shopId, deviceId, client);
  const signature = signLicensePayload(payload);
  const signatureHash = signature ? hashSignature(signature) : null;
  const validUntil = new Date(payload.validUntil);
  const offlineGraceUntil = new Date(payload.offlineGraceUntil);

  await client.deviceLicense.create({
    data: {
      shopId,
      deviceId,
      planCode: payload.planCode,
      featuresJson: JSON.stringify(payload.features),
      validUntil,
      offlineGraceUntil,
      signatureHash,
      issuedAt: new Date(payload.issuedAt),
    },
  });

  return {
    payload,
    signature,
    algorithm: LICENSE_ALGORITHM,
    productionSafe: Boolean(signature),
    signing: signature ? LICENSE_ALGORITHM : "unsigned-development-only",
    // Backward-compatible top-level fields for Phase 6 clients/tests.
    ...payload,
  };
}

export async function refreshDeviceLicense(shopId, deviceId, client = db) {
  return issueDeviceLicense(shopId, deviceId, client);
}

export async function getCurrentDeviceLicense(shopId, deviceId) {
  return db.deviceLicense.findFirst({
    where: { shopId, deviceId, revokedAt: null },
    orderBy: { issuedAt: "desc" },
  });
}

export async function revokeDeviceLicense(shopId, deviceId, reason = "device_revoked", client = db) {
  const now = new Date();
  await client.deviceLicense.updateMany({
    where: { shopId, deviceId, revokedAt: null },
    data: { revokedAt: now },
  });
  return { revokedAt: now, reason };
}

async function getActiveLicenseDevice(shopId, deviceId, client = db) {
  if (!deviceId) {
    const err = new AppError("Device id is required", 400);
    err.code = "DEVICE_REQUIRED";
    throw err;
  }
  const device = await client.device.findUnique({ where: { shopId_deviceId: { shopId, deviceId } } });
  if (!device) {
    const err = new AppError("Device not found", 404);
    err.code = "DEVICE_NOT_FOUND";
    throw err;
  }
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
  return device;
}

function calculateValidUntil(status, currentPeriodEnd, now) {
  if (status === "expired" || status === "cancelled" || status === "payment_failed") return currentPeriodEnd || now;
  if (status === "grace") return currentPeriodEnd && currentPeriodEnd > now ? currentPeriodEnd : now;
  return currentPeriodEnd && currentPeriodEnd > now ? currentPeriodEnd : now;
}

function calculateOfflineGraceUntil(status, currentPeriodEnd, graceEndsAt, now) {
  if (graceEndsAt) return graceEndsAt;
  if (currentPeriodEnd) return addDays(currentPeriodEnd, DEFAULT_GRACE_DAYS);
  if (status === "expired" || status === "cancelled" || status === "payment_failed") return now;
  return addDays(now, DEFAULT_GRACE_DAYS);
}

function licenseWarnings(status, validUntil, offlineGraceUntil, maxDevices) {
  const warnings = [];
  if (status === "grace") warnings.push("SUBSCRIPTION_IN_GRACE");
  if (["expired", "cancelled", "payment_failed"].includes(status)) warnings.push("SUBSCRIPTION_RESTRICTED");
  if (offlineGraceUntil <= new Date()) warnings.push("OFFLINE_GRACE_EXPIRED");
  if (validUntil <= new Date()) warnings.push("LICENSE_VALIDITY_EXPIRED");
  if (maxDevices <= 0) warnings.push("NO_ACTIVE_DEVICE_SLOTS");
  return warnings;
}

function hashSignature(signature) {
  return crypto.createHash("sha256").update(String(signature)).digest("hex");
}

function asDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
