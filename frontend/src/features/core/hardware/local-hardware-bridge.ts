const TOKEN_KEY = "kirana:hardware-bridge-token:v1";
const DEFAULT_TIMEOUT_MS = 4_000;

export interface HardwareBridgeHealth {
  ok: boolean;
  version?: string;
  deviceName?: string;
  capabilities?: { print?: boolean; cutter?: boolean; cashDrawer?: boolean; scale?: boolean; customerDisplay?: boolean };
  update?: { available?: boolean; currentVersion?: string; latestVersion?: string; downloadUrl?: string };
}

export interface HardwareScaleReading {
  ok: boolean;
  weight: number;
  unit: "g" | "kg";
  stable?: boolean;
}

export interface HardwareCustomerDisplayState {
  revision: number;
  state: "idle" | "sale" | "paid" | "cancelled";
  itemCount: number;
  totalPaise: number;
}

const KILOGRAM_UNITS = new Set(["kg", "kilogram", "kilograms", "kilo", "kilos"]);
const GRAM_UNITS = new Set(["g", "gram", "grams"]);

export function isScaleBillingUnit(unit: string | null | undefined) {
  const normalized = String(unit || "").trim().toLowerCase();
  return KILOGRAM_UNITS.has(normalized) || GRAM_UNITS.has(normalized);
}

export function scaleReadingToBillingQuantity(reading: Pick<HardwareScaleReading, "weight" | "unit" | "stable">, billingUnit: string) {
  if (reading.stable === false) throw new Error("The scale reading is not stable yet. Let the item settle and read again.");
  const weight = Number(reading.weight);
  if (!Number.isFinite(weight) || weight <= 0) throw new Error("The scale returned an invalid or empty weight.");
  const grams = reading.unit === "kg" ? weight * 1000 : weight;
  if (grams > 1_000_000) throw new Error("The scale reading exceeds the supported 1,000 kg safety limit.");
  const normalized = billingUnit.trim().toLowerCase();
  const quantity = KILOGRAM_UNITS.has(normalized) ? grams / 1000 : GRAM_UNITS.has(normalized) ? grams : Number.NaN;
  if (!Number.isFinite(quantity)) throw new Error(`Scale quantity cannot be applied to billing unit "${billingUnit}".`);
  return Math.round((quantity + Number.EPSILON) * 1000) / 1000;
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

export async function pairHardwareBridge(bridgeUrl: string, pairingCode: string) {
  const code = pairingCode.trim().toUpperCase();
  if (!/^[2-9A-HJ-NP-Z]{6}$/.test(code)) throw new Error("Enter the 6-character code shown in Hardware Bridge Setup.");
  const base = normalizeHardwareBridgeUrl(bridgeUrl);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({})) as { token?: string; message?: string };
    if (!response.ok) throw new Error(body.message || "Pairing was not completed.");
    if (typeof body.token !== "string" || body.token.length < 32) throw new Error("The bridge returned an invalid device credential.");
    setHardwareBridgeToken(body.token);
    return checkHardwareBridge(base);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Hardware bridge did not respond in time.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
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
  const reading = await bridgeRequest<HardwareScaleReading>(bridgeUrl, "/v1/scale/read", { method: "POST", body: "{}" });
  if (!reading.ok || !Number.isFinite(Number(reading.weight)) || !["g", "kg"].includes(reading.unit)) {
    throw new Error("Hardware bridge returned an invalid scale reading.");
  }
  return { ...reading, weight: Number(reading.weight) };
}

export async function showCustomerDisplayViaHardwareBridge(bridgeUrl: string, input: HardwareCustomerDisplayState) {
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new Error("Customer display revision is invalid.");
  if (!Number.isInteger(input.itemCount) || input.itemCount < 0 || input.itemCount > 9_999) throw new Error("Customer display item count is invalid.");
  if (!Number.isSafeInteger(input.totalPaise) || input.totalPaise < 0) throw new Error("Customer display total is invalid.");
  return bridgeRequest<{ ok: boolean; stale?: boolean; revision?: number }>(bridgeUrl, "/v1/customer-display/show", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
