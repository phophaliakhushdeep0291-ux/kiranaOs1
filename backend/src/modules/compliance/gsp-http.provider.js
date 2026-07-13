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
  return submitDocumentToGsp(payload, { idempotencyKey, path: env.GST_PROVIDER_EINVOICE_PATH, referenceNames: ["irn", "Irn", "IRN"], referenceLabel: "GSTN IRN" });
}

export async function submitEWayBillToGsp(payload, { idempotencyKey }) {
  return submitDocumentToGsp(payload, { idempotencyKey, path: env.GST_PROVIDER_EWAY_PATH, referenceNames: ["ewayBillNo", "ewbNo", "EwbNo", "EWayBillNo"], referenceLabel: "e-way bill number" });
}

async function submitDocumentToGsp(payload, { idempotencyKey, path, referenceNames, referenceLabel }) {
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
    const response = await fetch(providerUrl(path), {
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
    const externalReference = referenceNames.map((name) => data?.[name]).find(Boolean) ?? null;
    const acknowledgementNo = data?.acknowledgementNo ?? data?.ackNo ?? data?.AckNo ?? data?.ack_no ?? externalReference;
    if (!externalReference) {
      const error = new AppError(`GSP response did not contain a ${referenceLabel}`, 502, "GST_PROVIDER_INVALID_RESPONSE");
      error.providerResponse = body;
      throw error;
    }
    return { externalReference: String(externalReference), acknowledgementNo: String(acknowledgementNo), response: body };
  } catch (error) {
    if (error?.name === "AbortError") throw new AppError("GSP request timed out", 504, "GST_PROVIDER_TIMEOUT");
    if (error instanceof AppError) throw error;
    throw new AppError("GSP could not be reached", 502, "GST_PROVIDER_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}
