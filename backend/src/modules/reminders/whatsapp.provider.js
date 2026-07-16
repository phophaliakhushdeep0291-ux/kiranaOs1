import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { buildWhatsAppWebhookUrl, requiredWebhookConfiguration } from "./whatsapp.webhook.js";

const PROVIDERS = new Set(["meta", "twilio", "gupshup", "interakt"]);
const OFFICIAL_PROVIDER_HOSTS = Object.freeze({
  meta: "graph.facebook.com",
  twilio: "api.twilio.com",
  gupshup: "api.gupshup.io",
  interakt: "api.interakt.ai",
});
const MAX_MESSAGE_LENGTH = 4096;
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;

function configuredBaseUrl(provider) {
  if (env.WHATSAPP_BASE_URL) return String(env.WHATSAPP_BASE_URL).replace(/\/+$/, "");
  if (provider === "twilio") return "https://api.twilio.com";
  if (provider === "gupshup") return "https://api.gupshup.io";
  if (provider === "interakt") return "https://api.interakt.ai";
  return null;
}

function requiredConfiguration(provider = env.WHATSAPP_PROVIDER) {
  if (provider === "disabled") return [];
  const missing = [];
  if (!env.WHATSAPP_API_KEY) missing.push("WHATSAPP_API_KEY");
  if (!env.WHATSAPP_SENDER_ID && provider !== "interakt") missing.push("WHATSAPP_SENDER_ID");
  if (!configuredBaseUrl(provider)) missing.push("WHATSAPP_BASE_URL");
  if (configuredBaseUrl(provider)) {
    try {
      const providerUrl = new URL(configuredBaseUrl(provider));
      if (providerUrl.protocol !== "https:" || providerUrl.hostname !== OFFICIAL_PROVIDER_HOSTS[provider]) {
        missing.push("WHATSAPP_BASE_URL_OFFICIAL_HTTPS_HOST_REQUIRED");
      }
    } catch {
      missing.push("WHATSAPP_BASE_URL");
    }
  }
  if (provider === "twilio" && !env.WHATSAPP_API_SECRET) missing.push("WHATSAPP_API_SECRET");
  if (provider === "gupshup" && !env.WHATSAPP_GUPSHUP_APP_NAME) missing.push("WHATSAPP_GUPSHUP_APP_NAME");
  if (provider === "interakt" && !env.WHATSAPP_TEMPLATE_NAME) missing.push("WHATSAPP_TEMPLATE_NAME");
  missing.push(...requiredWebhookConfiguration(provider));
  return missing;
}

export function getWhatsAppProviderStatus() {
  const provider = env.WHATSAPP_PROVIDER;
  const missing = requiredConfiguration(provider);
  const webhookMissing = requiredWebhookConfiguration(provider);
  return {
    provider,
    configured: provider !== "disabled" && PROVIDERS.has(provider) && missing.length === 0,
    sendConfigured: provider !== "disabled" && PROVIDERS.has(provider) && missing.filter((key) => !webhookMissing.includes(key)).length === 0,
    webhookConfigured: provider !== "disabled" && webhookMissing.length === 0,
    implemented: PROVIDERS.has(provider),
    missing,
  };
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) digits = `91${digits.slice(1)}`;
  if (digits.length < 11 || digits.length > 15) {
    const error = new Error("Recipient must be a valid international mobile number");
    error.code = "WHATSAPP_RECIPIENT_INVALID";
    throw error;
  }
  return digits;
}

function validateMessage(value) {
  const message = String(value || "").trim();
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    const error = new Error(`WhatsApp message must contain 1-${MAX_MESSAGE_LENGTH} characters`);
    error.code = "WHATSAPP_MESSAGE_INVALID";
    throw error;
  }
  return message;
}

function basic(value) {
  return `Basic ${Buffer.from(String(value), "utf8").toString("base64")}`;
}

function interaktPhone(recipient) {
  const defaultCountry = String(env.WHATSAPP_DEFAULT_COUNTRY_CODE || "+91").replace(/\D/g, "") || "91";
  if (recipient.startsWith(defaultCountry) && recipient.length > defaultCountry.length + 6) {
    return { countryCode: `+${defaultCountry}`, phoneNumber: recipient.slice(defaultCountry.length) };
  }
  const localLength = Math.min(10, recipient.length - 1);
  return { countryCode: `+${recipient.slice(0, -localLength)}`, phoneNumber: recipient.slice(-localLength) };
}

function metaRequest(recipient, message) {
  const templateName = String(env.WHATSAPP_TEMPLATE_NAME || "").trim();
  const body = templateName
    ? {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "template",
        template: {
          name: templateName,
          language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE },
          components: [{ type: "body", parameters: [{ type: "text", text: message }] }],
        },
      }
    : {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: { preview_url: false, body: message },
      };
  return {
    url: `${configuredBaseUrl("meta")}/${encodeURIComponent(env.WHATSAPP_SENDER_ID)}/messages`,
    options: {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WHATSAPP_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    messageId: (payload) => payload?.messages?.[0]?.id,
  };
}

function twilioRequest(recipient, message, reminderLogId) {
  const accountSid = String(env.WHATSAPP_API_KEY);
  const params = new URLSearchParams({
    To: `whatsapp:+${recipient}`,
    From: String(env.WHATSAPP_SENDER_ID).startsWith("whatsapp:") ? String(env.WHATSAPP_SENDER_ID) : `whatsapp:${env.WHATSAPP_SENDER_ID}`,
    StatusCallback: buildWhatsAppWebhookUrl("twilio", { query: { reminderLogId } }),
  });
  if (env.WHATSAPP_TEMPLATE_NAME) {
    params.set("ContentSid", env.WHATSAPP_TEMPLATE_NAME);
    params.set("ContentVariables", JSON.stringify({ 1: message }));
  } else {
    params.set("Body", message);
  }
  return {
    url: `${configuredBaseUrl("twilio")}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    options: {
      method: "POST",
      headers: { Authorization: basic(`${accountSid}:${env.WHATSAPP_API_SECRET}`), "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
    messageId: (payload) => payload?.sid,
  };
}

function gupshupRequest(recipient, message) {
  const params = new URLSearchParams({
    channel: "whatsapp",
    source: String(env.WHATSAPP_SENDER_ID).replace(/\D/g, ""),
    destination: recipient,
    "src.name": env.WHATSAPP_GUPSHUP_APP_NAME,
    message: JSON.stringify({ type: "text", text: message }),
  });
  return {
    url: `${configuredBaseUrl("gupshup")}/wa/api/v1/msg`,
    options: {
      method: "POST",
      headers: { apikey: env.WHATSAPP_API_KEY, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
    messageId: (payload) => payload?.messageId,
  };
}

function interaktRequest(recipient, message, reminderLogId) {
  const phone = interaktPhone(recipient);
  return {
    url: `${configuredBaseUrl("interakt")}/v1/public/message/`,
    options: {
      method: "POST",
      headers: { Authorization: `Basic ${env.WHATSAPP_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...phone,
        type: "Template",
        callbackData: String(reminderLogId || "kiranaos-reminder").slice(0, 512),
        template: {
          name: env.WHATSAPP_TEMPLATE_NAME,
          languageCode: env.WHATSAPP_TEMPLATE_LANGUAGE,
          bodyValues: [message],
        },
      }),
    },
    messageId: (payload) => payload?.id,
  };
}

function buildRequest(provider, recipient, message, reminderLogId) {
  if (provider === "meta") return metaRequest(recipient, message);
  if (provider === "twilio") return twilioRequest(recipient, message, reminderLogId);
  if (provider === "gupshup") return gupshupRequest(recipient, message);
  if (provider === "interakt") return interaktRequest(recipient, message, reminderLogId);
  const error = new Error("WhatsApp provider is unsupported");
  error.code = "WHATSAPP_PROVIDER_UNSUPPORTED";
  throw error;
}

async function providerPayload(response) {
  const text = (await response.text()).slice(0, MAX_PROVIDER_RESPONSE_BYTES);
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

export async function sendWhatsAppMessage({ to, message, shopId, customerId, reminderLogId }) {
  const provider = env.WHATSAPP_PROVIDER;
  const status = getWhatsAppProviderStatus();
  if (provider === "disabled") {
    return { success: false, status: "skipped", code: "WHATSAPP_PROVIDER_NOT_CONFIGURED", provider: "disabled" };
  }
  if (!status.configured) {
    return { success: false, status: "failed", code: "WHATSAPP_PROVIDER_NOT_CONFIGURED", provider, missing: status.missing };
  }

  try {
    const recipient = normalizePhone(to);
    const safeMessage = validateMessage(message);
    const request = buildRequest(provider, recipient, safeMessage, reminderLogId);
    const response = await fetch(request.url, {
      ...request.options,
      redirect: "error",
      signal: AbortSignal.timeout(env.INTEGRATION_WEBHOOK_TIMEOUT_MS),
    });
    const payload = await providerPayload(response);
    const providerMessageId = request.messageId(payload);
    if (!response.ok || !providerMessageId) {
      const code = response.ok ? "WHATSAPP_PROVIDER_RESPONSE_INVALID" : `WHATSAPP_PROVIDER_HTTP_${response.status}`;
      logger.warn({
        type: "whatsapp_provider_rejected",
        shopId,
        customerId,
        reminderLogId,
        provider,
        statusCode: response.status,
        errorCode: code,
        responseBodyPresent: Object.keys(payload).length > 0,
        toMasked: "[REDACTED]",
      });
      return { success: false, status: "failed", code, provider };
    }
    logger.info({ type: "whatsapp_provider_accepted", shopId, customerId, reminderLogId, provider, providerMessageId, toMasked: "[REDACTED]" });
    return { success: true, status: "accepted", provider, providerMessageId: String(providerMessageId), acceptedAt: new Date().toISOString() };
  } catch (error) {
    const code = error?.code || (error?.name === "TimeoutError" ? "WHATSAPP_PROVIDER_TIMEOUT" : "WHATSAPP_PROVIDER_REQUEST_FAILED");
    logger.warn({ type: "whatsapp_provider_error", shopId, customerId, reminderLogId, provider, errorCode: code, toMasked: "[REDACTED]" });
    return { success: false, status: "failed", code, provider };
  }
}

export const __whatsAppProviderInternals = {
  buildRequest,
  configuredBaseUrl,
  interaktPhone,
  normalizePhone,
  requiredConfiguration,
  validateMessage,
};
