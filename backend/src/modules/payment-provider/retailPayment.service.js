import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { resolveOperationalLocation } from "../stores/location-context.service.js";
import {
  createRazorpayOrder,
  fetchRazorpayOrder,
  fetchRazorpayPayment,
  getRazorpayCheckoutKeyId,
  verifyPaymentSignature,
} from "./razorpay.provider.js";

export function retailPaymentReadiness() {
  const configured = env.RETAIL_PAYMENT_PROVIDER === "razorpay" && env.RAZORPAY_ENABLED
    && Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET);
  return {
    provider: env.RETAIL_PAYMENT_PROVIDER,
    configured,
    confirmationRequired: env.RETAIL_PAYMENT_CONFIRMATION_REQUIRED,
    serverVerified: configured,
  };
}

export async function createRetailPaymentIntent({ shopId, requestedLocationId, userId, amountPaise }) {
  if (!retailPaymentReadiness().configured) throw new AppError("Verified retail payment checkout is not configured", 503, "RETAIL_PAYMENT_PROVIDER_NOT_CONFIGURED");
  const location = await resolveOperationalLocation(shopId, requestedLocationId);
  const expiresAt = new Date(Date.now() + env.RETAIL_PAYMENT_INTENT_TTL_MINUTES * 60_000);
  const intent = await db.retailPaymentIntent.create({
    data: { shopId, locationId: location.id, amountPaise, provider: "razorpay", createdByUserId: userId ?? null, expiresAt },
  });
  try {
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

function assertRemotePayment(intent, orderId, paymentId, payment, order) {
  const valid = payment?.id === paymentId
    && payment?.order_id === orderId
    && Number(payment?.amount) === intent.amountPaise
    && String(payment?.currency || "").toUpperCase() === intent.currency
    && String(payment?.status || "").toLowerCase() === "captured"
    && (!order || (order.id === orderId && Number(order.amount) === intent.amountPaise));
  if (!valid) throw new AppError("Razorpay payment does not match this retail intent", 409, "RETAIL_PAYMENT_MISMATCH");
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
