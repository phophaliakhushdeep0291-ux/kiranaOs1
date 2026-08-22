import { AppError } from "../../middleware/error.js";

const API_PATH = "/API/CloudBasedIntegration/V1";

function canonicalKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function field(record, ...names) {
  if (!record || typeof record !== "object") return undefined;
  const wanted = new Set(names.map(canonicalKey));
  return Object.entries(record).find(([key]) => wanted.has(canonicalKey(key)))?.[1];
}

function responseBody(payload) {
  if (!payload || typeof payload !== "object") return {};
  return field(payload, "Response") ?? payload;
}

function tagMap(payload) {
  const tags = field(payload, "TransactionData");
  if (!Array.isArray(tags)) return new Map();
  return new Map(tags
    .filter((item) => item && typeof item === "object")
    .map((item) => [canonicalKey(field(item, "Tag")), field(item, "Value")]));
}

function tag(tags, ...names) {
  for (const name of names) {
    const value = tags.get(canonicalKey(name));
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function integerPaise(value) {
  if (value === null || value === undefined || !/^\d+$/.test(String(value).trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function transactionReference(value) {
  const normalized = String(value ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
  if (!normalized) throw new AppError("Card terminal transaction reference is invalid", 500, "CARD_TERMINAL_INVALID_REFERENCE");
  return normalized;
}

function providerFailure(message, code = "CARD_TERMINAL_PROVIDER_REJECTED") {
  const safeMessage = String(message || "Pine Labs rejected the terminal request").slice(0, 300);
  return new AppError(safeMessage, 502, code);
}

/**
 * Pine Labs Plutus cloud adapter.
 *
 * Contract source (checked 2026-08-22):
 * https://developer.pinelabs.com/in/instore/cloud-integration
 *
 * Pine Labs accepts a bill, returns a PTRID, and exposes separate status and
 * cancellation reads. An upload acknowledgement never marks money as paid.
 * Only a later GetCloudBasedTxnStatus response containing an approved result,
 * an acquirer reference and the provider's own amount can confirm the intent.
 */
export function createPineLabsTerminalProvider({
  baseUrl,
  securityToken,
  merchantId,
  terminalId,
  storeId,
  locationCode,
  chargeTimeoutSeconds = 180,
  requestTimeoutMs = 8_000,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required for Pine Labs");

  const root = String(baseUrl || "").replace(/\/+$/, "");
  const credentials = {
    MerchantID: String(merchantId),
    SecurityToken: String(securityToken),
    ClientId: String(terminalId),
    StoreId: String(storeId),
  };

  async function post(endpoint, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(`${root}${API_PATH}/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response?.ok) {
        const status = Number(response?.status || 0);
        const ambiguous = status === 408 || status === 429 || status >= 500 || status === 0;
        throw providerFailure(
          `Pine Labs returned HTTP ${response?.status || "error"}`,
          ambiguous ? "CARD_TERMINAL_PROVIDER_UNAVAILABLE" : "CARD_TERMINAL_PROVIDER_REJECTED",
        );
      }
      let parsed;
      try {
        parsed = await response.json();
      } catch {
        throw providerFailure("Pine Labs returned a non-JSON terminal response", "CARD_TERMINAL_INVALID_RESPONSE");
      }
      return responseBody(parsed);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error?.name === "AbortError") throw providerFailure("Pine Labs terminal request timed out", "CARD_TERMINAL_PROVIDER_TIMEOUT");
      throw providerFailure("Pine Labs terminal service is unavailable", "CARD_TERMINAL_PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async createCharge({ amountPaise, reference, idempotencyKey }) {
      const transactionNumber = transactionReference(idempotencyKey || reference);
      const response = await post("UploadBilledTransaction", {
        ...credentials,
        TransactionNumber: transactionNumber,
        SequenceNumber: 1,
        AllowedPaymentMode: "1",
        Amount: Number(amountPaise),
        TotalInvoiceAmount: Number(amountPaise),
        AutoCancelDurationInMinutes: Math.max(1, Math.ceil(chargeTimeoutSeconds / 60)),
        TxnType: 0,
        ForceCancelOnBack: true,
      });
      const responseCode = Number(field(response, "ResponseCode"));
      const responseMessage = field(response, "ResponseMessage");
      const chargeId = field(response, "PlutusTransactionReferenceID");
      if (responseCode !== 0) throw providerFailure(responseMessage);
      if (!chargeId || String(chargeId) === "0") throw providerFailure("Pine Labs did not return a Plutus transaction reference", "CARD_TERMINAL_INVALID_RESPONSE");
      return { chargeId: String(chargeId), status: "pending" };
    },

    async fetchCharge(chargeId) {
      const response = await post("GetCloudBasedTxnStatus", {
        ...credentials,
        PlutusTransactionReferenceID: String(chargeId),
      });
      const responseCode = Number(field(response, "ResponseCode"));
      const responseMessage = String(field(response, "ResponseMessage") || "");
      const normalizedMessage = responseMessage.toLowerCase();

      if (responseCode !== 0) {
        if (normalizedMessage.includes("cancel")) return { status: "cancelled", failureReason: responseMessage };
        if (normalizedMessage.includes("declin") || normalizedMessage.includes("reject")) return { status: "declined", failureReason: responseMessage };
        // A newly uploaded PTRID can be briefly unavailable to the status read.
        // Keeping it pending is safer than inventing a decline; the local intent
        // still expires on its bounded timer.
        if (normalizedMessage.includes("not found") || normalizedMessage.includes("invalid plutus")) {
          return { status: "pending", failureReason: responseMessage };
        }
        return { status: "failed", failureReason: responseMessage || "Pine Labs status request failed" };
      }

      if (!normalizedMessage.includes("approved")) return { status: "pending", failureReason: null };

      const tags = tagMap(response);
      const paymentId = tag(tags, "TransactionLogId", "RRN");
      const amountPaise = integerPaise(tag(tags, "AmountInPaisa", "OriginalAmount"));
      return {
        status: "approved",
        amountPaise,
        paymentId,
        method: tag(tags, "PaymentMode") || "card",
        cardNetwork: tag(tags, "Card Type", "CardType", "Acquirer Name"),
        authCode: tag(tags, "ApprovalCode"),
        failureReason: null,
      };
    },

    async cancelCharge(chargeId, { amountPaise } = {}) {
      if (!Number.isSafeInteger(Number(amountPaise)) || Number(amountPaise) <= 0) {
        throw new AppError("The original paise amount is required to cancel a Pine Labs charge", 500, "CARD_TERMINAL_AMOUNT_REQUIRED");
      }
      const response = await post("CancelTransaction", {
        ...credentials,
        PlutusTransactionReferenceID: String(chargeId),
        Amount: Number(amountPaise),
      });
      if (Number(field(response, "ResponseCode")) !== 0) throw providerFailure(field(response, "ResponseMessage"));
    },

    describe() {
      return {
        provider: "pine_labs",
        terminalId: String(terminalId),
        storeId: String(storeId),
        locationCode: String(locationCode),
        requiresSignature: false,
      };
    },
  };
}
