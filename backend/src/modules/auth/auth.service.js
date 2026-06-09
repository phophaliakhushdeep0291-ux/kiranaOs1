import bcrypt from "bcryptjs";
import crypto from "crypto";
import db from "../../db.js";
import { signToken } from "../../middleware/auth.js";
import { AppError } from "../../middleware/error.js";
import { canAddStaff, requireFeatureAccess } from "../feature-gates/featureGate.service.js";
import { createAuditLog } from "../audit/audit.service.js";

const REFRESH_TOKEN_BYTES = 48;
const REFRESH_TOKEN_TTL_DAYS = 30;

export async function registerShop({ shopName, ownerName, city, address, mobile, password, ownerPin, gstNumber, phone }, reqMeta = {}) {
  // Mobile numbers are unique per shop, not globally. The same owner/staff mobile
  // may legitimately exist in multiple shop tenants; login handles that safely.
  const passwordHash = await bcrypt.hash(password, 10);
  const pinHash = ownerPin ? await bcrypt.hash(ownerPin, 10) : null;

  const result = await db.$transaction(async (tx) => {
    const shop = await tx.shop.create({
      data: { name: shopName, ownerName, city, address, gstNumber, phone },
    });
    const user = await tx.user.create({
      data: { shopId: shop.id, name: ownerName, mobile, passwordHash, pinHash, role: "owner" },
    });
    return { shop, user };
  });

  return issueAuthResponse(result.user, result.shop, reqMeta);
}

export async function login({ mobile, password, shopId }, reqMeta = {}) {
  const users = await db.user.findMany({
    where: {
      mobile,
      disabledAt: null,
      ...(shopId ? { shopId } : {}),
    },
    include: { shop: true },
    orderBy: { createdAt: "asc" },
  });

  if (users.length === 0) throw new AppError("Invalid credentials", 401);

  if (!shopId && users.length > 1) {
    const err = new AppError("Multiple shops found for this mobile. Please select a shop to continue.", 409);
    err.code = "SHOP_SELECTION_REQUIRED";
    err.meta = {
      shops: users.map((u) => ({ id: u.shop.id, name: u.shop.name, city: u.shop.city })),
    };
    throw err;
  }

  const user = users[0];
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new AppError("Invalid credentials", 401);

  return issueAuthResponse(user, user.shop, reqMeta);
}

export async function refreshSession(refreshToken, reqMeta = {}) {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) throw new AppError("Invalid refresh token", 401);

  const session = await db.session.findFirst({
    where: {
      id: parsed.sessionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: { include: { shop: true } } },
  });

  if (!session) throw new AppError("Invalid or expired refresh token", 401);
  if (session.user?.disabledAt) {
    await revokeSession(session.id, "USER_DISABLED");
    const err = new AppError("User account is disabled", 401);
    err.code = "USER_DISABLED";
    throw err;
  }

  const ok = await bcrypt.compare(parsed.secret, session.refreshTokenHash);
  if (!ok) {
    // A refresh token for this session id was presented but the secret no longer
    // matches. That usually means a rotated refresh token was reused. Revoke the
    // session to avoid silently allowing token replay races.
    await revokeSession(session.id, "REFRESH_TOKEN_REUSE_DETECTED");
    const err = new AppError("Refresh token reuse detected", 401);
    err.code = "REFRESH_TOKEN_REUSE_DETECTED";
    throw err;
  }

  const nextSecret = createRefreshSecret();
  const nextRefreshToken = formatRefreshToken(session.id, nextSecret);
  const refreshTokenHash = await bcrypt.hash(nextSecret, 10);

  await db.session.update({
    where: { id: session.id },
    data: {
      refreshTokenHash,
      userAgent: reqMeta.userAgent ?? session.userAgent,
      ipAddress: reqMeta.ipAddress ?? session.ipAddress,
      expiresAt: refreshExpiryDate(),
    },
  });

  const accessToken = signToken({
    userId: session.user.id,
    shopId: session.shopId,
    role: session.user.role,
  });

  return {
    accessToken,
    token: accessToken,
    refreshToken: nextRefreshToken,
    user: sanitizeUser(session.user),
    shop: session.user.shop,
  };
}

export async function logout(refreshToken, user = null) {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return { success: true, message: "Logged out" };

  const where = { id: parsed.sessionId };
  const session = await db.session.findFirst({ where });

  if (!session || session.revokedAt) {
    return { success: true, message: "Logged out" };
  }

  if (user?.userId && session.userId !== user.userId) {
    throw new AppError("Invalid refresh token", 401);
  }

  const ok = await bcrypt.compare(parsed.secret, session.refreshTokenHash);
  if (!ok) throw new AppError("Invalid refresh token", 401);

  await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: "LOGOUT" } });
  return { success: true, message: "Logged out" };
}

export async function getMe(userId, shopId) {
  const user = await db.user.findFirst({ where: { id: userId, shopId, disabledAt: null }, include: { shop: true } });
  if (!user) throw new AppError("User not found", 404);

  return {
    user: sanitizeUser(user),
    shop: user.shop,
  };
}

// ── PIN management ──────────────────────────────────────────

export async function setPin(userId, shopId, pin) {
  const user = await db.user.findFirst({ where: { id: userId, shopId, disabledAt: null } });
  if (!user) throw new AppError("User not found", 404);
  if (user.role !== "owner") throw new AppError("Only owner can set a PIN", 403);

  const pinHash = await bcrypt.hash(pin, 10);
  await db.user.update({ where: { id: userId }, data: { pinHash } });
  return { success: true, message: "PIN set successfully" };
}

export async function verifyPin(shopId, pin) {
  // Find the owner for this shop
  const owner = await db.user.findFirst({ where: { shopId, role: "owner", disabledAt: null } });
  if (!owner) throw new AppError("Owner not found", 404);
  if (!owner.pinHash) throw new AppError("Owner PIN not set yet", 400);

  const ok = await bcrypt.compare(pin, owner.pinHash);
  if (!ok) throw new AppError("Wrong PIN", 403);
  return { valid: true };
}

export async function hasPin(shopId) {
  const owner = await db.user.findFirst({ where: { shopId, role: "owner", disabledAt: null }, select: { pinHash: true } });
  return { hasPin: !!owner?.pinHash };
}

// ── Staff management ────────────────────────────────────────

export async function listStaff(shopId) {
  const users = await db.user.findMany({
    where: { shopId, disabledAt: null },
    select: { id: true, name: true, mobile: true, email: true, role: true, disabledAt: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
  });
  return users;
}

export async function inviteStaff(shopId, { name, mobile, password, role = "staff" }) {
  await requireFeatureAccess(shopId, "staff_login");
  if (role === "owner") {
    const err = new AppError("Owner role cannot be invited through staff management", 400);
    err.code = "OWNER_ROLE_NOT_INVITABLE";
    throw err;
  }

  const limit = await canAddStaff(shopId);
  if (!limit.allowed) {
    const err = new AppError("Staff limit exceeded for current plan", 403);
    err.code = "STAFF_LIMIT_EXCEEDED";
    err.meta = limit;
    throw err;
  }

  const existing = await db.user.findFirst({ where: { shopId, mobile, disabledAt: null } });
  if (existing) throw new AppError("A user with this mobile already exists in your shop", 409);

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.user.create({
    data: { shopId, name, mobile, passwordHash, role },
  });
  return sanitizeUser(user);
}

export async function updateStaffRole(shopId, staffId, role) {
  await requireFeatureAccess(shopId, "role_based_access");
  if (role === "owner") {
    const err = new AppError("Owner role changes require a separate owner-transfer flow", 400);
    err.code = "OWNER_ROLE_TRANSFER_REQUIRED";
    throw err;
  }

  const user = await db.user.findFirst({ where: { id: staffId, shopId, disabledAt: null } });
  if (!user) throw new AppError("Staff member not found", 404);
  if (user.role === "owner") throw new AppError("Owner role cannot be changed from staff management", 403);

  return sanitizeUser(
    await db.user.update({ where: { id: staffId }, data: { role } })
  );
}

export async function removeStaff(shopId, staffId, requestingUserId, reqMeta = {}) {
  const user = await db.user.findFirst({ where: { id: staffId, shopId, disabledAt: null } });
  if (!user) throw new AppError("Staff member not found", 404);
  if (user.id === requestingUserId) throw new AppError("Cannot remove yourself", 400);
  if (user.role === "owner") throw new AppError("Cannot remove the owner", 403);

  const disabledAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.session.updateMany({
      where: { userId: staffId, shopId, revokedAt: null },
      data: { revokedAt: disabledAt, revokedReason: "STAFF_DISABLED" },
    });
    await tx.user.update({
      where: { id: staffId },
      data: {
        disabledAt,
        // Free mobile/email unique slots so the shop can invite the same person
        // again later without breaking historical audit references to userId.
        mobile: null,
        email: null,
      },
    });
  });

  await createAuditLog({
    shopId,
    userId: requestingUserId,
    action: "STAFF_DISABLED",
    entityType: "User",
    entityId: staffId,
    metadata: { removedRole: user.role, removedAt: disabledAt.toISOString() },
    req: reqMeta.req,
  });

  return { success: true, disabledAt };
}

export async function changePassword(userId, shopId, { currentPassword, newPassword }) {
  const user = await db.user.findFirst({ where: { id: userId, shopId, disabledAt: null } });
  if (!user) throw new AppError("User not found", 404);

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw new AppError("Current password is incorrect", 401);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.session.updateMany({
      where: { userId, shopId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "PASSWORD_CHANGED" },
    });
  });
  return { success: true, sessionsRevoked: true };
}

// ── Helpers ─────────────────────────────────────────────────

async function issueAuthResponse(user, shop, reqMeta = {}) {
  const accessToken = signToken({ userId: user.id, shopId: user.shopId, role: user.role });
  const refreshSecret = createRefreshSecret();
  const refreshTokenHash = await bcrypt.hash(refreshSecret, 10);
  const session = await db.session.create({
    data: {
      userId: user.id,
      shopId: user.shopId,
      refreshTokenHash,
      userAgent: reqMeta.userAgent,
      ipAddress: reqMeta.ipAddress,
      expiresAt: refreshExpiryDate(),
    },
  });

  return {
    accessToken,
    token: accessToken, // Backward compatibility for existing frontend/API clients.
    refreshToken: formatRefreshToken(session.id, refreshSecret),
    shop,
    user: sanitizeUser(user),
  };
}

function createRefreshSecret() {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
}

function formatRefreshToken(sessionId, secret) {
  return `${sessionId}.${secret}`;
}

async function revokeSession(sessionId, reason) {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

function parseRefreshToken(refreshToken) {
  if (!refreshToken || typeof refreshToken !== "string") return null;
  const [sessionId, ...secretParts] = refreshToken.split(".");
  const secret = secretParts.join(".");
  if (!sessionId || !secret) return null;
  return { sessionId, secret };
}

function refreshExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);
  return expiresAt;
}

function sanitizeUser(user) {
  const { passwordHash, pinHash, shop, sessions, ...safe } = user;
  return safe;
}
