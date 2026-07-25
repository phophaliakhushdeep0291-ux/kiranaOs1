/** Shared helpers for the one-year shop simulation. */

export const BASE = process.env.SIM_API ?? "http://localhost:3010/api";
export const OWNER_PIN = "4291";

// ── deterministic RNG (mulberry32) ─────────────────────────────────
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const between = (rng, lo, hi) => lo + rng() * (hi - lo);
export const intBetween = (rng, lo, hi) => Math.floor(between(rng, lo, hi + 1));
export function weightedPick(rng, items, weightOf) {
  let total = 0;
  for (const item of items) total += weightOf(item);
  let roll = rng() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

// ── money (mirrors backend src/utils/money.js exactly) ──────────────
export const toPaise = (v) => Math.round(v * 100);
export const r2 = (v) => toPaise(v) / 100;

// ── dates ──────────────────────────────────────────────────────────
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const atTime = (d, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);

// ── HTTP ───────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(status, body, method, path) {
    super(`${method} ${path} → ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export function makeClient({ token = null, deviceId = "sim-owner-device", pin = OWNER_PIN } = {}) {
  const state = { token, deviceId, pin, calls: 0, errors: 0 };
  async function call(method, path, body, extraHeaders = {}) {
    const headers = { "content-type": "application/json", "x-device-id": state.deviceId, ...extraHeaders };
    if (state.token) headers.authorization = `Bearer ${state.token}`;
    if (state.pin) headers["x-owner-pin"] = state.pin;
    state.calls += 1;
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (!res.ok) {
      state.errors += 1;
      throw new ApiError(res.status, parsed, method, path);
    }
    return parsed?.data !== undefined ? parsed.data : parsed;
  }
  return {
    state,
    get: (p, h) => call("GET", p, undefined, h),
    post: (p, b, h) => call("POST", p, b, h),
    patch: (p, b, h) => call("PATCH", p, b, h),
    put: (p, b, h) => call("PUT", p, b, h),
    del: (p, b, h) => call("DELETE", p, b, h),
    setToken: (t) => { state.token = t; },
  };
}

// ── unit conversion (mirrors backend units util for the modes we use) ─
export function baseUnitsFor(mode) {
  if (mode === "loose") return { baseUnit: "g", rateUnit: "kg", displayUnit: "kg", factor: 1000, isLoose: true };
  if (mode === "loose-ml") return { baseUnit: "ml", rateUnit: "l", displayUnit: "l", factor: 1000, isLoose: true };
  return { baseUnit: "piece", rateUnit: "piece", displayUnit: "piece", factor: 1, isLoose: false };
}

export function fmtINR(n) {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${v < 0 ? "-" : ""}₹${grouped}`;
}
