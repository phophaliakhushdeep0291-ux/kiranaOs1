import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

export function getWhatsAppProviderStatus() {
  return {
    provider: env.WHATSAPP_PROVIDER,
    configured: env.WHATSAPP_PROVIDER !== "disabled" && Boolean(env.WHATSAPP_API_KEY && env.WHATSAPP_SENDER_ID),
    implemented: false,
  };
}

export async function sendWhatsAppMessage({ to, message, shopId, customerId, reminderLogId }) {
  const status = getWhatsAppProviderStatus();
  if (env.WHATSAPP_PROVIDER === "disabled") {
    return { success: false, status: "skipped", code: "WHATSAPP_PROVIDER_NOT_CONFIGURED", provider: "disabled" };
  }
  if (!status.configured) {
    return { success: false, status: "failed", code: "WHATSAPP_PROVIDER_NOT_CONFIGURED", provider: env.WHATSAPP_PROVIDER };
  }

  logger.warn({
    type: "whatsapp_provider_not_implemented",
    shopId,
    customerId,
    reminderLogId,
    provider: env.WHATSAPP_PROVIDER,
    messageLength: String(message || "").length,
    toMasked: to ? "[REDACTED]" : null,
  });

  // Provider adapters for Meta/Twilio/Gupshup/Interakt should be implemented in a later phase.
  // Do not fake sent: configured-but-not-implemented returns failure.
  return { success: false, status: "failed", code: "WHATSAPP_PROVIDER_NOT_IMPLEMENTED", provider: env.WHATSAPP_PROVIDER };
}
