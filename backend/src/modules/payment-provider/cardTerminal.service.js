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
const AMBIGUOUS_START_CODES = new Set([
  "CARD_TERMINAL_PROVIDER_TIMEOUT",
  "CARD_TERMINAL_PROVIDER_UNAVAILABLE",
  "CARD_TERMINAL_INVALID_RESPONSE",
]);

export function isAmbiguousTerminalStartError(error) {
  return AMBIGUOUS_START_CODES.has(error?.code);
}

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
    requiresReconciliation: intent.status === "uncertain",
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

export function assertCardTerminalLocation(location, terminalLocationCode) {
  if (!terminalLocationCode) return;
  if (String(terminalLocationCode).trim().toLowerCase() === String(location?.code ?? "").trim().toLowerCase()) return;
  throw new AppError(
    `This card terminal is assigned to branch ${terminalLocationCode}, not ${location?.code || "the selected branch"}`,
    409,
    "CARD_TERMINAL_LOCATION_MISMATCH",
  );
}

function assertMatchingTerminalRetry(intent, { locationId, amountPaise }) {
  if (
    intent.checkoutMode !== "terminal"
    || intent.locationId !== locationId
    || Number(intent.amountPaise) !== Number(amountPaise)
    || intent.provider !== env.CARD_TERMINAL_PROVIDER
  ) {
    throw new AppError("This card-terminal request ID was already used for a different charge", 409, "CARD_TERMINAL_REQUEST_REUSED");
  }
}

export async function startCardTerminalCharge({ shopId, requestedLocationId, userId, amountPaise, requestId }) {
  const provider = getCardTerminalProvider();
  const location = await resolveOperationalLocation(shopId, requestedLocationId);
  const terminalLocationCode = provider.describe()?.locationCode;
  assertCardTerminalLocation(location, terminalLocationCode);

  if (requestId) {
    const retriedIntent = await db.retailPaymentIntent.findFirst({ where: { id: requestId, shopId } });
    if (retriedIntent) {
      assertMatchingTerminalRetry(retriedIntent, { locationId: location.id, amountPaise });
      return terminalIntentResponse(retriedIntent, { locationName: location.name });
    }
  }

  // One physical terminal cannot safely accept another bill while a previous
  // upload may already have reached the provider. The owner must reconcile the
  // unknown outcome against the terminal/provider record first.
  const unresolved = await db.retailPaymentIntent.findFirst({
    where: { shopId, locationId: location.id, checkoutMode: "terminal", status: "uncertain" },
    orderBy: { createdAt: "desc" },
  });
  if (unresolved) {
    return terminalIntentResponse(unresolved, { locationName: location.name });
  }

  const expiresAt = new Date(Date.now() + env.CARD_TERMINAL_CHARGE_TIMEOUT_SECONDS * 1_000);
  const intent = await db.retailPaymentIntent.create({
    data: {
      ...(requestId ? { id: requestId } : {}),
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
    const ambiguous = isAmbiguousTerminalStartError(error);
    const updated = await db.retailPaymentIntent.update({
      where: { id: intent.id },
      data: {
        status: ambiguous ? "uncertain" : "failed",
        failureReason: String(error?.message || "Card terminal charge could not be started").slice(0, 500),
      },
    }).catch(() => null);
    if (ambiguous && updated) return terminalIntentResponse(updated, { locationName: location.name });
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
  if (intent.status === "uncertain") {
    throw new AppError("This charge may already have reached the bank. Reconcile it instead of cancelling or retrying.", 409, "CARD_TERMINAL_RECONCILIATION_REQUIRED");
  }
  if (intent.providerOrderId && OPEN_STATUSES.includes(intent.status)) {
    await getCardTerminalProvider().cancelCharge(intent.providerOrderId, { amountPaise: intent.amountPaise });
  }
  const updated = await db.retailPaymentIntent.update({
    where: { id: intent.id },
    data: { status: "cancelled", failureReason: "Cancelled by cashier before approval" },
  });
  return terminalIntentResponse(updated);
}

export async function reconcileCardTerminalCharge({ shopId, intentId, userId, deviceId, outcome, providerPaymentId, reason }) {
  const intent = await db.retailPaymentIntent.findFirst({ where: { id: intentId, shopId } });
  if (!intent) throw new AppError("Card terminal charge not found", 404, "CARD_TERMINAL_CHARGE_NOT_FOUND");
  if (intent.checkoutMode !== "terminal") throw new AppError("This payment is not a card terminal charge", 409, "CARD_TERMINAL_WRONG_MODE");
  if (intent.status !== "uncertain") throw new AppError("Only a charge with an unknown bank outcome can be reconciled", 409, "CARD_TERMINAL_NOT_UNCERTAIN");

  const cleanReason = String(reason || "").trim();
  const cleanPaymentId = String(providerPaymentId || "").trim();
  if (outcome === "charged" && !cleanPaymentId) {
    throw new AppError("Provider payment reference is required when the card was charged", 400, "CARD_TERMINAL_PAYMENT_REFERENCE_REQUIRED");
  }

  return db.$transaction(async (tx) => {
    if (outcome === "charged") {
      const duplicate = await tx.retailPaymentIntent.findFirst({ where: { providerPaymentId: cleanPaymentId, id: { not: intent.id } }, select: { id: true } });
      if (duplicate) throw new AppError("That provider payment reference is already attached to another charge", 409, "CARD_TERMINAL_PAYMENT_REFERENCE_REUSED");
    }
    const updated = await tx.retailPaymentIntent.update({
      where: { id: intent.id },
      data: outcome === "charged"
        ? {
            status: "confirmed",
            providerPaymentId: cleanPaymentId,
            confirmedAt: new Date(),
            confirmationSource: "owner_provider_reconciliation",
            failureReason: null,
          }
        : {
            status: "failed",
            failureReason: `Owner verified not charged: ${cleanReason}`.slice(0, 500),
          },
    });
    await tx.auditLog.create({
      data: {
        shopId,
        userId: userId ?? null,
        deviceId: deviceId ?? null,
        module: "payments",
        action: "CARD_TERMINAL_UNCERTAIN_RECONCILED",
        entityType: "RetailPaymentIntent",
        entityId: intent.id,
        beforeJson: JSON.stringify({ status: intent.status, amountPaise: intent.amountPaise, locationId: intent.locationId }),
        afterJson: JSON.stringify({ status: updated.status, confirmationSource: updated.confirmationSource }),
        metadataJson: JSON.stringify({ outcome, reason: cleanReason, providerPaymentId: cleanPaymentId || null }),
        result: "success",
      },
    });
    return terminalIntentResponse(updated);
  });
}
