const TOKEN_KEY = "kirana:hardware-bridge-token:v1";
const DEFAULT_TIMEOUT_MS = 4_000;

export interface HardwareBridgeHealth {
  ok: boolean;
  version?: string;
  deviceName?: string;
  capabilities?: { print?: boolean; cutter?: boolean; cashDrawer?: boolean; scale?: boolean };
}

export function getHardwareBridgeToken() {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}

export function setHardwareBridgeToken(token: string) {
  try {
    const value = token.trim();
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* per-device credential is best effort */ }
}

export function normalizeHardwareBridgeUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a valid local bridge URL, for example http://127.0.0.1:17873"); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("Hardware bridge must run on this device (localhost only).");
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Hardware bridge URL must use HTTP or HTTPS.");
  if (url.username || url.password || url.search || url.hash) throw new Error("Hardware bridge URL cannot contain credentials, query parameters, or fragments.");
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

async function bridgeRequest<T>(bridgeUrl: string, path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const base = normalizeHardwareBridgeUrl(bridgeUrl);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = getHardwareBridgeToken();
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    let body: unknown = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 300) }; }
    if (!response.ok) throw new Error((body as { message?: string }).message || `Hardware bridge returned ${response.status}`);
    return body as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Hardware bridge did not respond in time.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function checkHardwareBridge(bridgeUrl: string) {
  const health = await bridgeRequest<HardwareBridgeHealth>(bridgeUrl, "/v1/health", { method: "GET", headers: {} });
  if (!health.ok) throw new Error("Hardware bridge is running but not ready.");
  return health;
}

export async function printHtmlViaHardwareBridge(bridgeUrl: string, input: { html: string; jobId: string; copies: number; paperSize: string; autoCut: boolean; cashDrawer: boolean }) {
  return bridgeRequest<{ ok: boolean; jobId?: string }>(bridgeUrl, "/v1/print", { method: "POST", body: JSON.stringify(input) }, 12_000);
}

export async function openCashDrawerViaHardwareBridge(bridgeUrl: string) {
  return bridgeRequest<{ ok: boolean }>(bridgeUrl, "/v1/cash-drawer/open", { method: "POST", body: JSON.stringify({ requestedAt: new Date().toISOString() }) });
}

export async function readScaleViaHardwareBridge(bridgeUrl: string) {
  return bridgeRequest<{ ok: boolean; weight: number; unit: "g" | "kg" }>(bridgeUrl, "/v1/scale/read", { method: "POST", body: "{}" });
}
