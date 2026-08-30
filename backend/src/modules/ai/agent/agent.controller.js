/**
 * HTTP surface for the agent: talk, confirm, decline.
 *
 * The context handed to the loop is assembled here and only here. shopId comes
 * from the JWT via requireShop, never from the body, so there is no request a
 * client can shape that reaches another shop — the agent has no parameter for
 * one to begin with.
 */
import db from "../../../db.js";
import { AppError } from "../../../shared/errors/index.js";
import { businessTypeFromSettings, parseShopSettings } from "../../shops/businessProfiles.js";
import { runAgentTurn, executeApprovedPlan, rejectPlan } from "./agent.service.js";
import { registrySnapshot } from "./tool-registry.js";
import "./register-core.js";

async function contextFor(req) {
  const shop = await db.shop.findUnique({ where: { id: req.shopId }, select: { id: true, settingsJson: true } });
  if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
  return {
    shopId: req.shopId,
    userId: req.user?.userId ?? null,
    role: req.user?.role ?? "staff",
    deviceId: req.deviceId ?? req.user?.deviceId ?? null,
    businessType: businessTypeFromSettings(parseShopSettings(shop.settingsJson)),
  };
}

/** Provider faults are operational, not the shopkeeper's fault; say which one. */
function sendProviderError(error, res) {
  const message = String(error?.message ?? "").toLowerCase();
  const status = error?.status ?? error?.statusCode ?? 0;
  if (error?.code === "AI_KEY_MISSING" || message.includes("no ai api key configured")) {
    res.status(503).json({ success: false, error: "AI is not configured on this server.", code: "AI_KEY_MISSING" });
    return true;
  }
  if (status === 429 || message.includes("rate limit")) {
    res.status(429).json({ success: false, error: "The assistant is busy. Try again in a moment.", code: "AI_RATE_LIMITED" });
    return true;
  }
  return false;
}

export async function chat(req, res, next) {
  try {
    const ctx = await contextFor(req);
    const data = await runAgentTurn(ctx, {
      message: req.body?.message,
      history: req.body?.history,
      language: req.body?.language,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (sendProviderError(error, res)) return;
    next(error);
  }
}

export async function confirm(req, res, next) {
  try {
    const ctx = await contextFor(req);
    // Set by requireOwnerPin, which guards the /confirm-owner variant of this
    // route. A plan with no owner-PIN action confirms on the plain route; one
    // that has any is refused there with OWNER_PIN_REQUIRED and the client
    // retries with the PIN. The check itself lives in the service, because only
    // the stored plan knows what it is about to do.
    const data = await executeApprovedPlan(ctx, {
      planId: req.body?.planId,
      ownerPinVerified: req.ownerPinVerified === true,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function reject(req, res, next) {
  try {
    const ctx = await contextFor(req);
    const data = await rejectPlan(ctx, { planId: req.body?.planId });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/** What this caller's assistant can actually do — useful for support and for the UI. */
export async function capabilities(req, res, next) {
  try {
    const ctx = await contextFor(req);
    res.json({ success: true, data: { businessType: ctx.businessType, role: ctx.role, tools: registrySnapshot() } });
  } catch (error) {
    next(error);
  }
}
