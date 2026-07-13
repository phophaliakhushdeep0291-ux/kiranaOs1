import { apiRequest } from "@/lib/api/http";

export interface RetailPaymentReadiness {
  provider: "manual" | "razorpay";
  configured: boolean;
  confirmationRequired: boolean;
  serverVerified: boolean;
}

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
  }) => { open: () => void; on: (event: "payment.failed", handler: (response: { error?: { description?: string } }) => void) => void };
};

let checkoutLoader: Promise<void> | null = null;

function loadCheckout() {
  const razorpayWindow = window as RazorpayWindow;
  if (razorpayWindow.Razorpay) return Promise.resolve();
  if (checkoutLoader) return checkoutLoader;
  checkoutLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-razorpay-checkout]");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Unable to load verified payment checkout.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpayCheckout = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load verified payment checkout."));
    document.head.appendChild(script);
  });
  return checkoutLoader;
}

function openCheckout(checkout: RetailCheckout) {
  return new Promise<RazorpaySuccess>((resolve, reject) => {
    const Razorpay = (window as RazorpayWindow).Razorpay;
    if (!Razorpay) return reject(new Error("Verified payment checkout did not load."));
    let completed = false;
    const instance = new Razorpay({
      key: checkout.razorpayKeyId,
      amount: checkout.amountPaise,
      currency: checkout.currency,
      name: "Kirana OS",
      description: `Retail payment at ${checkout.location.name}`,
      order_id: checkout.orderId,
      handler: (response) => { completed = true; resolve(response); },
      modal: { ondismiss: () => { if (!completed) reject(new Error("Payment checkout was cancelled.")); } },
      theme: { color: "#075fff" },
    });
    instance.on("payment.failed", (response) => reject(new Error(response.error?.description || "Payment failed.")));
    instance.open();
  });
}

export function getRetailPaymentReadiness() {
  return apiRequest<RetailPaymentReadiness>("/payment-provider/retail/readiness", { method: "GET", background: true });
}

export async function verifyRetailPayment(amountPaise: number) {
  const checkout = await apiRequest<RetailCheckout>("/payment-provider/retail/intents", { method: "POST", body: JSON.stringify({ amountPaise }) });
  await loadCheckout();
  const response = await openCheckout(checkout);
  await apiRequest(`/payment-provider/retail/intents/${checkout.intentId}/verify`, { method: "POST", body: JSON.stringify(response) });
  return { intentId: checkout.intentId, amountPaise, locationId: checkout.location.id };
}
