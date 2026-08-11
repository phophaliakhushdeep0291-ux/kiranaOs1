import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { resolveOperationalLocation } from "../stores/location-context.service.js";
import { cardTerminalReadiness, getCardTerminalProvider } from "./terminal.provider.js";

/**
 * Card/EDC terminal charges reuse RetailPaymentIntent so a card tender is
 * consumed by exactly the same guards as a UPI one: branch-bound, amount-bound,
 * single-use, and unusable by a second bill.
 *
 * A terminal charge settles as the "bank" tender, not a new payment mode. That
 * is where the money actually lands — the acquirer credits the shop's bank
 * account, never the cash drawer — and it keeps reports, daily closing and the
 * assurance rules working unchanged.
 */

const OPEN_STATUSES = ["creating", "pending"];

function terminalIntentResponse(intent, extra = {}) {
  return {
    intentId: intent.id,
    provider: intent.provider,
    mode: intent.checkoutMode,
    status: intent.status,
    amountPaise: intent.amountPaise,
    currency: intent.currency,
    expiresAt: intent.expiresAt.toISOString(),
    chargeId: intent.providerOrderId,
    location: { id: intent.locationId, name: extra.locationName ?? null },
    confirmedAt: intent.confirmedAt?.toISOString?.() ?? null,
    confirmationSource: intent.confirmationSource ?? null,
    failureReason: intent.failureReason ?? null,
    cardNetwork: extra.cardNetwork ?? null,
    authCode: extra.authCode ?? null,
  };
}

export function retailCardTerminalReadiness() {
  const readiness = cardTerminalReadiness();
  return {
    ...readiness,
    // The bill records a bank tender; the terminal is only how it was collected.
    tenderMode: "bank",
    chargeTimeoutSeconds: env.CARD_TERMINAL_CHARGE_TIMEOUT_SECONDS,
  };
}

export async function startCardTerminalCharge({ shopId, requestedLocationId, userId, amountPaise }) {
  const provider = getCardTerminalProvider();
  const location = await resolveOperationalLocation(shopId, requestedLocationId);
  const expiresAt = new Date(Date.now() + env.CARD_TERMINAL_CHARGE_TIMEOUT_SECONDS * 1_000);
  const intent = await db.retailPaymentIntent.create({
    data: {
      shopId,
      locationId: location.id,
      amountPaise,
      provider: env.CARD_TERMINAL_PROVIDER,
      checkoutMode: "terminal",
      createdByUserId: userId ?? null,
      expiresAt,
    },
  });
  try {
    // The intent id doubles as the idempotency key so a retried request cannot
    // ask the customer to tap twice for one bill line.
    const charge = await provider.createCharge({ amountPaise, reference: intent.id, idempotencyKey: intent.id });
    if (!charge?.chargeId) throw new AppError("Card terminal did not return a charge reference", 502, "CARD_TERMINAL_INVALID_RESPONSE");
    const updated = await db.retailPaymentIntent.update({
      where: { id: intent.id },
      data: { status: "pending", providerOrderId: charge.chargeId },
    });
    return terminalIntentResponse(updated, { locationName: location.name });
  } catch (error) {
    await db.retailPaymentIntent.update({
      where: { id: intent.id },
      data: { status: "failed", failureReason: String(error?.message || "Card terminal charge could not be started").slice(0, 500) },
    }).catch(() => {});
    throw error;
  }
}

/** Nothing is trusted from the terminal screen — only from an acquirer read. */
async function confirmTerminalCharge(intent, charge) {
  if (Number(charge.amountPaise) !== Number(intent.amountPaise)) {
    const updated = await db.retailPaymentIntent.update({
      where: { id: intent.id },
      data: { status: "failed", failureReason: "Terminal settled a different amount than the counter requested" },
    });
    void updated;
    throw new AppError("Card terminal settled a different amount than this bill", 409, "CARD_TERMINAL_AMOUNT_MISMATCH");
  }
  if (!charge.paymentId) throw new AppError("Card terminal approved a charge without a payment reference", 502, "CARD_TERMINAL_INVALID_RESPONSE");
  // Claim the confirmation once. A concurrent poll from a second tab must not
  // produce a second confirmed intent for the same tap.
  await db.retailPaymentIntent.updateMany({
    where: { id: intent.id, status: { in: OPEN_STATUSES }, providerPaymentId: null },
    data: {
      status: "confirmed",
      providerPaymentId: charge.paymentId,
      confirmedAt: new Date(),
      confirmationSource: "terminal_provider_api",
      failureReason: null,
    },
  });
  return db.retailPaymentIntent.findUnique({ where: { id: intent.id } });
}

export async function getCardTerminalChargeStatus({ shopId, intentId }) {
  const intent = await db.retailPaymentIntent.findFirst({ where: { id: intentId, shopId } });
  if (!intent) throw new AppError("Card terminal charge not found", 404, "CARD_TERMINAL_CHARGE_NOT_FOUND");
  if (intent.checkoutMode !== "terminal") throw new AppError("This payment is not a card terminal charge", 409, "CARD_TERMINAL_WRONG_MODE");
  if (!OPEN_STATUSES.includes(intent.status) || !intent.providerOrderId) return terminalIntentResponse(intent);

  const charge = await getCardTerminalProvider().fetchCharge(intent.providerOrderId);
  if (charge.status === "approved") {
    const confirmed = await confirmTerminalCharge(intent, charge);
    return terminalIntentResponse(confirmed, { cardNetwork: charge.cardNetwork, authCode: charge.authCode });
  }
  if (["declined", "failed", "cancelled"].includes(charge.status)) {
    const failed = await db.retailPaymentIntent.update({
      where: { id: intent.id },
      data: { status: charge.status === "cancelled" ? "cancelled" : "failed", failureReason: String(charge.failureReason || `Terminal reported ${charge.status}`).slice(0, 500) },
    });
    return terminalIntentResponse(failed);
  }
  if (intent.expiresAt <= new Date()) {
    const expired = await db.retailPaymentIntent.update({
      where: { id: intent.id },
      data: { status: "expired", failureReason: "The card was not presented in time" },
    });
    return terminalIntentResponse(expired);
  }
  return terminalIntentResponse(intent, { cardNetwork: charge.cardNetwork, authCode: charge.authCode });
}

export async function cancelCardTerminalCharge({ shopId, intentId, userId, userRole }) {
  const intent = await db.retailPaymentIntent.findFirst({ where: { id: intentId, shopId } });
  if (!intent) throw new AppError("Card terminal charge not found", 404, "CARD_TERMINAL_CHARGE_NOT_FOUND");
  if (intent.checkoutMode !== "terminal") throw new AppError("This payment is not a card terminal charge", 409, "CARD_TERMINAL_WRONG_MODE");
  if (!["owner", "admin"].includes(userRole) && intent.createdByUserId && intent.createdByUserId !== userId) {
    throw new AppError("Only the cashier who started this charge can cancel it", 403, "RETAIL_PAYMENT_INTENT_FORBIDDEN");
  }
  if (intent.status === "confirmed") throw new AppError("An approved card payment cannot be cancelled from checkout", 409, "RETAIL_PAYMENT_ALREADY_CONFIRMED");
  if (intent.providerOrderId && OPEN_STATUSES.includes(intent.status)) {
    await getCardTerminalProvider().cancelCharge(intent.providerOrderId);
  }
  const updated = await db.retailPaymentIntent.update({
    where: { id: intent.id },
    data: { status: "cancelled", failureReason: "Cancelled by cashier before approval" },
  });
  return terminalIntentResponse(updated);
}
