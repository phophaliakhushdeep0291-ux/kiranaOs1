import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import * as service from "./subscription.service.js";
import { createSubscriptionCheckout, validateSubscriptionCoupon, verifySubscriptionPayment } from "../payment-provider/paymentProvider.service.js";

function requireInternalSubscriptionOverride() {
  if (!env.ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION) {
    throw new AppError(
      "Internal subscription overrides are disabled",
      403,
      "MANUAL_SUBSCRIPTION_ACTIVATION_DISABLED",
    );
  }
}

function requestActor(req) {
  return {
    userId: req.user?.userId ?? req.user?.id ?? null,
    deviceId: req.device?.id ?? req.headers?.["x-device-id"] ?? undefined,
    req,
  };
}

export async function plans(req, res, next) {
  try {
    res.json({ success: true, data: await service.listPlans(req.query.businessType) });
  } catch (err) { next(err); }
}

export async function current(req, res, next) {
  try {
    res.json({ success: true, data: await service.getCurrentSubscription(req.shopId) });
  } catch (err) { next(err); }
}

export async function manualActivate(req, res, next) {
  try {
    requireInternalSubscriptionOverride();
    const result = await service.activateManualSubscription(
      req.shopId,
      req.body.planCode,
      req.body.period,
      { ...req.body, ...requestActor(req) },
    );
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function changePlan(req, res, next) {
  try {
    requireInternalSubscriptionOverride();
    res.json({ success: true, data: await service.changePlan(req.shopId, req.body.planCode, requestActor(req)) });
  } catch (err) { next(err); }
}

export async function cancel(req, res, next) {
  try {
    res.json({ success: true, data: await service.cancelSubscription(req.shopId, requestActor(req)) });
  } catch (err) { next(err); }
}

export async function extendGrace(req, res, next) {
  try {
    requireInternalSubscriptionOverride();
    res.json({ success: true, data: await service.extendGrace(req.shopId, req.body.days, requestActor(req)) });
  } catch (err) { next(err); }
}

export async function foundingCustomer(req, res, next) {
  try {
    requireInternalSubscriptionOverride();
    const data = await service.grantFoundingCustomer(
      req.shopId,
      req.body.intendedPaidPlanCode,
      { endsAt: req.body.endsAt, ...requestActor(req) },
    );
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function onboardingPurchases(req, res, next) {
  try { res.json({ success: true, data: await service.listOnboardingPurchases(req.shopId) }); }
  catch (err) { next(err); }
}

export async function recordOnboardingPurchase(req, res, next) {
  try {
    requireInternalSubscriptionOverride();
    const data = await service.recordOnboardingPurchase(
      req.shopId,
      req.user?.userId ?? req.user?.id,
      req.body,
      requestActor(req),
    );
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}


export async function checkout(req, res, next) {
  try {
    const data = await createSubscriptionCheckout({
      shopId: req.shopId,
      userId: req.user?.userId ?? req.user?.id ?? null,
      planCode: req.body.planCode,
      billingCycle: req.body.billingCycle,
      couponCode: req.body.couponCode,
      provider: req.body.provider,
      req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function validateCoupon(req, res, next) {
  try {
    const data = await validateSubscriptionCoupon({ ...req.body, shopId: req.shopId });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function verifyPayment(req, res, next) {
  try {
    const data = await verifySubscriptionPayment({
      shopId: req.shopId,
      userId: req.user?.userId ?? req.user?.id ?? null,
      input: req.body,
      req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
