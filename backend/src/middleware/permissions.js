import bcrypt from "bcryptjs";
import db from "../db.js";
import { AppError } from "./error.js";
import { env } from "../config/env.js";
import { doesBodyTouchProtectedFields, purchaseChangesProtectedPrice } from "../utils/permissionRules.js";
import { createAuditLog } from "../modules/audit/audit.service.js";
import { getActiveShopMaintenanceLock } from "../modules/backups/maintenance-lock.service.js";

/**
 * requireShop — ensures every request carries a shopId.
 *
 * shopId is taken ONLY from the authenticated JWT (req.user). A client-supplied x-shop-id header
 * is deliberately not trusted: requireShop always runs behind requireAuth, and honoring a header
 * would let any authenticated caller operate on another tenant's data if this were ever mounted
 * without auth. Multi-shop admin switching, if ever added, must go through an explicit admin check.
 *
 * Attaches req.shopId for convenience in controllers/services.
 */
export async function requireShop(req, res, next) {
  const shopId = req.user?.shopId;
  if (!shopId) {
    return next(new AppError("Shop context required", 400));
  }
  req.shopId = shopId;
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  // The restore executor must be able to acquire/release the lock itself. All
  // other tenant mutations—including sync push—fail closed across instances.
  if (/^\/api\/jobs\/backups\/[^/]+\/restore$/.test(req.originalUrl?.split("?")[0] ?? "")) return next();
  try {
    const lock = await getActiveShopMaintenanceLock(shopId);
    if (!lock) return next();
    const seconds = Math.max(1, Math.ceil((lock.expiresAt.getTime() - Date.now()) / 1000));
    res.setHeader("Retry-After", String(seconds));
    return next(new AppError("Shop is temporarily read-only for verified maintenance", 423, "SHOP_MAINTENANCE_LOCKED"));
  } catch (error) {
    return next(error);
  }
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
    if (!env.OWNER_PIN_REQUIRED && req.user.role === "owner") {
      req.ownerPinVerified = true;
      return next();
    }

    await assertOwnerPinAttemptAllowed(req, _res);

    const ownerPin = getOwnerPinFromRequest(req);
    if (!ownerPin) {
      throw new AppError("Owner PIN required", 403);
    }
    if (!/^\d{4}$/.test(ownerPin)) {
      await logOwnerPinFailure(req, "INVALID_FORMAT");
      await throwPinFailureOrLockout(req, _res, "Owner PIN must be exactly 4 digits", 400);
    }

    const owner = await db.user.findFirst({
      where: { shopId: req.shopId, role: "owner" },
      select: { pinHash: true },
    });

    if (!owner) throw new AppError("Owner not found", 404);
    if (!owner.pinHash) throw new AppError("Owner PIN not set yet", 400);

    const ok = await bcrypt.compare(ownerPin, owner.pinHash);
    if (!ok) {
      await logOwnerPinFailure(req, "MISMATCH");
      await throwPinFailureOrLockout(req, _res, "Wrong owner PIN", 403);
    }

    await logOwnerPinVerified(req);
    req.ownerPinVerified = true;
    return next();
  } catch (err) {
    return next(err);
  }
}

const OWNER_PIN_FAILURE_ACTION = "OWNER_PIN_VERIFICATION_FAILED";
const OWNER_PIN_SUCCESS_ACTION = "OWNER_PIN_VERIFIED";

async function getOwnerPinAttemptState(req, now = new Date()) {
  const userId = req.user?.userId ?? req.user?.id ?? null;
  const windowStart = new Date(now.getTime() - env.OWNER_PIN_LOCKOUT_MINUTES * 60_000);
  const lastSuccess = userId
    ? await db.auditLog.findFirst({
        where: {
          shopId: req.shopId,
          userId,
          action: OWNER_PIN_SUCCESS_ACTION,
          createdAt: { gte: windowStart },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      })
    : null;
  const userFailureStart = lastSuccess?.createdAt && lastSuccess.createdAt > windowStart
    ? lastSuccess.createdAt
    : windowStart;
  const [userFailures, shopFailures] = await Promise.all([
    userId
      ? db.auditLog.count({
          where: {
            shopId: req.shopId,
            userId,
            action: OWNER_PIN_FAILURE_ACTION,
            createdAt: { gt: userFailureStart },
          },
        })
      : Promise.resolve(env.OWNER_PIN_MAX_FAILURES),
    db.auditLog.count({
      where: {
        shopId: req.shopId,
        action: OWNER_PIN_FAILURE_ACTION,
        createdAt: { gte: windowStart },
      },
    }),
  ]);
  return {
    locked:
      userFailures >= env.OWNER_PIN_MAX_FAILURES ||
      shopFailures >= env.OWNER_PIN_SHOP_MAX_FAILURES,
    userFailures,
    shopFailures,
    retryAfterSeconds: env.OWNER_PIN_LOCKOUT_MINUTES * 60,
  };
}

async function assertOwnerPinAttemptAllowed(req, res) {
  const state = await getOwnerPinAttemptState(req);
  if (!state.locked) return state;
  res?.setHeader?.("Retry-After", String(state.retryAfterSeconds));
  throw new AppError(
    `Owner PIN temporarily locked after repeated failures. Try again in ${env.OWNER_PIN_LOCKOUT_MINUTES} minutes.`,
    429,
    "OWNER_PIN_LOCKED",
  );
}

async function throwPinFailureOrLockout(req, res, message, statusCode) {
  const state = await getOwnerPinAttemptState(req);
  if (state.locked) {
    res?.setHeader?.("Retry-After", String(state.retryAfterSeconds));
    throw new AppError(
      `Owner PIN temporarily locked after repeated failures. Try again in ${env.OWNER_PIN_LOCKOUT_MINUTES} minutes.`,
      429,
      "OWNER_PIN_LOCKED",
    );
  }
  throw new AppError(message, statusCode, statusCode === 400 ? "OWNER_PIN_INVALID_FORMAT" : "OWNER_PIN_INVALID");
}

async function logOwnerPinFailure(req, reason) {
  await createAuditLog({
    shopId: req.shopId,
    userId: req.user?.userId ?? req.user?.id,
    action: OWNER_PIN_FAILURE_ACTION,
    entityType: "Security",
    metadata: {
      route: req.originalUrl ?? req.url,
      method: req.method,
      reason,
    },
    req,
  });
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
      action: OWNER_PIN_SUCCESS_ACTION,
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

export const __ownerPinInternals = {
  getOwnerPinAttemptState,
  OWNER_PIN_FAILURE_ACTION,
  OWNER_PIN_SUCCESS_ACTION,
};
