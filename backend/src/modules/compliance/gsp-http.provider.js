import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";

function providerUrl(path) {
  return new URL(path, `${env.GST_PROVIDER_BASE_URL.replace(/\/$/, "")}/`).toString();
}

function readProviderError(body, fallback) {
  return body?.message ?? body?.error?.message ?? body?.error ?? fallback;
}

export function gspHttpReadiness() {
  const configured = Boolean(env.GST_PROVIDER_BASE_URL && env.GST_PROVIDER_API_KEY && env.GST_PROVIDER_LEGAL_NAME);
  return {
    mode: env.GST_PROVIDER,
    providerName: env.GST_PROVIDER_LEGAL_NAME ?? null,
    configured,
    certified: Boolean(env.GST_PROVIDER_CERTIFIED),
    legalSubmission: configured && Boolean(env.GST_PROVIDER_CERTIFIED),
  };
}

export async function submitEInvoiceToGsp(payload, { idempotencyKey }) {
  const readiness = gspHttpReadiness();
  if (!readiness.legalSubmission) {
    throw new AppError(
      "Certified GSP submission is not configured. No legal IRN was requested.",
      503,
      "GST_LEGAL_PROVIDER_NOT_READY",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.GST_PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(providerUrl(env.GST_PROVIDER_EINVOICE_PATH), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${env.GST_PROVIDER_API_KEY}`,
        "x-api-key": env.GST_PROVIDER_API_KEY,
        ...(env.GST_PROVIDER_API_SECRET && { "x-api-secret": env.GST_PROVIDER_API_SECRET }),
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 4000) }; }
    if (!response.ok) {
      const error = new AppError(readProviderError(body, `GSP rejected the request (${response.status})`), 502, "GST_PROVIDER_REJECTED");
      error.providerResponse = body;
      throw error;
    }

    const data = body?.data ?? body?.result ?? body;
    const irn = data?.irn ?? data?.Irn ?? data?.IRN ?? null;
    const acknowledgementNo = data?.acknowledgementNo ?? data?.ackNo ?? data?.AckNo ?? data?.ack_no ?? irn;
    if (!irn) {
      const error = new AppError("GSP response did not contain a GSTN IRN", 502, "GST_PROVIDER_INVALID_RESPONSE");
      error.providerResponse = body;
      throw error;
    }
    return { irn: String(irn), acknowledgementNo: String(acknowledgementNo), response: body };
  } catch (error) {
    if (error?.name === "AbortError") throw new AppError("GSP request timed out", 504, "GST_PROVIDER_TIMEOUT");
    if (error instanceof AppError) throw error;
    throw new AppError("GSP could not be reached", 502, "GST_PROVIDER_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}
