import { apiRequest } from "@/lib/api/http";
import { loadRazorpayCheckout } from "@/lib/razorpay-checkout-loader";

export interface RetailPaymentReadiness {
  provider: "manual" | "razorpay";
  configured: boolean;
  confirmationRequired: boolean;
  serverVerified: boolean;
  dynamicQrEnabled: boolean;
}

export interface RetailQrCheckout {
  intentId: string;
  provider: "razorpay";
  mode: "dynamic_qr";
  status: "creating" | "pending" | "confirmed" | "failed" | "expired" | "cancelled";
  amountPaise: number;
  currency: "INR";
  expiresAt: string;
  imageUrl: string;
  location: { id: string; name: string };
  confirmedAt?: string | null;
  confirmationSource?: string | null;
}

export type RetailQrStatus = Omit<RetailQrCheckout, "imageUrl" | "location"> & {
  imageUrl?: string;
  location: { id: string; name: string | null };
};

interface RetailCheckout {
  intentId: string;
  razorpayKeyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  expiresAt: string;
  location: { id: string; name: string };
}

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

type RazorpayWindow = Window & {
  Razorpay?: new (options: {
    key: string;
    amount: number;
    currency: string;
    name: string;
    description: string;
    order_id: string;
    handler: (response: RazorpaySuccess) => void;
    modal: { ondismiss: () => void };
    theme: { color: string };
    config: {
      display: {
        blocks: { upi_only: { name: string; instruments: Array<{ method: "upi" }> } };
        sequence: string[];
        preferences: { show_default_blocks: false };
      };
    };
  }) => { open: () => void; on: (event: "payment.failed", handler: (response: { error?: { description?: string } }) => void) => void };
};

function openCheckout(checkout: RetailCheckout) {
  return new Promise<RazorpaySuccess>((resolve, reject) => {
    const Razorpay = (window as RazorpayWindow).Razorpay;
    if (!Razorpay) return reject(new Error("Verified payment checkout did not load."));
    let completed = false;
    const instance = new Razorpay({
      key: checkout.razorpayKeyId,
      amount: checkout.amountPaise,
      currency: checkout.currency,
      name: "Artha",
      description: `Retail payment at ${checkout.location.name}`,
      order_id: checkout.orderId,
      handler: (response) => { completed = true; resolve(response); },
      modal: { ondismiss: () => { if (!completed) reject(new Error("Payment checkout was cancelled.")); } },
      theme: { color: "var(--brand)" },
      // This bill tender is UPI. Hiding the provider defaults prevents a card or
      // wallet transaction from being posted to the UPI ledger.
      config: {
        display: {
          blocks: { upi_only: { name: "Pay via UPI", instruments: [{ method: "upi" }] } },
          sequence: ["block.upi_only"],
          preferences: { show_default_blocks: false },
        },
      },
    });
    instance.on("payment.failed", (response) => reject(new Error(response.error?.description || "Payment failed.")));
    instance.open();
  });
}

export function getRetailPaymentReadiness() {
  return apiRequest<RetailPaymentReadiness>("/payment-provider/retail/readiness", { method: "GET", background: true });
}

export function createRetailPaymentQr(amountPaise: number) {
  return apiRequest<RetailQrCheckout>("/payment-provider/retail/intents", {
    method: "POST",
    body: JSON.stringify({ amountPaise, mode: "dynamic_qr" }),
  });
}

export function getRetailPaymentQrStatus(intentId: string) {
  return apiRequest<RetailQrStatus>(`/payment-provider/retail/intents/${encodeURIComponent(intentId)}/status`, { method: "GET", background: true });
}

export interface RetailQrBitmap {
  intentId: string;
  amountPaise: number;
  /** Modules per side; a QR version, never a pixel count. */
  moduleCount: number;
  /** Base64, row-major, MSB first — handed straight to the counter printer. */
  modules: string;
  reference: string | null;
  expiresAt: string;
}

export function getRetailPaymentQrBitmap(intentId: string) {
  return apiRequest<RetailQrBitmap>(`/payment-provider/retail/intents/${encodeURIComponent(intentId)}/qr-bitmap`, { method: "GET" });
}

export function cancelRetailPaymentQr(intentId: string) {
  return apiRequest<RetailQrStatus>(`/payment-provider/retail/intents/${encodeURIComponent(intentId)}/cancel`, { method: "POST", body: "{}" });
}

export async function verifyRetailPayment(amountPaise: number) {
  await loadRazorpayCheckout();
  const checkout = await apiRequest<RetailCheckout>("/payment-provider/retail/intents", { method: "POST", body: JSON.stringify({ amountPaise }) });
  const response = await openCheckout(checkout);
  await apiRequest(`/payment-provider/retail/intents/${checkout.intentId}/verify`, { method: "POST", body: JSON.stringify(response) });
  return { intentId: checkout.intentId, amountPaise, locationId: checkout.location.id };
}
