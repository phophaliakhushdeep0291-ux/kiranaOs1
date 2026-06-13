import bcrypt from "bcryptjs";
import db from "../db.js";
import { AppError } from "./error.js";
import { env } from "../config/env.js";
import { doesBodyTouchProtectedFields, purchaseChangesProtectedPrice } from "../utils/permissionRules.js";
import { createAuditLog } from "../modules/audit/audit.service.js";

/**
 * requireShop — ensures every request carries a shopId.
 * For now, shopId comes from req.user (JWT payload).
 * Later, multi-shop admins can pass it in the header.
 *
 * Attaches req.shopId for convenience in controllers/services.
 */
export function requireShop(req, _res, next) {
  const shopId = req.user?.shopId ?? req.headers["x-shop-id"];
  if (!shopId) {
    return next(new AppError("Shop context required", 400));
  }
  req.shopId = shopId;
  next();
}

/**
 * requireOwnerPin — protects risky shop actions.
 *
 * Allowed when:
 *   1. OWNER_PIN_REQUIRED=false and the logged-in user role is owner, OR
 *   2. The request provides the owner's 4-digit PIN.
 *
 * PIN input can be sent as:
 *   - body.ownerPin
 *   - x-owner-pin header
 * The PIN is never accepted from the query string (it would leak into access logs,
 * browser history, proxies, and analytics).
 *
 * The PIN is always compared with the bcrypt hash stored on the owner user.
 * It is never stored or returned by this middleware.
 */
export async function requireOwnerPin(req, _res, next) {
  try {
    if (!req.user) throw new AppError("Not authenticated", 401);
    if (!req.shopId) throw new AppError("Shop context required", 400);

    // Production default: every destructive/financial action must prove intent with
    // the owner PIN, even when the current JWT belongs to the owner. Set
    // OWNER_PIN_REQUIRED=false only for trusted development/admin migration flows.
    if (!env.OWNER_PIN_REQUIRED && req.user.role === "owner") return next();

    const ownerPin = getOwnerPinFromRequest(req);
    if (!ownerPin) {
      throw new AppError("Owner PIN required", 403);
    }
    if (!/^\d{4}$/.test(ownerPin)) {
      throw new AppError("Owner PIN must be exactly 4 digits", 400);
    }

    const owner = await db.user.findFirst({
      where: { shopId: req.shopId, role: "owner" },
      select: { pinHash: true },
    });

    if (!owner) throw new AppError("Owner not found", 404);
    if (!owner.pinHash) throw new AppError("Owner PIN not set yet", 400);

    const ok = await bcrypt.compare(ownerPin, owner.pinHash);
    if (!ok) throw new AppError("Wrong owner PIN", 403);

    await logOwnerPinVerified(req);
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * requireOwnerPinForFields — only requires owner/PIN when a PATCH body touches
 * sensitive fields. This lets staff safely edit non-sensitive fields like name
 * or category while protecting price/cost/tax/HSN changes.
 */
export function requireOwnerPinForFields(protectedFields = []) {
  return async (req, res, next) => {
    const touchesProtectedField = doesBodyTouchProtectedFields(req.body, protectedFields);
    if (!touchesProtectedField) return next();
    return requireOwnerPin(req, res, next);
  };
}

/**
 * Purchase can indirectly update cost/min price. Because updateCost defaults to
 * true later in validation, missing updateCost also means a protected cost edit.
 */
export function requireOwnerPinForPurchasePriceChange(req, res, next) {
  if (!purchaseChangesProtectedPrice(req.body)) return next();
  return requireOwnerPin(req, res, next);
}

async function logOwnerPinVerified(req) {
  try {
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "OWNER_PIN_VERIFIED",
      entityType: "Security",
      metadata: {
        route: req.originalUrl ?? req.url,
        method: req.method,
      },
      req,
    });
  } catch (error) {
    console.error("Owner PIN audit log failed", error);
  }
}

function getOwnerPinFromRequest(req) {
  // Never read from req.query — a PIN in the URL leaks into access logs, browser history,
  // proxies, and analytics. Body or the x-owner-pin header only.
  const raw = req.body?.ownerPin ?? req.headers["x-owner-pin"];
  if (Array.isArray(raw)) return String(raw[0] ?? "").trim();
  return raw === undefined || raw === null ? "" : String(raw).trim();
}
