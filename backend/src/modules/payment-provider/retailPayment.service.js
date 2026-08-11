import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { resolveOperationalLocation } from "../stores/location-context.service.js";
import {
  closeRazorpayQrCode,
  createRazorpayQrCode,
  createRazorpayOrder,
  fetchRazorpayQrCode,
  fetchRazorpayQrCodePayments,
  fetchRazorpayOrder,
  fetchRazorpayPayment,
  getRazorpayCheckoutKeyId,
  verifyPaymentSignature,
} from "./razorpay.provider.js";
import { validateRetailQrPayment, validateRetailUpiPayment } from "./retailPayment.validation.js";

export function retailPaymentReadiness() {
  const configured = env.RETAIL_PAYMENT_PROVIDER === "razorpay" && env.RAZORPAY_ENABLED
    && Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET);
  return {
    provider: env.RETAIL_PAYMENT_PROVIDER,
    configured,
    confirmationRequired: env.RETAIL_PAYMENT_CONFIRMATION_REQUIRED,
    serverVerified: configured,
    dynamicQrEnabled: configured && env.RAZORPAY_DYNAMIC_QR_ENABLED,
  };
}

export async function createRetailPaymentIntent({ shopId, requestedLocationId, userId, amountPaise, mode = "checkout" }) {
  const readiness = retailPaymentReadiness();
  if (!readiness.configured) throw new AppError("Verified retail payment checkout is not configured", 503, "RETAIL_PAYMENT_PROVIDER_NOT_CONFIGURED");
  if (mode === "dynamic_qr" && !readiness.dynamicQrEnabled) {
    throw new AppError("Provider-confirmed dynamic UPI QR is not enabled for this Razorpay account", 503, "RETAIL_DYNAMIC_QR_NOT_ENABLED");
  }
  const location = await resolveOperationalLocation(shopId, requestedLocationId);
  const expiresAt = new Date(Date.now() + env.RETAIL_PAYMENT_INTENT_TTL_MINUTES * 60_000);
  const intent = await db.retailPaymentIntent.create({
    data: { shopId, locationId: location.id, amountPaise, provider: "razorpay", checkoutMode: mode, createdByUserId: userId ?? null, expiresAt },
  });
  try {
    if (mode === "dynamic_qr") {
      const qrCode = await createRazorpayQrCode({
        amountPaise,
        name: `KiranaOS ${location.code || location.name}`,
        description: `Retail payment at ${location.name}`,
        closeBy: Math.floor(expiresAt.getTime() / 1000),
        notes: { product: "kiranaos_retail_qr", intentId: intent.id, shopId, locationId: location.id },
      });
      const validation = validateCreatedQrCode(intent, qrCode);
      if (!validation.valid) {
        if (qrCode?.id) await closeRazorpayQrCode(qrCode.id).catch(() => null);
        throw new AppError(validation.reason, 502, "RETAIL_QR_PROVIDER_MISMATCH");
      }
      const providerExpiry = Number(qrCode.close_by) > 0 ? new Date(Number(qrCode.close_by) * 1000) : expiresAt;
      const imageUrl = safeRazorpayQrImageUrl(qrCode.image_url);
      const updated = await db.retailPaymentIntent.update({
        where: { id: intent.id },
        data: { status: "pending", providerQrCodeId: qrCode.id, providerQrImageUrl: imageUrl, expiresAt: providerExpiry },
      });
      return retailIntentResponse(updated, location);
    }
    const order = await createRazorpayOrder({
      amountPaise,
      receipt: intent.id,
      notes: { product: "kiranaos_retail", intentId: intent.id, shopId, locationId: location.id },
    });
    await db.retailPaymentIntent.update({ where: { id: intent.id }, data: { status: "pending", providerOrderId: order.id } });
    return { intentId: intent.id, provider: "razorpay", razorpayKeyId: getRazorpayCheckoutKeyId(), orderId: order.id, amountPaise, currency: "INR", expiresAt: expiresAt.toISOString(), location: { id: location.id, name: location.name } };
  } catch (error) {
    await db.retailPaymentIntent.update({ where: { id: intent.id }, data: { status: "failed", failureReason: String(error?.message || "Order creation failed").slice(0, 500) } }).catch(() => {});
    throw error;
  }
}

function validateCreatedQrCode(intent, qrCode) {
  const notes = qrCode?.notes || {};
  const checks = [
    [typeof qrCode?.id === "string" && qrCode.id.startsWith("qr_"), "Razorpay returned an invalid QR id"],
    [qrCode?.status === "active", "Razorpay QR is not active"],
    [qrCode?.type === "upi_qr", "Razorpay returned a non-UPI QR"],
    [qrCode?.usage === "single_use", "Razorpay QR is not single-use"],
    [qrCode?.fixed_amount === true, "Razorpay QR is not fixed-amount"],
    [Number(qrCode?.payment_amount) === Number(intent.amountPaise), "Razorpay QR amount does not match the intent"],
    [String(notes.intentId || "") === intent.id, "Razorpay QR intent binding is missing"],
    [String(notes.shopId || "") === intent.shopId, "Razorpay QR shop binding is missing"],
    [String(notes.locationId || "") === intent.locationId, "Razorpay QR branch binding is missing"],
    [Boolean(safeRazorpayQrImageUrl(qrCode?.image_url)), "Razorpay QR image URL is not trusted"],
  ];
  const failed = checks.find(([valid]) => !valid);
  return failed ? { valid: false, reason: failed[1] } : { valid: true, reason: null };
}

function safeRazorpayQrImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "rzp.io" ? url.toString() : null;
  } catch {
    return null;
  }
}

function retailIntentResponse(intent, location = null) {
  return {
    intentId: intent.id,
    provider: intent.provider,
    mode: intent.checkoutMode,
    status: intent.status,
    amountPaise: intent.amountPaise,
    currency: intent.currency,
    expiresAt: intent.expiresAt.toISOString(),
    imageUrl: intent.checkoutMode === "dynamic_qr" ? safeRazorpayQrImageUrl(intent.providerQrImageUrl) : undefined,
    location: location ? { id: location.id, name: location.name } : { id: intent.locationId, name: null },
    confirmedAt: intent.confirmedAt?.toISOString?.() ?? null,
    confirmationSource: intent.confirmationSource ?? null,
  };
}

async function confirmQrIntent(intent, qrCode, payments, confirmationSource) {
  const captured = (Array.isArray(payments?.items) ? payments.items : [])
    .filter((payment) => String(payment?.status || "").toLowerCase() === "captured" || payment?.captured === true);
  if (captured.length > 1) {
    await db.retailPaymentIntent.update({ where: { id: intent.id }, data: { status: "failed", failureReason: "Provider returned multiple captured payments for a single-use QR" } });
    throw new AppError("Multiple payments were reported for this single-use QR; reconcile before billing", 409, "RETAIL_QR_MULTIPLE_PAYMENTS");
  }
  if (captured.length === 0) return null;
  const payment = captured[0];
  const validation = validateRetailQrPayment(intent, qrCode, payment);
  if (!validation.valid) {
    await db.retailPaymentIntent.update({ where: { id: intent.id }, data: { status: "failed", failureReason: validation.reason } });
    throw new AppError(validation.reason, 409, "RETAIL_QR_PAYMENT_MISMATCH");
  }
  const claimed = await db.retailPaymentIntent.updateMany({
    where: { id: intent.id, status: { in: ["creating", "pending"] }, providerPaymentId: null },
    data: { status: "confirmed", providerPaymentId: payment.id, confirmedAt: new Date(), confirmationSource, failureReason: null },
  });
  if (claimed.count === 1) return db.retailPaymentIntent.findUnique({ where: { id: intent.id } });
  return db.retailPaymentIntent.findUnique({ where: { id: intent.id } });
}

export async function getRetailPaymentIntentStatus({ shopId, intentId }) {
  let intent = await db.retailPaymentIntent.findFirst({ where: { id: intentId, shopId } });
  if (!intent) throw new AppError("Retail payment intent not found", 404, "RETAIL_PAYMENT_INTENT_NOT_FOUND");
  if (intent.checkoutMode !== "dynamic_qr" || !intent.providerQrCodeId || intent.status === "confirmed") return retailIntentResponse(intent);
  if (!["creating", "pending"].includes(intent.status)) return retailIntentResponse(intent);

  const [qrCode, payments] = await Promise.all([
    fetchRazorpayQrCode(intent.providerQrCodeId),
    fetchRazorpayQrCodePayments(intent.providerQrCodeId),
  ]);
  const createdValidation = validateCreatedQrCode({ ...intent, amountPaise: intent.amountPaise }, { ...qrCode, status: qrCode.status === "closed" ? "active" : qrCode.status });
  if (!createdValidation.valid) throw new AppError(createdValidation.reason, 409, "RETAIL_QR_PROVIDER_MISMATCH");
  const confirmed = await confirmQrIntent(intent, qrCode, payments, "provider_qr_api");
  if (confirmed) return retailIntentResponse(confirmed);

  if (intent.expiresAt <= new Date() || qrCode.status === "closed") {
    intent = await db.retailPaymentIntent.update({ where: { id: intent.id }, data: { status: "expired", failureReason: qrCode.close_reason ? `QR closed: ${qrCode.close_reason}` : null } });
  }
  return retailIntentResponse(intent);
}

export async function cancelRetailPaymentIntent({ shopId, intentId, userId, userRole }) {
  const intent = await db.retailPaymentIntent.findFirst({ where: { id: intentId, shopId } });
  if (!intent) throw new AppError("Retail payment intent not found", 404, "RETAIL_PAYMENT_INTENT_NOT_FOUND");
  if (!['owner', 'admin'].includes(userRole) && intent.createdByUserId && intent.createdByUserId !== userId) {
    throw new AppError("Only the cashier who started this QR can cancel it", 403, "RETAIL_PAYMENT_INTENT_FORBIDDEN");
  }
  if (intent.status === "confirmed") throw new AppError("A confirmed payment cannot be cancelled from checkout", 409, "RETAIL_PAYMENT_ALREADY_CONFIRMED");
  if (intent.providerQrCodeId && ["creating", "pending"].includes(intent.status)) await closeRazorpayQrCode(intent.providerQrCodeId);
  const updated = await db.retailPaymentIntent.update({ where: { id: intent.id }, data: { status: "cancelled", failureReason: "Cancelled by cashier before confirmation" } });
  return retailIntentResponse(updated);
}

function assertRemotePayment(intent, orderId, paymentId, payment, order) {
  const validation = validateRetailUpiPayment(intent, orderId, paymentId, payment, order);
  if (!validation.valid) throw new AppError(validation.reason || "Razorpay UPI payment does not match this retail intent", 409, "RETAIL_PAYMENT_MISMATCH");
}

export async function verifyRetailPaymentIntent({ shopId, intentId, input }) {
  const intent = await db.retailPaymentIntent.findFirst({ where: { id: intentId, shopId } });
  if (!intent) throw new AppError("Retail payment intent not found", 404, "RETAIL_PAYMENT_INTENT_NOT_FOUND");
  if (intent.status === "confirmed" && intent.providerPaymentId === input.razorpay_payment_id) return intent;
  if (intent.expiresAt <= new Date()) {
    await db.retailPaymentIntent.update({ where: { id: intent.id }, data: { status: "expired" } });
    throw new AppError("Retail payment intent has expired", 409, "RETAIL_PAYMENT_INTENT_EXPIRED");
  }
  if (intent.providerOrderId !== input.razorpay_order_id) throw new AppError("Payment order does not match this retail intent", 409, "RETAIL_PAYMENT_ORDER_MISMATCH");
  if (!verifyPaymentSignature(input).verified) throw new AppError("Invalid Razorpay payment signature", 400, "INVALID_PAYMENT_SIGNATURE");
  const [payment, order] = await Promise.all([fetchRazorpayPayment(input.razorpay_payment_id), fetchRazorpayOrder(input.razorpay_order_id)]);
  assertRemotePayment(intent, input.razorpay_order_id, input.razorpay_payment_id, payment, order);
  return db.retailPaymentIntent.update({
    where: { id: intent.id },
    data: { status: "confirmed", providerPaymentId: input.razorpay_payment_id, confirmedAt: new Date(), confirmationSource: "provider_api", failureReason: null },
  });
}

export async function confirmRetailIntentFromWebhook({ notes, payment, order }) {
  if (notes?.product !== "kiranaos_retail" || !notes?.intentId) return null;
  const intent = await db.retailPaymentIntent.findUnique({ where: { id: notes.intentId } });
  if (!intent) return { retailPayment: true, confirmed: false, reason: "Retail intent not found" };
  try {
    assertRemotePayment(intent, intent.providerOrderId, payment?.id, payment, order);
    const updated = await db.retailPaymentIntent.update({ where: { id: intent.id }, data: { status: "confirmed", providerPaymentId: payment.id, confirmedAt: new Date(), confirmationSource: "signed_webhook", failureReason: null } });
    return { retailPayment: true, confirmed: true, intentId: updated.id, shopId: updated.shopId };
  } catch (error) {
    await db.retailPaymentIntent.update({ where: { id: intent.id }, data: { status: "failed", failureReason: String(error.message).slice(0, 500) } });
    return { retailPayment: true, confirmed: false, intentId: intent.id, reason: error.message };
  }
}

export async function confirmRetailQrIntentFromWebhook({ qrCode, payment }) {
  const intentId = qrCode?.notes?.intentId;
  if (qrCode?.notes?.product !== "kiranaos_retail_qr" || !intentId) return null;
  const intent = await db.retailPaymentIntent.findUnique({ where: { id: intentId } });
  if (!intent) return { retailPayment: true, dynamicQr: true, confirmed: false, reason: "Retail QR intent not found" };
  if (intent.providerQrCodeId !== qrCode.id) {
    return { retailPayment: true, dynamicQr: true, confirmed: false, intentId: intent.id, shopId: intent.shopId, reason: "QR id does not match retail intent" };
  }
  try {
    const updated = await confirmQrIntent(intent, qrCode, { items: [payment] }, "signed_qr_webhook");
    return { retailPayment: true, dynamicQr: true, confirmed: updated?.status === "confirmed", intentId: intent.id, shopId: intent.shopId };
  } catch (error) {
    return { retailPayment: true, dynamicQr: true, confirmed: false, intentId: intent.id, shopId: intent.shopId, reason: error.message };
  }
}

export async function resolveRetailPaymentIntents(client, { shopId, locationId, payments }) {
  const resolved = new Map();
  for (const payment of payments.filter((row) => row.mode !== "cash" && row.mode !== "credit")) {
    const intentId = payment.retailPaymentIntentId ?? payment.retail_payment_intent_id ?? null;
    if (!intentId) {
      if (env.RETAIL_PAYMENT_CONFIRMATION_REQUIRED && payment.mode === "upi") throw new AppError("Verified UPI confirmation is required before billing", 409, "RETAIL_PAYMENT_CONFIRMATION_REQUIRED");
      continue;
    }
    const intent = await client.retailPaymentIntent.findFirst({ where: { id: intentId, shopId } });
    if (!intent || intent.locationId !== locationId || intent.status !== "confirmed" || intent.consumedAt) {
      throw new AppError("Retail payment intent is not valid for this bill and branch", 409, "RETAIL_PAYMENT_INTENT_INVALID");
    }
    const expectedPaise = Math.round(Number(payment.amount) * 100);
    if (intent.amountPaise !== expectedPaise) throw new AppError("Retail payment amount does not match the bill tender", 409, "RETAIL_PAYMENT_AMOUNT_MISMATCH");
    resolved.set(intentId, intent);
  }
  return resolved;
}

export async function consumeRetailPaymentIntents(client, intents) {
  for (const intent of intents.values()) {
    const consumed = await client.retailPaymentIntent.updateMany({ where: { id: intent.id, status: "confirmed", consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new AppError("Retail payment was already used by another bill", 409, "RETAIL_PAYMENT_ALREADY_USED");
  }
}
