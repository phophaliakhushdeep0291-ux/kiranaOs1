import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";

/**
 * Card/EDC terminal seam.
 *
 * A counter card machine is driven the same way as a dynamic UPI QR: the POS
 * asks for a charge, the customer taps or dips on the terminal, and the POS
 * polls until the acquirer says the money moved. Nothing is ever confirmed from
 * what the terminal screen appears to say — only from a provider read.
 *
 * ── Implementing a real vendor ────────────────────────────────────────────────
 * Add a module exposing the four calls below and register it in PROVIDERS.
 * Every call must be safe to retry: the cashier's tab polls, networks drop, and
 * a duplicated charge is a refund and an angry customer.
 *
 *   createCharge({ amountPaise, reference, idempotencyKey })
 *     -> { chargeId, status }
 *     Push the amount to the terminal. `reference` is our intent id; pass it to
 *     the vendor so their dashboard reconciles against our bills. `chargeId`
 *     must be stable and unique — it lands in RetailPaymentIntent.providerOrderId.
 *
 *   fetchCharge(chargeId)
 *     -> { status, amountPaise, paymentId, method, cardNetwork, authCode, failureReason }
 *     status is one of TERMINAL_STATUSES. Return the acquirer's own amount so
 *     the caller can refuse a charge that settled for the wrong money.
 *
 *   cancelCharge(chargeId) -> void
 *     Best effort. Cancelling an already-approved charge must throw, never
 *     silently succeed, or a paid bill would look cancellable.
 *
 *   describe() -> { provider, terminalId, requiresSignature }
 *
 * Vendor notes for whoever wires this up:
 *   - Pine Labs Plutus: cloud API is POST /UploadBilledTransaction then
 *     GetCloudBasedTxnStatus polling; the local Plutus Smart variant is an HTTP
 *     call to the terminal's own IP on the shop LAN, which would belong in the
 *     hardware bridge rather than here.
 *   - Ezetap: /api/2.0/payment/start then /api/2.0/payment/status.
 * Both are cloud-polled, which is why this seam lives backend-side alongside
 * the Razorpay flow and reuses RetailPaymentIntent.
 */

export const TERMINAL_STATUSES = Object.freeze(["pending", "approved", "declined", "cancelled", "failed"]);

function terminalNotConfigured() {
  return new AppError("No card terminal is configured for this counter", 503, "CARD_TERMINAL_NOT_CONFIGURED");
}

/** A vendor listed in config but not yet built must fail loudly and specifically. */
function unimplementedProvider(name) {
  const fail = () => {
    throw new AppError(
      `The ${name} card terminal integration is not implemented yet. Implement createCharge/fetchCharge/cancelCharge/describe in terminal.provider.js against the ${name} SDK.`,
      501,
      "CARD_TERMINAL_PROVIDER_NOT_IMPLEMENTED",
    );
  };
  return { createCharge: fail, fetchCharge: fail, cancelCharge: fail, describe: fail };
}

/**
 * In-memory terminal used by development and the automated suite. It models the
 * parts that actually break in the field — a charge that stays pending while the
 * customer fishes out a card, a decline, an expiry — without a bank.
 *
 * env.js refuses to boot in production with this selected.
 */
const simulatedCharges = new Map();

export const simulatedTerminalProvider = {
  createCharge({ amountPaise, reference, idempotencyKey }) {
    for (const existing of simulatedCharges.values()) {
      // Retrying the same request must not present the card twice.
      if (existing.idempotencyKey && existing.idempotencyKey === idempotencyKey) {
        return { chargeId: existing.chargeId, status: existing.status };
      }
    }
    const chargeId = `sim_${crypto.randomUUID()}`;
    simulatedCharges.set(chargeId, {
      chargeId,
      idempotencyKey,
      reference,
      amountPaise,
      status: "pending",
      paymentId: null,
      method: "card",
      cardNetwork: "SIMULATED",
      authCode: null,
      failureReason: null,
      createdAt: Date.now(),
    });
    return { chargeId, status: "pending" };
  },

  fetchCharge(chargeId) {
    const charge = simulatedCharges.get(chargeId);
    if (!charge) throw new AppError("Card terminal charge not found", 404, "CARD_TERMINAL_CHARGE_NOT_FOUND");
    return {
      status: charge.status,
      amountPaise: charge.amountPaise,
      paymentId: charge.paymentId,
      method: charge.method,
      cardNetwork: charge.cardNetwork,
      authCode: charge.authCode,
      failureReason: charge.failureReason,
    };
  },

  cancelCharge(chargeId) {
    const charge = simulatedCharges.get(chargeId);
    if (!charge) throw new AppError("Card terminal charge not found", 404, "CARD_TERMINAL_CHARGE_NOT_FOUND");
    if (charge.status === "approved") throw new AppError("An approved card charge cannot be cancelled from the counter", 409, "CARD_TERMINAL_ALREADY_APPROVED");
    charge.status = "cancelled";
  },

  describe() {
    return { provider: "simulated", terminalId: env.CARD_TERMINAL_ID || "SIMULATED-TERMINAL", requiresSignature: false };
  },

  /** Test-only hooks. Not part of the vendor interface. */
  __test: {
    settle(chargeId, outcome = "approved", overrides = {}) {
      const charge = simulatedCharges.get(chargeId);
      if (!charge) throw new Error(`Unknown simulated charge ${chargeId}`);
      charge.status = outcome;
      if (outcome === "approved") {
        charge.paymentId = overrides.paymentId ?? `simpay_${crypto.randomUUID()}`;
        charge.authCode = overrides.authCode ?? "000000";
      } else {
        charge.failureReason = overrides.failureReason ?? "Simulated decline";
      }
      if (overrides.amountPaise !== undefined) charge.amountPaise = overrides.amountPaise;
      return charge;
    },
    reset() { simulatedCharges.clear(); },
  },
};

const PROVIDERS = new Map([
  ["simulated", simulatedTerminalProvider],
  ["pine_labs", unimplementedProvider("Pine Labs")],
  ["ezetap", unimplementedProvider("Ezetap")],
]);

export function cardTerminalConfigured() {
  return env.CARD_TERMINAL_PROVIDER !== "none";
}

export function getCardTerminalProvider() {
  if (!cardTerminalConfigured()) throw terminalNotConfigured();
  const provider = PROVIDERS.get(env.CARD_TERMINAL_PROVIDER);
  if (!provider) throw terminalNotConfigured();
  return provider;
}

export function cardTerminalReadiness() {
  if (!cardTerminalConfigured()) return { provider: "none", configured: false, simulated: false, terminalId: null };
  const provider = PROVIDERS.get(env.CARD_TERMINAL_PROVIDER);
  const simulated = env.CARD_TERMINAL_PROVIDER === "simulated";
  let terminalId = null;
  // An unimplemented vendor still reports as unconfigured rather than throwing
  // during a readiness probe the billing screen makes on every load.
  try { terminalId = provider?.describe()?.terminalId ?? null; } catch { return { provider: env.CARD_TERMINAL_PROVIDER, configured: false, simulated, terminalId: null }; }
  return { provider: env.CARD_TERMINAL_PROVIDER, configured: true, simulated, terminalId };
}
