// src/lib/api.js — the ONLY place that talks to the backend
//
// Design notes:
//   - Every request carries Authorization + X-Device-Id
//   - deviceId is stable per browser (persisted in localStorage)
//   - Login flow follows the bug-#1-fixed contract:
//       POST /api/auth/login { mobile, password, deviceId, deviceName, platform }
//     then POST /api/devices/activate {deviceId, deviceName, platform}
//   - Every mutating call generates an idempotencyKey (uuid v4) that the caller
//     can re-use on retry — matches the backend's unique-index-based wall

import axios from "axios";

const API_BASE = import.meta.env.REACT_APP_API_BASE || "http://localhost:3300";

// ── stable device identity ──────────────────────────────────────────────
const DEVICE_KEY = "kiranaos.deviceId";
export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `web-${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

// ── token storage ───────────────────────────────────────────────────────
const TOKEN_KEY = "kiranaos.token";
export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }

// ── axios client ────────────────────────────────────────────────────────
export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((cfg) => {
  const token = getToken();
  cfg.headers = cfg.headers || {};
  if (token) cfg.headers["Authorization"] = `Bearer ${token}`;
  cfg.headers["X-Device-Id"] = getDeviceId();
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // Structured error envelope from backend: { success: false, code, error }
    const body = err.response?.data;
    if (err.response?.status === 401 || body?.code === "SESSION_DEVICE_MISMATCH" || body?.code === "SESSION_REVOKED") {
      // hard logout — token was killed on the server
      setToken(null);
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

// ── helpers ─────────────────────────────────────────────────────────────
export const uuid = () => crypto.randomUUID();

// paise → rupees (server returns *Paise fields for money; we format for display)
export const fromPaise = (p) => (Number(p || 0) / 100);
export const inr = (rupees) => `₹${Number(rupees || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// ── auth ────────────────────────────────────────────────────────────────
export async function login(mobile, password) {
  const deviceId = getDeviceId();
  const deviceName = navigator.userAgent.slice(0, 40);
  const platform = "web";
  const { data } = await api.post("/api/auth/login", { mobile, password, deviceId, deviceName, platform });
  if (!data?.success) throw new Error(data?.error || "Login failed");
  setToken(data.data.accessToken);
  // Immediately activate the device (bills/sync endpoints require it)
  try {
    await api.post("/api/devices/activate", { deviceId, deviceName, platform });
  } catch (_) { /* already activated → fine */ }
  return data.data;
}
export async function logout() {
  try { await api.post("/api/auth/logout"); } catch (_) { /* ignore */ }
  setToken(null);
}
export async function me() {
  const { data } = await api.get("/api/auth/me");
  return data.data;
}

// ── products & customers ────────────────────────────────────────────────
export async function listProducts() {
  const { data } = await api.get("/api/products");
  return data?.data?.items ?? data?.data ?? [];
}
export async function listCustomers() {
  const { data } = await api.get("/api/customers");
  return data?.data?.items ?? data?.data ?? [];
}

// ── billing (uses idempotencyKey — matches the sacred R1/R2 invariants) ─
export async function confirmBill(payload) {
  const idempotencyKey = payload.idempotencyKey ?? uuid();
  const body = { ...payload, idempotencyKey, clientBillId: idempotencyKey };
  const { data } = await api.post("/api/bills/confirm", body);
  if (!data?.success) throw new Error(data?.error || "Bill failed");
  return data.data;
}
export async function listBills(limit = 20) {
  const { data } = await api.get(`/api/bills?limit=${limit}`);
  return data?.data?.items ?? data?.data ?? [];
}

// ── udhar repayment (uses the /api/udhar/pay alias added in preview bug #2) ─
export async function recordUdharPayment({ customerId, amount, mode = "cash", note }) {
  const idempotencyKey = uuid();
  const { data } = await api.post("/api/udhar/pay", { customerId, amount, mode, note, clientLedgerId: idempotencyKey });
  if (!data?.success) throw new Error(data?.error || "Repayment failed");
  return data.data;
}
export async function udharSummary() {
  const { data } = await api.get("/api/udhar/summary");
  return data?.data ?? {};
}

// ── reports (the ONE truth layer — used by dashboard + reports both) ────
export async function dailySales(fromISO, toISO) {
  const { data } = await api.get(`/api/reports/sales-summary?from=${fromISO}&to=${toISO}`);
  return data?.data ?? {};
}
export async function paymentModes(fromISO, toISO) {
  const { data } = await api.get(`/api/reports/payment-modes?from=${fromISO}&to=${toISO}`);
  return data?.data ?? {};
}
