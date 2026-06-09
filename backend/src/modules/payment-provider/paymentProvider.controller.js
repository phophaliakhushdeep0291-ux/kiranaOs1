import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import * as service from "./paymentProvider.service.js";

export async function manualActivate(req, res, next) {
  try {
    if (!env.ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION) {
      const err = new AppError("Manual subscription activation is disabled", 403);
      err.code = "MANUAL_SUBSCRIPTION_ACTIVATION_DISABLED";
      throw err;
    }
    // Tenant safety: public/manual activation must never trust shopId from the request body.
    // Platform-admin cross-tenant activation should live in a separate internal admin route.
    res.status(201).json({ success: true, data: await service.activateManualProviderPayment(req.shopId, req.body) });
  } catch (err) { next(err); }
}

export async function razorpayWebhook(req, res, next) {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const result = await service.handleRazorpayWebhook({ rawBody: req.body, signature, req });
    res.status(200).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function listEvents(req, res, next) {
  try {
    const events = await service.listProviderEvents({
      shopId: req.shopId,
      provider: req.query.provider || "razorpay",
      status: req.query.status || null,
      limit: req.query.limit || 50,
    });
    res.json({ success: true, data: events });
  } catch (err) { next(err); }
}

export async function retryEvent(req, res, next) {
  try {
    const result = await service.retryProviderEvent({ shopId: req.shopId, id: req.params.id, req });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
