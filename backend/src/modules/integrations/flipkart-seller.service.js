import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";

let tokenCache = null;
const configured = () => Boolean(env.FLIPKART_SELLER_API_ENABLED && env.FLIPKART_APP_ID && env.FLIPKART_APP_SECRET);

export function flipkartStatus() {
  return { enabled: env.FLIPKART_SELLER_API_ENABLED, configured: configured(), mode: "self_access", officialDocuments: configured() };
}

async function accessToken() {
  if (!configured()) throw new AppError("Flipkart Seller API credentials are not configured", 503, "FLIPKART_NOT_CONFIGURED");
  if (tokenCache?.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const credentials = Buffer.from(`${env.FLIPKART_APP_ID}:${env.FLIPKART_APP_SECRET}`).toString("base64");
  const url = new URL("/oauth-service/oauth/token", env.FLIPKART_API_BASE_URL);
  url.searchParams.set("grant_type", "client_credentials"); url.searchParams.set("scope", "Seller_Api");
  let response;
  try { response = await fetch(url, { headers: { authorization: `Basic ${credentials}` }, signal: AbortSignal.timeout(env.FLIPKART_API_TIMEOUT_MS) }); }
  catch (error) { throw new AppError(`Could not reach Flipkart authentication: ${error.message}`, 502, "FLIPKART_AUTH_UNREACHABLE"); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new AppError(body.error_description || "Flipkart authentication failed", 502, "FLIPKART_AUTH_FAILED");
  tokenCache = { value: body.access_token, expiresAt: Date.now() + Math.max(60, Number(body.expires_in || 3600)) * 1000 };
  return tokenCache.value;
}

export async function downloadFlipkartDocument(shipmentId, kind) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(shipmentId)) throw new AppError("Invalid Flipkart shipment ID", 400, "FLIPKART_SHIPMENT_ID_INVALID");
  const path = kind === "invoice" ? `/sellers/v3/shipments/${shipmentId}/invoices` : `/sellers/v3/shipments/${shipmentId}/labelOnly/pdf`;
  const token = await accessToken();
  let response;
  try { response = await fetch(new URL(path, env.FLIPKART_API_BASE_URL), { method: kind === "label" ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, accept: "application/pdf" }, signal: AbortSignal.timeout(env.FLIPKART_API_TIMEOUT_MS) }); }
  catch (error) { throw new AppError(`Could not reach Flipkart: ${error.message}`, 502, "FLIPKART_API_UNREACHABLE"); }
  if (response.status === 401) tokenCache = null;
  if (!response.ok) throw new AppError(`Flipkart rejected the document request (${response.status})`, 502, "FLIPKART_DOCUMENT_REJECTED");
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/pdf")) throw new AppError("Flipkart did not return a PDF", 502, "FLIPKART_DOCUMENT_INVALID");
  return Buffer.from(await response.arrayBuffer());
}
