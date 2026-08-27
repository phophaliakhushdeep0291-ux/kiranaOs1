import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import * as service from "./paymentProvider.service.js";
import * as retailService from "./retailPayment.service.js";
import * as terminalService from "./cardTerminal.service.js";
import * as connectionService from "./paymentConnections.service.js";
import { requestLocationId } from "../stores/location-context.service.js";

export async function manualActivate(req, res, next) {
  try {
    if (!env.ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION) {
      const err = new AppError("Manual subscription activation is disabled", 403);
      err.code = "MANUAL_SUBSCRIPTION_ACTIVATION_DISABLED";
      throw err;
    }
    // Tenant safety: public/manual activation must never trust shopId from the request body.
    // Platform-admin cross-tenant activation should live in a separate internal admin route.
    res.status(201).json({
      success: true,
      data: await service.activateManualProviderPayment(req.shopId, {
        ...req.body,
        userId: req.user?.userId ?? req.user?.id ?? null,
        deviceId: req.device?.id ?? req.headers?.["x-device-id"] ?? undefined,
        req,
      }),
    });
  } catch (err) { next(err); }
}

export async function razorpayWebhook(req, res, next) {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const result = await service.handleRazorpayWebhook({ rawBody: req.body, signature, req });
    res.status(200).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function restaurantRazorpayWebhook(req, res, next) {
  try {
    const connection = await connectionService.getPaymentConnectionForWebhook(req.params.connectionId, "razorpay");
    if (!connection) throw new AppError("Payment webhook endpoint was not found", 404, "PAYMENT_WEBHOOK_NOT_FOUND");
    const signature = req.headers["x-razorpay-signature"];
    const result = await service.handleRazorpayWebhook({ rawBody: req.body, signature, req, credentials: connection.credentials, expectedShopId: connection.shopId });
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

export async function retailReadiness(req, res, next) {
  try { res.json({ success: true, data: await retailService.retailPaymentReadinessForShop(req.shopId) }); } catch (err) { next(err); }
}

export async function createRetailIntent(req, res, next) {
  try {
    const data = await retailService.createRetailPaymentIntent({ shopId: req.shopId, requestedLocationId: requestLocationId(req), userId: req.user?.userId, amountPaise: req.body.amountPaise, mode: req.body.mode });
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function retailIntentStatus(req, res, next) {
  try { res.json({ success: true, data: await retailService.getRetailPaymentIntentStatus({ shopId: req.shopId, intentId: req.params.id }) }); } catch (err) { next(err); }
}

export async function cardTerminalReadiness(req, res, next) {
  try { res.json({ success: true, data: terminalService.retailCardTerminalReadiness() }); } catch (err) { next(err); }
}

export async function startCardTerminalCharge(req, res, next) {
  try {
    res.json({ success: true, data: await terminalService.startCardTerminalCharge({ shopId: req.shopId, requestedLocationId: req.body.locationId, userId: req.user?.userId, amountPaise: req.body.amountPaise, requestId: req.body.requestId }) });
  } catch (err) { next(err); }
}

export async function cardTerminalChargeStatus(req, res, next) {
  try { res.json({ success: true, data: await terminalService.getCardTerminalChargeStatus({ shopId: req.shopId, intentId: req.params.id }) }); } catch (err) { next(err); }
}

export async function cancelCardTerminalCharge(req, res, next) {
  try {
    res.json({ success: true, data: await terminalService.cancelCardTerminalCharge({ shopId: req.shopId, intentId: req.params.id, userId: req.user?.userId, userRole: req.user?.role }) });
  } catch (err) { next(err); }
}

export async function reconcileCardTerminalCharge(req, res, next) {
  try {
    res.json({
      success: true,
      data: await terminalService.reconcileCardTerminalCharge({
        shopId: req.shopId,
        intentId: req.params.id,
        userId: req.user?.userId,
        deviceId: req.device?.id ?? req.headers?.["x-device-id"] ?? null,
        outcome: req.body.outcome,
        providerPaymentId: req.body.providerPaymentId,
        reason: req.body.reason,
      }),
    });
  } catch (err) { next(err); }
}

export async function retailIntentQrBitmap(req, res, next) {
  try { res.json({ success: true, data: await retailService.getRetailPaymentQrBitmap({ shopId: req.shopId, intentId: req.params.id }) }); } catch (err) { next(err); }
}

export async function cancelRetailIntent(req, res, next) {
  try {
    res.json({ success: true, data: await retailService.cancelRetailPaymentIntent({ shopId: req.shopId, intentId: req.params.id, userId: req.user?.userId, userRole: req.user?.role }) });
  } catch (err) { next(err); }
}

export async function verifyRetailIntent(req, res, next) {
  try { res.json({ success: true, data: await retailService.verifyRetailPaymentIntent({ shopId: req.shopId, intentId: req.params.id, input: req.body }) }); } catch (err) { next(err); }
}

export async function listPaymentConnections(req, res, next) {
  try { res.json({ success: true, data: await connectionService.listPaymentConnections(req.shopId) }); } catch (err) { next(err); }
}

export async function savePaymentConnection(req, res, next) {
  try { res.json({ success: true, data: await connectionService.savePaymentConnection({ shopId: req.shopId, userId: req.user?.userId, provider: req.params.provider, input: req.body, req }) }); } catch (err) { next(err); }
}

export async function verifyPaymentConnection(req, res, next) {
  try { res.json({ success: true, data: await connectionService.verifyPaymentConnection({ shopId: req.shopId, userId: req.user?.userId, provider: req.params.provider, req }) }); } catch (err) { next(err); }
}

export async function selectPaymentConnection(req, res, next) {
  try { res.json({ success: true, data: await connectionService.selectPaymentConnection({ shopId: req.shopId, userId: req.user?.userId, provider: req.params.provider, req }) }); } catch (err) { next(err); }
}

export async function disablePaymentConnection(req, res, next) {
  try { res.json({ success: true, data: await connectionService.disablePaymentConnection({ shopId: req.shopId, userId: req.user?.userId, provider: req.params.provider, req }) }); } catch (err) { next(err); }
}
