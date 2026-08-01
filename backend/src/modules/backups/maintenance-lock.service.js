import crypto from "node:crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";

const DEFAULT_LOCK_MS = 15 * 60 * 1000;
const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");

export async function acquireShopMaintenanceLock(shopId, userId, reason = "backup_restore", { database = db, ttlMs = DEFAULT_LOCK_MS } = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(60_000, Math.min(ttlMs, 60 * 60 * 1000)));
  const data = { tokenHash: hash(token), reason: String(reason).slice(0, 100), lockedByUserId: userId ?? null, expiresAt };
  try {
    const replaced = await database.shopMaintenanceLock.updateMany({ where: { shopId, expiresAt: { lte: now } }, data });
    if (replaced.count === 0) await database.shopMaintenanceLock.create({ data: { shopId, ...data } });
  } catch (error) {
    if (error?.code === "P2002") throw new AppError("Shop maintenance is already in progress", 423, "SHOP_MAINTENANCE_LOCKED");
    throw error;
  }
  return { token, expiresAt };
}

export async function releaseShopMaintenanceLock(shopId, token, { database = db } = {}) {
  if (!token) return false;
  const result = await database.shopMaintenanceLock.deleteMany({ where: { shopId, tokenHash: hash(token) } });
  return result.count === 1;
}

export async function getActiveShopMaintenanceLock(shopId, { database = db, now = new Date() } = {}) {
  const lock = await database.shopMaintenanceLock.findFirst({ where: { shopId, expiresAt: { gt: now } }, select: { reason: true, expiresAt: true } });
  return lock ?? null;
}

export const __maintenanceLockInternals = { DEFAULT_LOCK_MS, hash };
