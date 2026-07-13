import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import * as service from "./subscription.service.js";
import { createSubscriptionCheckout, validateSubscriptionCoupon, verifySubscriptionPayment } from "../payment-provider/paymentProvider.service.js";

export async function plans(_req, res, next) {
  try {
    res.json({ success: true, data: await service.listPlans() });
  } catch (err) { next(err); }
}

export async function current(req, res, next) {
  try {
    res.json({ success: true, data: await service.getCurrentSubscription(req.shopId) });
  } catch (err) { next(err); }
}

export async function manualActivate(req, res, next) {
  try {
    if (!env.ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION) {
      const err = new AppError("Manual subscription activation is disabled", 403);
      err.code = "MANUAL_SUBSCRIPTION_ACTIVATION_DISABLED";
      throw err;
    }
    const result = await service.activateManualSubscription(req.shopId, req.body.planCode, req.body.period, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function changePlan(req, res, next) {
  try {
    res.json({ success: true, data: await service.changePlan(req.shopId, req.body.planCode) });
  } catch (err) { next(err); }
}

export async function cancel(req, res, next) {
  try {
    res.json({ success: true, data: await service.cancelSubscription(req.shopId) });
  } catch (err) { next(err); }
}

export async function extendGrace(req, res, next) {
  try {
    res.json({ success: true, data: await service.extendGrace(req.shopId, req.body.days) });
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
    const data = await validateSubscriptionCoupon(req.body);
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
