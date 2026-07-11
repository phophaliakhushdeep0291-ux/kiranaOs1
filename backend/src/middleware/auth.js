import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "./error.js";
import db from "../db.js";

/**
 * requireAuth — verifies JWT, confirms the user still exists and is active,
 * then attaches fresh user info to req.user.
 *
 * This intentionally checks the database on protected requests so staff removal,
 * role downgrades, and disabled accounts take effect immediately instead of
 * waiting for the access token to expire.
 *
 * req.user = { userId, shopId, role }
 */
export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError("No token provided", 401));
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (!payload?.userId || !payload?.shopId) {
      const err = new AppError("Invalid token payload", 401);
      err.code = "INVALID_TOKEN_PAYLOAD";
      throw err;
    }

    const user = await db.user.findFirst({
      where: { id: payload.userId, shopId: payload.shopId, disabledAt: null },
      select: { id: true, shopId: true, role: true },
    });

    if (!user) {
      const err = new AppError("User session is no longer active", 401);
      err.code = "USER_SESSION_INACTIVE";
      throw err;
    }

    let session = null;
    if (payload.sessionId || payload.sid) {
      session = await db.session.findFirst({
        where: {
          id: payload.sessionId || payload.sid,
          userId: user.id,
          shopId: user.shopId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: { device: true },
      });

      if (!session) {
        const err = new AppError("Login session is no longer active", 401);
        err.code = "SESSION_INACTIVE";
        throw err;
      }

      if (session.device) {
        const status = session.device.status === "removed" ? "revoked" : session.device.status;
        if (status === "revoked") {
          throw new AppError("This device was removed from the shop.", 401, "DEVICE_SESSION_REVOKED");
        }
        if (status === "blocked") {
          throw new AppError("This device has been blocked by the shop owner.", 403, "DEVICE_BLOCKED");
        }
        if (status !== "active") {
          throw new AppError("This device is not signed in.", 401, "DEVICE_SESSION_REVOKED");
        }
        if (payload.deviceRecordId && payload.deviceRecordId !== session.device.id) {
          throw new AppError("This device session is no longer valid.", 401, "DEVICE_SESSION_REVOKED");
        }
        if (payload.deviceId && payload.deviceId !== session.device.deviceId) {
          throw new AppError("This access token belongs to another device.", 401, "DEVICE_SESSION_REVOKED");
        }
        const tokenVersion = payload.sessionVersion ?? session.deviceSessionVersion;
        if (tokenVersion !== null && tokenVersion !== undefined && tokenVersion !== session.device.sessionVersion) {
          throw new AppError("This device session was revoked.", 401, "DEVICE_SESSION_REVOKED");
        }
        const requestDeviceId = normalizeHeader(req.headers["x-device-id"]);
        if (requestDeviceId && requestDeviceId !== session.device.deviceId) {
          throw new AppError("Device context does not match this session.", 401, "DEVICE_SESSION_REVOKED");
        }
      } else if (payload.deviceRecordId && env.NODE_ENV === "production") {
        throw new AppError("Registered device not found for this session.", 401, "DEVICE_SESSION_REVOKED");
      }
    }

    // Never trust stale role claims from an old JWT. Role changes must apply
    // immediately for all protected APIs. Session/device data is loaded fresh
    // from the database when the token contains a session id.
    req.user = {
      ...payload,
      userId: user.id,
      shopId: user.shopId,
      role: user.role,
      sessionId: session?.id ?? payload.sessionId ?? payload.sid ?? null,
      deviceId: session?.deviceId ?? null,
      deviceRecordId: session?.deviceRecordId ?? payload.deviceRecordId ?? null,
      sessionVersion: session?.device?.sessionVersion ?? payload.sessionVersion ?? null,
    };
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    next(new AppError("Invalid or expired token", 401));
  }
}

function normalizeHeader(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * requireRole — checks that req.user.role is in the allowed list.
 * Usage: requireRole("owner"), requireRole("owner", "admin")
 */
export function requireRole(...roles) {
  const allowedRoles = roles.flat();

  return (req, _res, next) => {
    if (!req.user) return next(new AppError("Not authenticated", 401));
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError("Insufficient permissions", 403));
    }
    next();
  };
}

/** Helper used in services to create a signed JWT */
export function signToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}
