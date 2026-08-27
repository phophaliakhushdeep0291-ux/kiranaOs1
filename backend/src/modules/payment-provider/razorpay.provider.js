import crypto from "crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

export function isRazorpayConfigured() {
  return !!(env.RAZORPAY_ENABLED && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

export function assertRazorpayConfigured() {
  if (!isRazorpayConfigured()) {
    const err = new AppError("Razorpay is not configured", 503);
    err.code = "RAZORPAY_NOT_CONFIGURED";
    throw err;
  }
}

export function getRazorpayCheckoutKeyId() {
  return env.RAZORPAY_KEY_ID || null;
}

export async function verifyRazorpayCredentials(credentials) {
  const keyId = String(credentials?.keyId || "");
  const keySecret = String(credentials?.keySecret || "");
  if (!keyId || !keySecret) throw new AppError("Razorpay credentials are incomplete", 400, "PAYMENT_CREDENTIALS_INCOMPLETE");
  await razorpayRequest("/orders?count=1", { method: "GET" }, { keyId, keySecret });
  return { accountReachable: true };
}

export async function createRazorpayOrder({ amountPaise, currency = "INR", receipt, notes = {} }, credentials = null) {
  if (!credentials) assertRazorpayConfigured();
  const payload = {
    amount: amountPaise,
    currency,
    receipt,
    notes: sanitizeNotes(notes),
  };
  return razorpayRequest("/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  }, credentials);
}

export async function fetchRazorpayPayment(paymentId, credentials = null) {
  if (!credentials) assertRazorpayConfigured();
  if (!paymentId) throw new AppError("Razorpay payment id is required", 400);
  return razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET" }, credentials);
}

export async function fetchRazorpayOrder(orderId, credentials = null) {
  if (!credentials) assertRazorpayConfigured();
  if (!orderId) throw new AppError("Razorpay order id is required", 400);
  return razorpayRequest(`/orders/${encodeURIComponent(orderId)}`, { method: "GET" }, credentials);
}

export async function fetchRazorpayOrderByReceipt(receipt) {
  assertRazorpayConfigured();
  if (!receipt) throw new AppError("Razorpay order receipt is required", 400);
  const result = await razorpayRequest(`/orders?receipt=${encodeURIComponent(receipt)}&count=10`, { method: "GET" });
  const items = Array.isArray(result?.items) ? result.items : [];
  return items.find((order) => order?.receipt === receipt) ?? null;
}

export async function createRazorpayQrCode({ amountPaise, name, description, closeBy, notes = {} }, credentials = null) {
  if (!credentials) assertRazorpayConfigured();
  return razorpayRequest("/payments/qr_codes", {
    method: "POST",
    body: JSON.stringify({
      type: "upi_qr",
      name: String(name || "KiranaOS counter").slice(0, 64),
      usage: "single_use",
      fixed_amount: true,
      payment_amount: amountPaise,
      description: String(description || "KiranaOS retail payment").slice(0, 120),
      close_by: closeBy,
      notes: sanitizeNotes(notes),
    }),
  }, credentials);
}

export async function fetchRazorpayQrCode(qrCodeId, credentials = null) {
  if (!credentials) assertRazorpayConfigured();
  if (!qrCodeId) throw new AppError("Razorpay QR code id is required", 400);
  return razorpayRequest(`/payments/qr_codes/${encodeURIComponent(qrCodeId)}`, { method: "GET" }, credentials);
}

export async function fetchRazorpayQrCodePayments(qrCodeId, credentials = null) {
  if (!credentials) assertRazorpayConfigured();
  if (!qrCodeId) throw new AppError("Razorpay QR code id is required", 400);
  return razorpayRequest(`/payments/qr_codes/${encodeURIComponent(qrCodeId)}/payments?count=10`, { method: "GET" }, credentials);
}

export async function closeRazorpayQrCode(qrCodeId, credentials = null) {
  if (!credentials) assertRazorpayConfigured();
  if (!qrCodeId) throw new AppError("Razorpay QR code id is required", 400);
  return razorpayRequest(`/payments/qr_codes/${encodeURIComponent(qrCodeId)}/close`, { method: "POST", body: "{}" }, credentials);
}

export function verifyPaymentSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }, credentials = null) {
  const keySecret = credentials?.keySecret || env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return { verified: false, reason: "RAZORPAY_KEY_SECRET not configured" };
  }
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return { verified: false, reason: "Missing Razorpay payment signature fields" };
  }
  const signedPayload = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expected = crypto.createHmac("sha256", keySecret).update(signedPayload).digest("hex");
  return timingSafeCompareHex(expected, razorpay_signature)
    ? { verified: true, reason: null }
    : { verified: false, reason: "Invalid Razorpay payment signature" };
}

export function verifyWebhookSignature(rawBody, signature, credentials = null) {
  const webhookSecret = credentials?.webhookSecret || env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return { verified: false, reason: "RAZORPAY_WEBHOOK_SECRET not configured" };
  }
  if (!signature) return { verified: false, reason: "Missing Razorpay webhook signature" };
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""));
  const expected = crypto.createHmac("sha256", webhookSecret).update(bodyBuffer).digest("hex");
  return timingSafeCompareHex(expected, signature)
    ? { verified: true, reason: null }
    : { verified: false, reason: "Invalid Razorpay webhook signature" };
}

export function getRawBodyString(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody.toString("utf8");
  if (typeof rawBody === "string") return rawBody;
  return JSON.stringify(rawBody ?? {});
}

export function parseWebhookBody(rawBody) {
  try {
    return JSON.parse(getRawBodyString(rawBody) || "{}");
  } catch {
    const err = new AppError("Invalid Razorpay webhook body", 400);
    err.code = "INVALID_WEBHOOK_BODY";
    throw err;
  }
}

function timingSafeCompareHex(expected, actual) {
  const expectedBuffer = Buffer.from(String(expected), "hex");
  const actualString = String(actual || "");
  if (!/^[a-f0-9]+$/i.test(actualString)) return false;
  const actualBuffer = Buffer.from(actualString, "hex");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

async function razorpayRequest(path, options = {}, credentials = null) {
  const keyId = credentials?.keyId || env.RAZORPAY_KEY_ID;
  const keySecret = credentials?.keySecret || env.RAZORPAY_KEY_SECRET;
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch(`${RAZORPAY_API_BASE}${path}`, {
    ...options,
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!response.ok) {
    const err = new AppError(data?.error?.description || "Razorpay API request failed", response.status >= 500 ? 502 : 400);
    err.code = "RAZORPAY_API_ERROR";
    err.meta = { status: response.status, code: data?.error?.code, field: data?.error?.field };
    throw err;
  }

  return data;
}

function sanitizeNotes(notes) {
  const allowed = {};
  for (const [key, value] of Object.entries(notes || {})) {
    allowed[key] = String(value ?? "").slice(0, 250);
  }
  return allowed;
}
