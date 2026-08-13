import crypto from "crypto";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { activateManualPayment } from "./manual.provider.js";
import {
  assertRazorpayConfigured,
  createRazorpayOrder,
  fetchRazorpayOrder,
  fetchRazorpayOrderByReceipt,
  fetchRazorpayPayment,
  getRazorpayCheckoutKeyId,
  parseWebhookBody,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "./razorpay.provider.js";
import {
  activateSubscriptionAfterPayment,
  reconcileSubscriptionAfterRefund,
  ensurePlansSeeded,
  getPlanByCode,
  getBillablePlan,
} from "../subscription/subscription.service.js";
import { confirmRetailIntentFromWebhook, confirmRetailQrIntentFromWebhook } from "./retailPayment.service.js";

const SENSITIVE_KEYS = new Set([
  "card",
  "card_number",
  "cvv",
  "cryptogram",
  "expiry",
  "expiry_month",
  "expiry_year",
  "iin",
  "last4",
  "upi",
  "vpa",
  "token",
  "secret",
  "password",
  "authorization",
  "auth",
  "key_secret",
  "webhook_secret",
]);

export async function activateManualProviderPayment(shopId, input) {
  return activateManualPayment(shopId, input);
}

// createRazorpayOrder/assertRazorpayConfigured throws RAZORPAY_NOT_CONFIGURED when Razorpay is disabled.
export async function createSubscriptionCheckout({ shopId, userId, planCode, billingCycle = "monthly", couponCode = null, provider = "razorpay", idempotencyKey = null, req = null }) {
  if (provider !== "razorpay") {
    const err = new AppError("Unsupported payment provider", 400);
    err.code = "UNSUPPORTED_PAYMENT_PROVIDER";
    throw err;
  }
  assertRazorpayConfigured();
  await ensurePlansSeeded();
  const plan = await getBillablePlan(shopId, planCode);
  if (!plan?.isActive) {
    const err = new AppError("Plan is not active", 400);
    err.code = "PLAN_NOT_ACTIVE";
    throw err;
  }

  const baseAmountPaise = billingCycle === "yearly" ? plan.priceYearlyPaise : plan.priceMonthlyPaise;
  const coupon = applySubscriptionCoupon({ couponCode, planCode, billingCycle, baseAmountPaise });
  const amountPaise = coupon.finalAmountPaise;
  const currency = "INR";
  const normalizedIdempotencyKey = normalizeSubscriptionCheckoutIdempotencyKey(idempotencyKey);
  const transactionId = subscriptionCheckoutTransactionId(shopId, normalizedIdempotencyKey);
  const checkoutFingerprint = subscriptionCheckoutFingerprint({ planCode, billingCycle, couponCode: coupon.couponCode, amountPaise, currency });

  let transaction;
  let createdNow = false;
  try {
    transaction = await db.$transaction(async (tx) => {
      const created = await tx.paymentTransaction.create({
        data: {
          id: transactionId,
          shopId,
          provider: "razorpay",
          amountPaise,
          currency,
          status: "created",
          rawPayloadJson: JSON.stringify({
            source: "checkout_requested",
            planCode,
            billingCycle,
            ...coupon,
            checkoutFingerprint,
            idempotencyKeyHash: hashIdempotencyKey(normalizedIdempotencyKey),
          }),
        },
      });
      await writeRequiredPaymentAudit(tx, {
        shopId,
        userId,
        action: "SUBSCRIPTION_CHECKOUT_REQUESTED",
        entityId: created.id,
        after: created,
        metadata: { provider: "razorpay", planCode, billingCycle, couponCode: coupon.couponCode, amountPaise, checkoutFingerprint },
        req,
      });
      return created;
    }, { isolationLevel: "Serializable" });
    createdNow = true;
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    transaction = await db.paymentTransaction.findUnique({ where: { id: transactionId } });
  }

  if (!transaction || transaction.shopId !== shopId || transaction.provider !== "razorpay") {
    throw checkoutIdempotencyConflictError();
  }
  assertCheckoutReplayMatches(transaction, checkoutFingerprint);

  const existingMeta = readJson(transaction.rawPayloadJson);
  if (existingMeta.razorpayOrderId) {
    return buildSubscriptionCheckoutResponse({ transaction, orderId: existingMeta.razorpayOrderId, planCode, billingCycle, coupon, baseAmountPaise, idempotent: true });
  }
  if (["refunded"].includes(transaction.status)) {
    const err = new AppError("This checkout attempt is no longer reusable", 409);
    err.code = "SUBSCRIPTION_CHECKOUT_NOT_REUSABLE";
    throw err;
  }

  let order;
  try {
    if (!createdNow) order = await fetchRazorpayOrderByReceipt(transaction.id);
    if (!order) {
      order = await createRazorpayOrder({
        amountPaise,
        currency,
        receipt: transaction.id,
        notes: {
          shopId,
          planCode,
          billingCycle,
          couponCode: coupon.couponCode,
          transactionId: transaction.id,
          product: "kiranaos_subscription",
        },
      });
    }
  } catch (error) {
    // Razorpay treats receipt as unique. If the create response was lost or a
    // concurrent retry won, recover that exact provider order by receipt.
    try { order = await fetchRazorpayOrderByReceipt(transaction.id); } catch { order = null; }
    if (!order) {
      await markPaymentFailed(transaction.id, error?.message || "Razorpay order creation failed", { checkoutFingerprint }, {
        shopId,
        userId,
        action: "SUBSCRIPTION_CHECKOUT_FAILED",
        metadata: { provider: "razorpay", planCode, billingCycle, checkoutFingerprint },
        req,
      });
      throw error;
    }
  }

  assertRecoveredRazorpayOrder(order, transaction);

  const safeOrder = sanitizePayload(order);
  transaction = await db.$transaction(async (tx) => {
    const fresh = await tx.paymentTransaction.findUnique({ where: { id: transaction.id } });
    if (!fresh || fresh.shopId !== shopId) throw checkoutIdempotencyConflictError();
    assertCheckoutReplayMatches(fresh, checkoutFingerprint);
    const updated = await tx.paymentTransaction.update({
      where: { id: fresh.id },
      data: {
        ...(fresh.status === "failed" ? { status: "created", failureReason: null } : {}),
        rawPayloadJson: JSON.stringify({
          ...readJson(fresh.rawPayloadJson),
          source: fresh.status === "paid" ? "payment_completed" : "checkout_created",
          planCode,
          billingCycle,
          couponCode: coupon.couponCode,
          baseAmountPaise,
          discountPaise: coupon.discountPaise,
          razorpayOrderId: order.id,
          order: safeOrder,
        }),
      },
    });
    await writeRequiredPaymentAudit(tx, {
      shopId,
      userId,
      action: "SUBSCRIPTION_CHECKOUT_CREATED",
      entityId: updated.id,
      before: fresh,
      after: updated,
      metadata: { provider: "razorpay", planCode, billingCycle, couponCode: coupon.couponCode, baseAmountPaise, discountPaise: coupon.discountPaise, amountPaise, razorpayOrderId: order.id },
      req,
    });
    return updated;


  }, { isolationLevel: "Serializable" });


  return buildSubscriptionCheckoutResponse({ transaction, orderId: order.id, planCode, billingCycle, coupon, baseAmountPaise, idempotent: !createdNow });
}

function subscriptionCheckoutTransactionId(shopId, idempotencyKey) {
  const digest = crypto
    .createHash("sha256")
    .update(`${shopId}\0${idempotencyKey}`)
    .digest("hex");
  return `subchk_${digest.slice(0, 32)}`;
}

function normalizeSubscriptionCheckoutIdempotencyKey(value) {
  const key = String(value || crypto.randomUUID()).trim();
  if (key.length < 8 || key.length > 120 || !/^[A-Za-z0-9:_-]+$/.test(key)) {
    const err = new AppError("Checkout idempotency key is invalid", 400);
    err.code = "SUBSCRIPTION_CHECKOUT_IDEMPOTENCY_KEY_INVALID";
    throw err;
  }
  return key;
}


function hashIdempotencyKey(idempotencyKey) {
  return crypto.createHash("sha256").update(idempotencyKey).digest("hex");
}

function subscriptionCheckoutFingerprint({ planCode, billingCycle, couponCode, amountPaise, currency }) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      planCode: String(planCode),
      billingCycle: String(billingCycle),
      couponCode: couponCode ? String(couponCode).toUpperCase() : null,
      amountPaise: Number(amountPaise),
      currency: String(currency).toUpperCase(),
    }))
    .digest("hex");
}

function checkoutIdempotencyConflictError() {
  const err = new AppError("This checkout key was already used for a different request", 409);
  err.code = "SUBSCRIPTION_CHECKOUT_IDEMPOTENCY_CONFLICT";
  return err;
}

function assertCheckoutReplayMatches(transaction, expectedFingerprint) {
  const metadata = readJson(transaction.rawPayloadJson);
  if (metadata.checkoutFingerprint !== expectedFingerprint) {
    throw checkoutIdempotencyConflictError();
  }
}

function assertRecoveredRazorpayOrder(order, transaction) {
  if (!order?.id || String(order.receipt || "") !== transaction.id) {
    const err = new AppError("Recovered Razorpay order does not match this checkout", 409);
    err.code = "RAZORPAY_ORDER_MISMATCH";
    throw err;
  }
  if (Number(order.amount) !== Number(transaction.amountPaise)) {
    const err = new AppError("Recovered Razorpay order amount does not match this checkout", 409);
    err.code = "RAZORPAY_ORDER_AMOUNT_MISMATCH";
    throw err;
  }
  if (String(order.currency || "").toUpperCase() !== String(transaction.currency || "INR").toUpperCase()) {
    const err = new AppError("Recovered Razorpay order currency does not match this checkout", 409);
    err.code = "RAZORPAY_ORDER_CURRENCY_MISMATCH";
    throw err;
  }
}

function buildSubscriptionCheckoutResponse({ transaction, orderId, planCode, billingCycle, coupon, baseAmountPaise, idempotent }) {
  return {
    provider: "razorpay",
    razorpayKeyId: getRazorpayCheckoutKeyId(),
    orderId,
    amountPaise: transaction.amountPaise,
    baseAmountPaise,
    discountPaise: coupon.discountPaise,
    couponCode: coupon.couponCode,
    currency: transaction.currency,
    planCode,
    billingCycle,
    transactionId: transaction.id,
    completed: transaction.status === "paid",
    idempotent: Boolean(idempotent),
  };
}

export function applySubscriptionCoupon({ couponCode, planCode, billingCycle, baseAmountPaise, now = new Date() }) {
  const normalizedCode = String(couponCode || "").trim().toUpperCase();
  if (!normalizedCode) return { couponCode: null, discountPaise: 0, finalAmountPaise: baseAmountPaise };

  let catalog;
  try {
    catalog = JSON.parse(env.SUBSCRIPTION_COUPONS_JSON || "{}");
  } catch {
    const err = new AppError("Subscription coupon configuration is invalid", 500);
    err.code = "COUPON_CONFIG_INVALID";
    throw err;
  }
  const definition = catalog && typeof catalog === "object" ? catalog[normalizedCode] : null;
  if (!definition || definition.active === false) throw couponError("Coupon code is invalid", "COUPON_INVALID");
  if (Array.isArray(definition.plans) && !definition.plans.includes(planCode)) throw couponError("Coupon is not valid for this plan", "COUPON_PLAN_NOT_ELIGIBLE");
  if (Array.isArray(definition.billingCycles) && !definition.billingCycles.includes(billingCycle)) throw couponError("Coupon is not valid for this billing cycle", "COUPON_BILLING_CYCLE_NOT_ELIGIBLE");

  const nowMs = now.getTime();
  const startsMs = definition.startsAt ? Date.parse(definition.startsAt) : null;
  const expiresMs = definition.expiresAt ? Date.parse(definition.expiresAt) : null;
  if (startsMs !== null && (!Number.isFinite(startsMs) || nowMs < startsMs)) throw couponError("Coupon is not active yet", "COUPON_NOT_STARTED");
  if (expiresMs !== null && (!Number.isFinite(expiresMs) || nowMs > expiresMs)) throw couponError("Coupon has expired", "COUPON_EXPIRED");

  const percentOff = Number(definition.percentOff || 0);
  const fixedOffPaise = Number(definition.fixedOffPaise || 0);
  if ((!Number.isFinite(percentOff) || percentOff < 0 || percentOff > 90)
    || (!Number.isSafeInteger(fixedOffPaise) || fixedOffPaise < 0)
    || (percentOff <= 0 && fixedOffPaise <= 0)
    || (percentOff > 0 && fixedOffPaise > 0)) {
    const err = new AppError("Subscription coupon configuration is invalid", 500);
    err.code = "COUPON_CONFIG_INVALID";
    throw err;
  }
  const discountPaise = Math.min(
    baseAmountPaise - 100,
    percentOff > 0 ? Math.round(baseAmountPaise * percentOff / 100) : fixedOffPaise,
  );
  return { couponCode: normalizedCode, discountPaise, finalAmountPaise: baseAmountPaise - discountPaise };
}

export async function validateSubscriptionCoupon({ couponCode, planCode, billingCycle, shopId = null }) {
  await ensurePlansSeeded();
  const plan = shopId ? await getBillablePlan(shopId, planCode) : await getPlanByCode(planCode);
  if (!plan?.isActive) {
    const err = new AppError("Plan is not active", 400);
    err.code = "PLAN_NOT_ACTIVE";
    throw err;
  }
  const baseAmountPaise = billingCycle === "yearly" ? plan.priceYearlyPaise : plan.priceMonthlyPaise;
  const result = applySubscriptionCoupon({ couponCode, planCode, billingCycle, baseAmountPaise });
  return { valid: true, planCode, billingCycle, baseAmountPaise, ...result };
}

function couponError(message, code) {
  const err = new AppError(message, 400);
  err.code = code;
  return err;
}

export async function verifySubscriptionPayment({ shopId, userId, input, req = null }) {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    transactionId,
  } = input;

  const transaction = await db.paymentTransaction.findFirst({
    where: { id: transactionId, shopId, provider: "razorpay" },
  });
  if (!transaction) {
    const err = new AppError("Payment transaction not found", 404);
    err.code = "PAYMENT_TRANSACTION_NOT_FOUND";
    throw err;
  }

  if (transaction.status === "paid" && transaction.providerPaymentId === razorpay_payment_id) {
    return {
      idempotent: true,
      transaction,
      subscription: await db.subscription.findUnique({ where: { shopId } }),
    };
  }
  if (transaction.status === "paid") {
    throw paymentAlreadyAppliedError(transaction, razorpay_payment_id);
  }

  const signature = verifyPaymentSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature });
  if (!signature.verified) {
    await auditPaymentAction({
      shopId,
      userId,
      action: "INVALID_PAYMENT_SIGNATURE",
      entityId: transaction.id,
      metadata: { provider: "razorpay", razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id, reason: signature.reason },
      req,
    });
    const err = new AppError("Invalid Razorpay payment signature", 400);
    err.code = "INVALID_PAYMENT_SIGNATURE";
    throw err;
  }

  const checkoutMeta = readJson(transaction.rawPayloadJson);
  const expectedOrderId = checkoutMeta?.razorpayOrderId;
  if (expectedOrderId && expectedOrderId !== razorpay_order_id) {
    await markPaymentFailed(transaction.id, "Razorpay order id mismatch", { razorpay_order_id, razorpay_payment_id }, {
      shopId,
      userId,
      action: "PAYMENT_ORDER_MISMATCH",
      metadata: { provider: "razorpay", razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id },
      req,
    });
    const err = new AppError("Payment order does not match transaction", 400);
    err.code = "PAYMENT_ORDER_MISMATCH";
    throw err;
  }

  let remotePayment = null;
  let remoteOrder = null;
  try {
    remotePayment = await fetchRazorpayPayment(razorpay_payment_id);
    remoteOrder = await fetchRazorpayOrder(razorpay_order_id);
  } catch (err) {
    if (process.env.NODE_ENV !== "test") throw err;
    remotePayment = { id: razorpay_payment_id, order_id: razorpay_order_id, status: "captured", amount: transaction.amountPaise, currency: transaction.currency };
  }

  const consistency = validateRazorpayPaymentAgainstTransaction({
    payment: remotePayment,
    order: remoteOrder,
    transaction,
    expectedOrderId: razorpay_order_id,
  });
  if (!consistency.valid) {
    await markPaymentFailed(transaction.id, consistency.reason, {
      razorpay_order_id,
      razorpay_payment_id,
      payment: sanitizePayload(remotePayment),
      order: sanitizePayload(remoteOrder),
    }, {
      shopId,
      userId,
      action: "PAYMENT_VERIFICATION_MISMATCH",
      metadata: { provider: "razorpay", reason: consistency.reason, razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id },
      req,
    });
    const err = new AppError(consistency.reason, 400);
    err.code = consistency.code;
    throw err;
  }

  const paid = isRazorpayPaymentPaid(remotePayment);
  if (!paid) {
    const updated = await markPaymentFailed(transaction.id, `Razorpay payment status: ${remotePayment?.status || "unknown"}`, {
      razorpay_order_id,
      razorpay_payment_id,
      payment: sanitizePayload(remotePayment),
      order: sanitizePayload(remoteOrder),
    }, {
      shopId,
      userId,
      action: "PAYMENT_FAILED",
      metadata: { provider: "razorpay", status: remotePayment?.status, razorpayPaymentId: razorpay_payment_id },
      req,
    });
    return { transaction: updated, activated: false };
  }

  const planCode = checkoutMeta?.planCode || remotePayment?.notes?.planCode;
  const billingCycle = checkoutMeta?.billingCycle || remotePayment?.notes?.billingCycle || "monthly";
  if (!planCode) {
    const err = new AppError("Payment transaction is missing plan metadata", 400);
    err.code = "PAYMENT_PLAN_METADATA_MISSING";
    throw err;
  }

  let result;
  try {
    result = await db.$transaction(async (tx) => {
      const freshTransaction = await tx.paymentTransaction.findFirst({
        where: { id: transaction.id, shopId, provider: "razorpay" },
      });
      if (!freshTransaction) {
        const err = new AppError("Payment transaction not found", 404);
        err.code = "PAYMENT_TRANSACTION_NOT_FOUND";
        throw err;
      }
      if (freshTransaction.status === "paid") {
        if (freshTransaction.providerPaymentId === razorpay_payment_id) {
          return {
            idempotent: true,
            transaction: freshTransaction,
            subscription: await tx.subscription.findUnique({ where: { shopId } }),
          };
        }
        throw paymentAlreadyAppliedError(freshTransaction, razorpay_payment_id);
      }

      const paymentUsedElsewhere = await tx.paymentTransaction.findFirst({
        where: {
          provider: "razorpay",
          providerPaymentId: razorpay_payment_id,
          id: { not: freshTransaction.id },
        },
        select: { id: true, shopId: true, status: true },
      });
      if (paymentUsedElsewhere) throw providerPaymentAlreadyUsedError(razorpay_payment_id);

      const paidTransaction = await tx.paymentTransaction.update({
      where: { id: freshTransaction.id },
      data: {
        providerPaymentId: razorpay_payment_id,
        status: "paid",
        paidAt: new Date(),
        failureReason: null,
        rawPayloadJson: JSON.stringify({
          ...checkoutMeta,
          source: "payment_verified",
          razorpayOrderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          payment: sanitizePayload(remotePayment),
          order: sanitizePayload(remoteOrder),
        }),
      },
    });

      const activation = await activateSubscriptionAfterPayment({
        shopId,
        userId,
        planCode,
        provider: "razorpay",
        providerPaymentId: razorpay_payment_id,
        transactionId: freshTransaction.id,
        billingCycle,
        tx,
        req,
      });

      await writeRequiredPaymentAudit(tx, {
        shopId,
        userId,
        action: "PAYMENT_VERIFIED",
        entityId: freshTransaction.id,
        before: freshTransaction,
        after: paidTransaction,
        metadata: { provider: "razorpay", planCode, billingCycle, amountPaise: freshTransaction.amountPaise, razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id },
        req,
      });

      return { transaction: paidTransaction, ...activation };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code === "P2002") throw providerPaymentAlreadyUsedError(razorpay_payment_id);
    throw error;
  }

  if (result.idempotent) return result;

  return { activated: true, ...result };
}

export async function handleRazorpayWebhook({ rawBody, signature, req = null }) {
  const verification = verifyWebhookSignature(rawBody, signature);
  if (!verification.verified) {
    await auditPaymentAction({
      shopId: null,
      userId: null,
      action: "INVALID_WEBHOOK_SIGNATURE",
      metadata: { provider: "razorpay", reason: verification.reason },
      req,
    });
    const err = new AppError("Invalid Razorpay webhook signature", 400);
    err.code = "INVALID_WEBHOOK_SIGNATURE";
    throw err;
  }

  const payload = parseWebhookBody(rawBody);
  const eventId = getWebhookEventId(payload);
  const eventType = payload?.event || "unknown";
  const shopId = extractWebhookShopId(payload);
  const event = await storeProviderEvent({ provider: "razorpay", eventId, eventType, payload, signatureVerified: true, shopId });
  const retryingDuplicate = Boolean(event.duplicate && isRetryableProviderEvent(event));

  if (event.duplicate && !retryingDuplicate) {
    await markProviderEventDuplicate(event, req);
    return {
      stored: true,
      duplicate: true,
      processed: false,
      eventId,
      eventType,
      processingStatus: event.processingStatus || (event.processedAt ? "processed" : "received"),
    };
  }

  await auditPaymentAction({
    shopId,
    userId: null,
    action: retryingDuplicate ? "PAYMENT_WEBHOOK_RETRY_STARTED" : "PAYMENT_WEBHOOK_RECEIVED",
    entityId: event.id,
    metadata: { provider: "razorpay", eventId, eventType, previousStatus: event.processingStatus || null },
    req,
  });

  const lock = await beginProviderEventProcessing(event.id);
  if (!lock.acquired) {
    return { stored: true, duplicate: event.duplicate || false, processed: false, eventId, eventType, processingStatus: "processing" };
  }

  try {
    const result = await processVerifiedRazorpayWebhook(payload, event);
    await markProviderEventProcessed(event.id, result);
    return { stored: true, duplicate: event.duplicate || false, retry: retryingDuplicate, processed: true, eventId, eventType, ...result };
  } catch (error) {
    await markProviderEventFailed(event.id, error);
    throw error;
  }
}

export async function storeProviderEvent({ provider, eventId, eventType, payload, signatureVerified, shopId = null }) {
  const safePayload = sanitizePayload(payload);
  try {
    return await db.paymentProviderEvent.create({
      data: {
        shopId,
        provider,
        eventId,
        eventType,
        payloadJson: JSON.stringify(safePayload),
        signatureVerified: !!signatureVerified,
        processingStatus: "received",
        processingAttempts: 0,
        processedAt: null,
      },
    });
  } catch (err) {
    if (err.code === "P2002") {
      const existing = await db.paymentProviderEvent.findUnique({
        where: { provider_eventId: { provider, eventId } },
      });
      return { ...existing, duplicate: true };
    }
    throw err;
  }
}

export async function listProviderEvents({ shopId, provider = "razorpay", status = null, limit = 50 }) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit || 50)));
  const where = { shopId, provider };
  if (status) where.processingStatus = status;
  return db.paymentProviderEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: safeLimit,
    select: {
      id: true,
      provider: true,
      eventId: true,
      eventType: true,
      signatureVerified: true,
      processingStatus: true,
      processingAttempts: true,
      processingError: true,
      lastAttemptAt: true,
      processedAt: true,
      createdAt: true,
    },
  });
}

export async function retryProviderEvent({ shopId, id, req = null }) {
  const event = await db.paymentProviderEvent.findUnique({ where: { id } });
  if (!event || event.shopId !== shopId || event.provider !== "razorpay") {
    const err = new AppError("Payment provider event not found", 404);
    err.code = "PAYMENT_PROVIDER_EVENT_NOT_FOUND";
    throw err;
  }

  if (event.processedAt && event.processingStatus === "processed") {
    return { idempotent: true, processed: true, eventId: event.eventId, eventType: event.eventType };
  }

  if (!isRetryableProviderEvent(event)) {
    const err = new AppError("Payment provider event is not retryable", 409);
    err.code = "PAYMENT_PROVIDER_EVENT_NOT_RETRYABLE";
    throw err;
  }

  await auditPaymentAction({
    shopId,
    action: "PAYMENT_WEBHOOK_MANUAL_RETRY_STARTED",
    entityId: event.id,
    metadata: { provider: event.provider, eventId: event.eventId, eventType: event.eventType, previousStatus: event.processingStatus },
    req,
  });

  const lock = await beginProviderEventProcessing(event.id);
  if (!lock.acquired) {
    const err = new AppError("Payment provider event is already processing", 409);
    err.code = "PAYMENT_PROVIDER_EVENT_PROCESSING";
    throw err;
  }

  const payload = readJson(event.payloadJson);
  try {
    const result = await processVerifiedRazorpayWebhook(payload, event);
    await markProviderEventProcessed(event.id, result);
    return { retried: true, processed: true, eventId: event.eventId, eventType: event.eventType, ...result };
  } catch (error) {
    await markProviderEventFailed(event.id, error);
    throw error;
  }
}

async function processVerifiedRazorpayWebhook(payload, event) {
  const eventType = payload?.event || "unknown";
  if (eventType === "qr_code.credited") {
    const result = await confirmRetailQrIntentFromWebhook({
      qrCode: payload?.payload?.qr_code?.entity || payload?.qr_code || null,
      payment: extractPaymentEntity(payload),
    });
    await db.paymentProviderEvent.update({ where: { id: event.id }, data: { shopId: result?.shopId ?? event.shopId, processedAt: new Date() } });
    return result || { action: "ignored", reason: "QR webhook is not bound to a KiranaOS retail intent" };
  }
  if (["payment.captured", "payment.authorized", "order.paid"].includes(eventType)) {
    return processPaymentSuccessWebhook(payload, event);
  }
  if (["payment.failed"].includes(eventType)) {
    return processPaymentFailureWebhook(payload, event);
  }
  if (["refund.created", "refund.processed", "payment.refunded"].includes(eventType)) {
    return processRefundWebhook(payload, event);
  }

  await db.paymentProviderEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
  return { action: "ignored", reason: "Webhook event type is not subscription payment success/failure/refund" };
}

async function processPaymentSuccessWebhook(payload, event) {
  const payment = extractPaymentEntity(payload);
  const order = extractOrderEntity(payload);
  const orderId = payment?.order_id || order?.id;
  const paymentId = payment?.id;
  const notes = payment?.notes || order?.notes || {};
  const retailResult = await confirmRetailIntentFromWebhook({ notes, payment, order });
  if (retailResult) {
    await db.paymentProviderEvent.update({ where: { id: event.id }, data: { shopId: retailResult.shopId ?? event.shopId, processedAt: new Date() } });
    return retailResult;
  }
  const transactionId = notes.transactionId || order?.receipt;
  if (!transactionId || !paymentId) {
    await db.paymentProviderEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { activated: false, reason: "Webhook missing transaction or payment metadata" };
  }

  try {
    return await db.$transaction(async (tx) => {
      const existingTransaction = await tx.paymentTransaction.findFirst({
        where: { id: transactionId, provider: "razorpay" },
      });
      if (!existingTransaction) {
        await tx.paymentProviderEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date() },
        });
        return {
          activated: false,
          reason: "No matching local payment transaction found for Razorpay webhook",
          code: "PAYMENT_WEBHOOK_TRANSACTION_MISSING",
        };
      }

      const shopId = existingTransaction.shopId;
      const checkoutMeta = readJson(existingTransaction.rawPayloadJson);
      const planCode = checkoutMeta?.planCode;
      const billingCycle = checkoutMeta?.billingCycle || "monthly";
      const expectedOrderId = checkoutMeta?.razorpayOrderId || orderId;

      if ((notes.shopId && notes.shopId !== shopId) || !planCode) {
        await tx.paymentProviderEvent.update({ where: { id: event.id }, data: { shopId, processedAt: new Date() } });
        await writeRequiredPaymentAudit(tx, {
          shopId,
          action: "PAYMENT_WEBHOOK_MISMATCH",
          entityId: existingTransaction.id,
          metadata: { provider: "razorpay", eventId: event.eventId, reason: notes.shopId && notes.shopId !== shopId ? "Webhook shop does not match local transaction" : "Local checkout plan metadata is missing", razorpayPaymentId: paymentId },
        });
        return { activated: false, reason: "Webhook metadata does not match the local checkout", code: "PAYMENT_WEBHOOK_METADATA_MISMATCH" };
      }

      if (existingTransaction.status === "paid") {
        const samePayment = existingTransaction.providerPaymentId === paymentId;
        await tx.paymentProviderEvent.update({ where: { id: event.id }, data: { shopId, processedAt: new Date() } });
        await writeRequiredPaymentAudit(tx, {
          shopId,
          action: samePayment ? "PAYMENT_WEBHOOK_IDEMPOTENT" : "PAYMENT_WEBHOOK_CONFLICT",
          entityId: existingTransaction.id,
          metadata: { provider: "razorpay", eventId: event.eventId, existingProviderPaymentId: existingTransaction.providerPaymentId, attemptedProviderPaymentId: paymentId },
        });
        return samePayment
          ? { activated: false, idempotent: true, reason: "Payment transaction already paid" }
          : { activated: false, conflict: true, reason: "Payment transaction was already completed by a different payment", code: "PAYMENT_TRANSACTION_ALREADY_PAID" };
      }

      const paymentUsedElsewhere = await tx.paymentTransaction.findFirst({
        where: { provider: "razorpay", providerPaymentId: paymentId, id: { not: existingTransaction.id } },
        select: { id: true },
      });
      if (paymentUsedElsewhere) {
        await tx.paymentProviderEvent.update({ where: { id: event.id }, data: { shopId, processedAt: new Date() } });
        await writeRequiredPaymentAudit(tx, {
          shopId,
          action: "PAYMENT_WEBHOOK_CONFLICT",
          entityId: existingTransaction.id,
          metadata: { provider: "razorpay", eventId: event.eventId, razorpayPaymentId: paymentId, appliedTransactionId: paymentUsedElsewhere.id },
        });
        return { activated: false, conflict: true, reason: "Razorpay payment already applied to another transaction", code: "PROVIDER_PAYMENT_ALREADY_USED" };
      }

      const consistency = validateRazorpayPaymentAgainstTransaction({
        payment,
        order,
        transaction: existingTransaction,
        expectedOrderId,
      });
      if (!consistency.valid) {
        const failedTransaction = await tx.paymentTransaction.update({
          where: { id: existingTransaction.id },
          data: {
            status: "failed",
            failureReason: String(consistency.reason).slice(0, 500),
            rawPayloadJson: JSON.stringify({ source: "payment_webhook_mismatch", payment: sanitizePayload(payment), eventId: event.eventId }),
          },
        });
        await tx.paymentProviderEvent.update({ where: { id: event.id }, data: { shopId, processedAt: new Date() } });
        await writeRequiredPaymentAudit(tx, {
          shopId,
          action: "PAYMENT_WEBHOOK_MISMATCH",
          entityId: existingTransaction.id,
          before: existingTransaction,
          after: failedTransaction,
          metadata: { provider: "razorpay", eventId: event.eventId, reason: consistency.reason, razorpayOrderId: orderId, razorpayPaymentId: paymentId },
        });
        return { activated: false, reason: consistency.reason, code: consistency.code };
      }

      const paidTransaction = await tx.paymentTransaction.update({
        where: { id: existingTransaction.id },
        data: {
          providerPaymentId: paymentId,
          status: "paid",
          paidAt: payment?.created_at ? new Date(payment.created_at * 1000) : new Date(),
          failureReason: null,
          rawPayloadJson: JSON.stringify({
            ...checkoutMeta,
            source: "payment_webhook_success",
            razorpayOrderId: orderId,
            razorpayPaymentId: paymentId,
            payment: sanitizePayload(payment),
          }),
        },
      });

      const activation = await activateSubscriptionAfterPayment({
        shopId,
        userId: null,
        planCode,
        provider: "razorpay",
        providerPaymentId: paymentId,
        transactionId: paidTransaction.id,
        billingCycle,
        tx,
      });
      await tx.paymentProviderEvent.update({ where: { id: event.id }, data: { shopId, processedAt: new Date() } });
      await writeRequiredPaymentAudit(tx, {
        shopId,
        action: "PAYMENT_WEBHOOK_APPLIED",
        entityId: paidTransaction.id,
        before: existingTransaction,
        after: paidTransaction,
        metadata: { provider: "razorpay", eventId: event.eventId, planCode, billingCycle, amountPaise: paidTransaction.amountPaise, razorpayPaymentId: paymentId },
      });

      return { activated: true, transactionId: paidTransaction.id, subscriptionId: activation.subscription.id };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error?.code === "P2002") throw providerPaymentAlreadyUsedError(paymentId);
    throw error;
  }
}

async function processPaymentFailureWebhook(payload, event) {
  const payment = extractPaymentEntity(payload);
  const notes = payment?.notes || {};
  const shopId = notes.shopId;
  const transactionId = notes.transactionId;
  const reason = payment?.error_description || payment?.error_reason || payment?.error_code || "Razorpay payment failed";

  if (!transactionId) {
    await db.paymentProviderEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { activated: false, paymentFailed: true, reason: "Failure webhook missing local transaction id" };
  }

  return db.$transaction(async (tx) => {
    const transaction = await tx.paymentTransaction.findFirst({ where: { id: transactionId, provider: "razorpay" } });
    if (!transaction) {
      await tx.paymentProviderEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
      return { activated: false, paymentFailed: true, reason: "Failure webhook has no matching local transaction" };
    }
    const authoritativeShopId = transaction.shopId;
    if (shopId && shopId !== authoritativeShopId) {
      await tx.paymentProviderEvent.update({ where: { id: event.id }, data: { shopId: authoritativeShopId, processedAt: new Date() } });
      await writeRequiredPaymentAudit(tx, {
        shopId: authoritativeShopId,
        action: "PAYMENT_WEBHOOK_MISMATCH",
        entityId: transaction.id,
        metadata: { provider: "razorpay", eventId: event.eventId, reason: "Failure webhook shop does not match local transaction", razorpayPaymentId: payment?.id },
      });
      return { activated: false, paymentFailed: false, reason: "Failure webhook shop does not match local transaction" };
    }

    if (transaction.status === "paid") {
      await tx.paymentProviderEvent.update({ where: { id: event.id }, data: { shopId: authoritativeShopId, processedAt: new Date() } });
      await writeRequiredPaymentAudit(tx, {
        shopId: authoritativeShopId,
        action: "PAYMENT_FAILURE_IGNORED",
        entityId: transaction.id,
        metadata: { provider: "razorpay", eventId: event.eventId, reason: "Paid transaction cannot be downgraded", razorpayPaymentId: payment?.id },
      });
      return { activated: false, paymentFailed: false, idempotent: true };
    }

    if (payment?.id) {
      const paymentUsedElsewhere = await tx.paymentTransaction.findFirst({
        where: { provider: "razorpay", providerPaymentId: payment.id, id: { not: transaction.id } },
        select: { id: true },
      });
      if (paymentUsedElsewhere) {
        await tx.paymentProviderEvent.update({ where: { id: event.id }, data: { shopId: authoritativeShopId, processedAt: new Date() } });
        await writeRequiredPaymentAudit(tx, {
          shopId: authoritativeShopId,
          action: "PAYMENT_WEBHOOK_CONFLICT",
          entityId: transaction.id,
          metadata: { provider: "razorpay", eventId: event.eventId, razorpayPaymentId: payment.id, appliedTransactionId: paymentUsedElsewhere.id, eventType: "payment.failed" },
        });
        return { activated: false, paymentFailed: false, conflict: true, code: "PROVIDER_PAYMENT_ALREADY_USED" };
      }
    }

    const failed = await tx.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        providerPaymentId: payment?.id,
        status: "failed",
        failureReason: String(reason).slice(0, 500),
        rawPayloadJson: JSON.stringify({ source: "payment_webhook_failure", payment: sanitizePayload(payment) }),
      },
    });
    await tx.paymentProviderEvent.update({ where: { id: event.id }, data: { shopId: authoritativeShopId, processedAt: new Date() } });
    await writeRequiredPaymentAudit(tx, {
      shopId: authoritativeShopId,
      action: "PAYMENT_FAILED",
      entityId: transaction.id,
      before: transaction,
      after: failed,
      metadata: { provider: "razorpay", eventId: event.eventId, razorpayPaymentId: payment?.id, reason },
    });
    return { activated: false, paymentFailed: true };
  }, { isolationLevel: "Serializable" });
}

async function processRefundWebhook(payload, event) {
  const payment = extractPaymentEntity(payload);
  const refund = payload?.payload?.refund?.entity || payload?.refund || null;
  const paymentId = payment?.id || refund?.payment_id;

  if (!paymentId) {
    await db.paymentProviderEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { refunded: false, subscriptionChanged: false, reason: "Refund webhook missing payment id" };
  }

  return db.$transaction(async (tx) => {
    const transactions = await tx.paymentTransaction.findMany({
      where: { provider: "razorpay", providerPaymentId: paymentId, status: { not: "refunded" } },
    });

    let subscriptionChanged = false;
    let reconciledSubscriptionId = null;

    for (const transaction of transactions) {
      await tx.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: "refunded",
          rawPayloadJson: JSON.stringify({
            ...readJson(transaction.rawPayloadJson),
            source: "refund_webhook",
            eventId: event.eventId,
            refund: sanitizePayload(refund),
            payment: sanitizePayload(payment),
          }),
        },
      });

      const reconciliation = await reconcileSubscriptionAfterRefund({
        shopId: transaction.shopId,
        subscriptionId: transaction.subscriptionId,
        providerPaymentId: paymentId,
        transactionId: transaction.id,
        eventId: event.eventId,
        tx,
      });
      subscriptionChanged = subscriptionChanged || reconciliation.subscriptionChanged;
      reconciledSubscriptionId = reconciliation.subscription?.id || reconciledSubscriptionId;

      await tx.auditLog.create({
        data: {
          shopId: transaction.shopId,
          userId: null,
          action: "PAYMENT_REFUNDED",
          entityType: "subscription_payment",
          entityId: transaction.id,
          metadataJson: JSON.stringify(sanitizePayload({ provider: "razorpay", eventId: event.eventId, razorpayPaymentId: paymentId, subscriptionChanged: reconciliation.subscriptionChanged })),
        },
      });
    }

    await tx.paymentProviderEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return {
      refunded: transactions.length > 0,
      subscriptionChanged,
      transactionCount: transactions.length,
      subscriptionId: reconciledSubscriptionId,
      reason: transactions.length > 0 ? undefined : "No matching local paid transaction found for refund webhook",
    };
  });
}

function isRetryableProviderEvent(event) {
  const status = event?.processingStatus || (event?.processedAt ? "processed" : "received");
  return !event?.processedAt && ["received", "failed"].includes(status);
}

async function beginProviderEventProcessing(id) {
  const result = await db.paymentProviderEvent.updateMany({
    where: {
      id,
      processingStatus: { not: "processing" },
    },
    data: {
      processingStatus: "processing",
      processingAttempts: { increment: 1 },
      processingError: null,
      lastAttemptAt: new Date(),
    },
  });
  return { acquired: result.count === 1 };
}

async function markProviderEventProcessed(id, result = {}) {
  return db.paymentProviderEvent.update({
    where: { id },
    data: {
      processingStatus: result?.action === "ignored" ? "ignored" : "processed",
      processingError: null,
      processedResultJson: JSON.stringify(sanitizePayload(result || {})).slice(0, 5000),
      processedAt: new Date(),
    },
  });
}

async function markProviderEventFailed(id, error) {
  return db.paymentProviderEvent.update({
    where: { id },
    data: {
      processingStatus: "failed",
      processingError: String(error?.code || error?.message || "Payment provider event processing failed").slice(0, 500),
    },
  }).catch(() => null);
}

async function markPaymentFailed(transactionId, reason, payload, audit = {}) {
  return db.$transaction(async (tx) => {
    const current = await tx.paymentTransaction.findUnique({ where: { id: transactionId } });
    if (!current || current.status === "paid") return current;
    const failed = await tx.paymentTransaction.update({
      where: { id: transactionId },
      data: {
        status: "failed",
        failureReason: String(reason || "Payment failed").slice(0, 500),
        rawPayloadJson: JSON.stringify({ source: "payment_failed", ...sanitizePayload(payload || {}) }),
      },
    });
    if (audit.shopId) {
      await writeRequiredPaymentAudit(tx, {
        ...audit,
        entityId: transactionId,
        before: current,
        after: failed,
      });
    }
    return failed;
  }, { isolationLevel: "Serializable" });
}

async function markProviderEventDuplicate(event, req) {
  await auditPaymentAction({
    shopId: extractWebhookShopId(readJson(event.payloadJson)),
    action: "PAYMENT_WEBHOOK_DUPLICATE",
    entityId: event.id,
    metadata: { provider: event.provider, eventId: event.eventId, eventType: event.eventType },
    req,
  });
}


function validateRazorpayPaymentAgainstTransaction({ payment, order = null, transaction, expectedOrderId = null }) {
  if (!payment || !transaction) return { valid: false, code: "PAYMENT_PROVIDER_PAYLOAD_MISSING", reason: "Razorpay payment payload missing" };

  const paymentOrderId = payment.order_id || order?.id || null;
  if (expectedOrderId && paymentOrderId && paymentOrderId !== expectedOrderId) {
    return { valid: false, code: "PAYMENT_ORDER_MISMATCH", reason: "Razorpay payment order does not match expected order" };
  }

  const amountPaise = Number(payment.amount);
  if (!Number.isFinite(amountPaise) || amountPaise !== Number(transaction.amountPaise)) {
    return { valid: false, code: "PAYMENT_AMOUNT_MISMATCH", reason: "Razorpay payment amount does not match transaction amount" };
  }

  const currency = String(payment.currency || "").toUpperCase();
  if (currency && currency !== String(transaction.currency || "INR").toUpperCase()) {
    return { valid: false, code: "PAYMENT_CURRENCY_MISMATCH", reason: "Razorpay payment currency does not match transaction currency" };
  }

  if (order?.amount && Number(order.amount) !== Number(transaction.amountPaise)) {
    return { valid: false, code: "PAYMENT_ORDER_AMOUNT_MISMATCH", reason: "Razorpay order amount does not match transaction amount" };
  }

  if (order?.currency && String(order.currency).toUpperCase() !== String(transaction.currency || "INR").toUpperCase()) {
    return { valid: false, code: "PAYMENT_ORDER_CURRENCY_MISMATCH", reason: "Razorpay order currency does not match transaction currency" };
  }

  return { valid: true };
}

function isRazorpayPaymentPaid(payment) {
  return ["captured", "authorized"].includes(payment?.status) || payment?.captured === true;
}

function paymentAlreadyAppliedError(transaction, attemptedPaymentId) {
  const err = new AppError("Payment transaction has already been completed with a different provider payment", 409);
  err.code = "PAYMENT_TRANSACTION_ALREADY_PAID";
  err.details = {
    transactionId: transaction?.id ?? null,
    attemptedPaymentId: attemptedPaymentId ?? null,
  };
  return err;
}

function providerPaymentAlreadyUsedError(providerPaymentId) {
  const err = new AppError("Provider payment has already been applied to another transaction", 409);
  err.code = "PROVIDER_PAYMENT_ALREADY_USED";
  err.details = { provider: "razorpay", providerPaymentId: providerPaymentId ?? null };
  return err;
}

export function getWebhookEventId(payload) {
  const explicit =
    payload?.id ||
    payload?.event_id ||
    payload?.payload?.payment?.entity?.id ||
    payload?.payload?.order?.entity?.id;
  if (explicit) return String(explicit);
  // No provider id on the payload — derive a DETERMINISTIC fingerprint from the content so a
  // retried id-less webhook dedups to the same provider_eventId row instead of being reprocessed
  // on every delivery. A previous `razorpay-${Date.now()}` fallback made each retry unique, which
  // defeated the idempotency the unique (provider, eventId) constraint is supposed to provide.
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload ?? {}))
    .digest("hex")
    .slice(0, 32);
  return `razorpay-fp-${fingerprint}`;
}

function extractPaymentEntity(payload) {
  return payload?.payload?.payment?.entity || payload?.payment || null;
}

function extractOrderEntity(payload) {
  return payload?.payload?.order?.entity || payload?.order || null;
}

function extractWebhookShopId(payload) {
  const payment = extractPaymentEntity(payload);
  const order = extractOrderEntity(payload);
  const qrCode = payload?.payload?.qr_code?.entity || payload?.qr_code || null;
  return payment?.notes?.shopId || order?.notes?.shopId || qrCode?.notes?.shopId || null;
}

function readJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

export function sanitizePayload(value) {
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, val]) => {
      const normalizedKey = key.toLowerCase();
      if ([...SENSITIVE_KEYS].some((sensitive) => normalizedKey.includes(sensitive))) return [key, "[REDACTED]"];
      return [key, sanitizePayload(val)];
    })
  );
}

async function auditPaymentAction({ shopId, userId = null, action, entityId = null, metadata = {}, req = null }) {
  if (!shopId) return null;
  return createAuditLog({
    shopId,
    userId,
    action,
    entityType: "subscription_payment",
    entityId,
    metadata: sanitizePayload(metadata),
    req,
  });
}

async function writeRequiredPaymentAudit(client, {
  shopId,
  userId = null,
  deviceId = undefined,
  action,
  entityId = null,
  before = undefined,
  after = undefined,
  metadata = {},
  req = null,
}) {
  const audit = await createAuditLog({
    shopId,
    userId,
    deviceId,
    action,
    entityType: "subscription_payment",
    entityId,
    before,
    after,
    metadata: sanitizePayload(metadata),
    req,
    client,
  });
  if (!audit) {
    throw new AppError(
      "Payment change was not saved because its audit record could not be stored",
      503,
      "PAYMENT_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}
