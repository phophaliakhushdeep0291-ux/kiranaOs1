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

    // Never trust stale role claims from an old JWT. Role changes must apply
    // immediately for all protected APIs.
    req.user = { ...payload, userId: user.id, shopId: user.shopId, role: user.role };
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    next(new AppError("Invalid or expired token", 401));
  }
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
