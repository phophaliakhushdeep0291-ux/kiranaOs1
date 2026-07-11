import bcrypt from "bcryptjs";
import crypto from "crypto";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { signToken } from "../../middleware/auth.js";
import { AppError } from "../../middleware/error.js";
import { canAddStaff, requireFeatureAccess } from "../feature-gates/featureGate.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { assertDeviceCanOwnLoginSession } from "../devices/devices.service.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../../lib/authEmail.js";
import { verifyGoogleIdToken } from "./google.service.js";

const REFRESH_TOKEN_BYTES = 48;
const REFRESH_TOKEN_TTL_DAYS = 30;
const AUTH_TOKEN_BYTES = 32;
const EMAIL_VERIFICATION_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_MINUTES = 30;

export async function registerShop({ shopName, ownerName, city, address, mobile, email, password, ownerPin, gstNumber, phone }, reqMeta = {}) {
  // Mobile numbers are unique per shop, not globally. The same owner/staff mobile
  // may legitimately exist in multiple shop tenants; login handles that safely.
  const passwordHash = await bcrypt.hash(password, 10);
  const pinHash = ownerPin ? await bcrypt.hash(ownerPin, 10) : null;
  const normalizedEmail = normalizeEmail(email);

  const result = await db.$transaction(async (tx) => {
    const shop = await tx.shop.create({
      data: { name: shopName, ownerName, city, address, gstNumber, phone },
    });
    const user = await tx.user.create({
      data: { shopId: shop.id, name: ownerName, mobile, email: normalizedEmail, passwordHash, pinHash, role: "owner" },
    });
    return { shop, user };
  });

  let emailVerification = null;
  if (normalizedEmail) {
    emailVerification = await createAndSendAuthToken({
      user: result.user,
      shop: result.shop,
      type: "email_verification",
      ttlMs: EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
    });
  }

  const auth = await issueAuthResponse(result.user, result.shop, reqMeta);
  return { ...auth, emailVerification };
}

export async function login({ mobile, email, identifier, password, shopId }, reqMeta = {}) {
  const loginId = normalizeLoginIdentifier({ mobile, email, identifier });
  if (!loginId) throw new AppError("Mobile number or email is required", 400, "LOGIN_IDENTIFIER_REQUIRED");

  const users = await db.user.findMany({
    where: {
      [loginId.kind]: loginId.value,
      disabledAt: null,
      ...(shopId ? { shopId } : {}),
    },
    include: { shop: true },
    orderBy: { createdAt: "asc" },
  });

  if (users.length === 0) throw new AppError("Invalid credentials", 401);

  const passwordMatches = await Promise.all(
    users.map((user) => bcrypt.compare(password, user.passwordHash))
  );
  const matchingUsers = users.filter((_, index) => passwordMatches[index]);

  if (matchingUsers.length === 0) throw new AppError("Invalid credentials", 401);

  if (!shopId && matchingUsers.length > 1) {
    const err = new AppError("Multiple shops found for this mobile. Please select a shop to continue.", 409);
    err.code = "SHOP_SELECTION_REQUIRED";
    err.publicData = {
      shops: matchingUsers.map((u) => ({ id: u.shop.id, name: u.shop.name, city: u.shop.city })),
    };
    throw err;
  }

  const user = matchingUsers[0];

  return issueAuthResponse(user, user.shop, reqMeta);
}

/**
 * Google sign-in. The token is verified against Google's certs (audience = our
 * client id, verified email required). Accounts match by previously linked
 * googleSub first, else by verified email — the first Google sign-in on an
 * email/password account links it permanently. Brand-new Google users are told
 * to register (the normal form, prefilled client-side), so every account keeps
 * a password and stays usable when Google is unreachable. Multi-shop emails get
 * the same SHOP_SELECTION_REQUIRED retry contract as password login.
 */
export async function googleLogin({ credential, shopId }, reqMeta = {}) {
  const identity = await verifyGoogleIdToken(credential);

  const users = await db.user.findMany({
    where: {
      disabledAt: null,
      OR: [{ googleSub: identity.sub }, { email: identity.email }],
      ...(shopId ? { shopId } : {}),
    },
    include: { shop: true },
    orderBy: { createdAt: "asc" },
  });

  // A user whose email matches but is already linked to a DIFFERENT Google
  // account must not be reachable through this token.
  const linked = users.filter((u) => u.googleSub === identity.sub);
  const candidates = linked.length > 0 ? linked : users.filter((u) => !u.googleSub);

  if (candidates.length === 0) {
    const err = new AppError("No shop account uses this Google account yet. Create your shop first.", 404);
    err.code = "GOOGLE_ACCOUNT_NOT_REGISTERED";
    err.publicData = { email: identity.email, name: identity.name };
    throw err;
  }

  if (!shopId && candidates.length > 1) {
    const err = new AppError("Multiple shops found for this Google account. Please select a shop to continue.", 409);
    err.code = "SHOP_SELECTION_REQUIRED";
    err.publicData = {
      shops: candidates.map((u) => ({ id: u.shop.id, name: u.shop.name, city: u.shop.city })),
    };
    throw err;
  }

  let user = candidates[0];
  if (user.googleSub !== identity.sub || !user.emailVerifiedAt) {
    const updatedUser = await db.user.update({
      where: { id: user.id },
      data: {
        googleSub: identity.sub,
        // Google already verified this email — no need to make them click our mail too.
        ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }),
      },
    });
    user = { ...user, ...updatedUser };
  }

  return issueAuthResponse(user, user.shop, reqMeta);
}

export async function verifyEmail(token) {
  const authToken = await consumeAuthToken(token, "email_verification");
  await db.user.update({
    where: { id: authToken.userId },
    data: { emailVerifiedAt: new Date() },
  });
  return { success: true, message: "Email verified successfully" };
}

export async function resendEmailVerification(input) {
  const user = await findUserForAccountEmail(input);
  if (user?.email && !user.emailVerifiedAt) {
    await createAndSendAuthToken({
      user,
      shop: user.shop,
      type: "email_verification",
      ttlMs: EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
    });
  }
  return genericEmailSecurityResponse();
}

export async function requestPasswordReset(input) {
  const user = await findUserForAccountEmail(input);
  if (user?.email) {
    await createAndSendAuthToken({
      user,
      shop: user.shop,
      type: "password_reset",
      ttlMs: PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
    });
  }
  return genericEmailSecurityResponse();
}

export async function resetPassword({ token, newPassword }) {
  const authToken = await consumeAuthToken(token, "password_reset");
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: authToken.userId }, data: { passwordHash } });
    await tx.session.updateMany({
      where: { userId: authToken.userId, shopId: authToken.shopId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "PASSWORD_RESET" },
    });
  });
  return { success: true, sessionsRevoked: true };
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
  const nextDeviceId = normalizeDeviceId(reqMeta.deviceId) ?? session.deviceId ?? null;
  if (nextDeviceId && nextDeviceId !== session.deviceId) {
    if (session.deviceId) {
      const err = new AppError("This login session belongs to another device", 403);
      err.code = "SESSION_DEVICE_MISMATCH";
      throw err;
    }
    await assertDeviceCanOwnLoginSession(session.shopId, session.user, nextDeviceId);
  }

  await db.session.update({
    where: { id: session.id },
    data: {
      deviceId: nextDeviceId,
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
    sessionId: session.id,
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

  const revokedAt = new Date();
  const result = session.deviceId
    ? await db.session.updateMany({
        where: {
          userId: session.userId,
          shopId: session.shopId,
          deviceId: session.deviceId,
          revokedAt: null,
        },
        data: { revokedAt, revokedReason: "LOGOUT" },
      })
    : await db.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt, revokedReason: "LOGOUT" },
      });
  return { success: true, message: "Logged out", revokedSessions: result.count };
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
  const deviceId = normalizeDeviceId(reqMeta.deviceId);
  // Fail closed in production: without a device id the per-plan device cap can't be
  // enforced (a null-device session isn't counted), so a client could bypass the limit
  // simply by omitting the header. The app always sends x-device-id, so requiring it in
  // production only blocks unsupported/bypassing clients. Dev/test stay lenient.
  if (!deviceId && env.NODE_ENV === "production") {
    throw new AppError("A device id is required to sign in. Please reload the app and try again.", 400, "DEVICE_ID_REQUIRED");
  }
  if (deviceId) {
    await assertDeviceCanOwnLoginSession(user.shopId, user, deviceId);
  }

  const refreshSecret = createRefreshSecret();
  const refreshTokenHash = await bcrypt.hash(refreshSecret, 10);
  const session = await db.session.create({
    data: {
      userId: user.id,
      shopId: user.shopId,
      deviceId,
      refreshTokenHash,
      userAgent: reqMeta.userAgent,
      ipAddress: reqMeta.ipAddress,
      expiresAt: refreshExpiryDate(),
    },
  });
  const accessToken = signToken({ userId: user.id, shopId: user.shopId, role: user.role, sessionId: session.id });

  return {
    accessToken,
    token: accessToken, // Backward compatibility for existing frontend/API clients.
    refreshToken: formatRefreshToken(session.id, refreshSecret),
    shop,
    user: sanitizeUser(user),
  };
}

function normalizeDeviceId(deviceId) {
  return typeof deviceId === "string" && deviceId.trim() ? deviceId.trim() : null;
}

function normalizeEmail(email) {
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
}

function normalizeLoginIdentifier({ mobile, email, identifier }) {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) return { kind: "email", value: normalizedEmail };
  if (typeof mobile === "string" && mobile.trim()) return { kind: "mobile", value: mobile.trim() };
  if (typeof identifier !== "string" || !identifier.trim()) return null;
  const raw = identifier.trim();
  if (raw.includes("@")) return { kind: "email", value: raw.toLowerCase() };
  const normalizedMobile = raw.replace(/[\s\-()]/g, "").replace(/^\+91/, "").replace(/^91(?=\d{10}$)/, "");
  if (/^[6-9]\d{9}$/.test(normalizedMobile)) return { kind: "mobile", value: normalizedMobile };
  return null;
}

async function findUserForAccountEmail(input = {}) {
  const loginId = normalizeLoginIdentifier(input);
  if (!loginId) return null;
  const users = await db.user.findMany({
    where: {
      [loginId.kind]: loginId.value,
      disabledAt: null,
      ...(input.shopId ? { shopId: input.shopId } : {}),
    },
    include: { shop: true },
    orderBy: { createdAt: "asc" },
  });
  if (users.length !== 1) return null;
  return users[0];
}

async function createAndSendAuthToken({ user, shop, type, ttlMs }) {
  if (!user.email) return { sent: false, reason: "missing_email" };
  const rawToken = crypto.randomBytes(AUTH_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashAuthToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.$transaction(async (tx) => {
    await tx.authToken.updateMany({
      where: { userId: user.id, type, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.authToken.create({
      data: {
        userId: user.id,
        shopId: shop.id,
        type,
        tokenHash,
        sentToEmail: user.email,
        expiresAt,
      },
    });
  });

  const emailResult = type === "password_reset"
    ? await sendPasswordResetEmail({ to: user.email, name: user.name, token: rawToken })
    : await sendVerificationEmail({ to: user.email, name: user.name, token: rawToken });

  return {
    sent: !!emailResult.delivered,
    provider: emailResult.provider,
    ...(env.NODE_ENV !== "production" && emailResult.devLink ? { devLink: emailResult.devLink } : {}),
  };
}

async function consumeAuthToken(rawToken, type) {
  const tokenHash = hashAuthToken(rawToken);
  const authToken = await db.authToken.findFirst({
    where: {
      tokenHash,
      type,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!authToken) {
    const err = new AppError("This link is invalid or expired. Please request a new one.", 400);
    err.code = "AUTH_TOKEN_INVALID_OR_EXPIRED";
    throw err;
  }
  await db.authToken.update({
    where: { id: authToken.id },
    data: { consumedAt: new Date() },
  });
  return authToken;
}

function hashAuthToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function genericEmailSecurityResponse() {
  return {
    success: true,
    message: "If an account with a verified email exists, we sent a secure link.",
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
