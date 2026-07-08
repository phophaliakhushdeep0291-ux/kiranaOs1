// Free WhatsApp alerts to the customer who placed a QR self-order — reuses the same wa.me deep
// link approach as bill sharing (no paid WhatsApp API, no feature gate). We have the customer's
// mobile from their order, so the owner can tap once to tell them the order is confirmed/ready.

import { normalizeWhatsappNumber } from "@/features/bills/share";
import type { CustomerOrder } from "./api";

export type OrderAlertKind = "received" | "ready";

function money(n: number): string {
  const v = Number(n) || 0;
  return "₹" + (Number.isInteger(v) ? String(v) : v.toFixed(2));
}

/** WhatsApp-friendly plain-text message confirming or updating a customer order. */
export function buildOrderWhatsappText(order: CustomerOrder, shopName: string, kind: OrderAlertKind): string {
  const shop = shopName?.trim() || "our shop";
  const lines: string[] = [];
  if (kind === "received") {
    lines.push(`Hi ${order.customerName} 🙏`);
    lines.push(`We've received your order at *${shop}*:`);
  } else {
    lines.push(`Hi ${order.customerName} 🎉`);
    lines.push(`Your order at *${shop}* is ready:`);
  }
  lines.push("");
  for (const it of order.items) lines.push(`• ${it.qty}× ${it.name}`);
  lines.push("");
  lines.push(`Estimated total: *${money(order.estimatedTotal)}* (final price is set by the shop).`);
  if (kind === "received") lines.push("We're getting it ready now.");
  lines.push(`— ${shop}`);
  return lines.join("\n");
}

/** wa.me deep link to the customer's number (falls back to the chat picker if the number is unusable). */
export function buildOrderWhatsappUrl(order: CustomerOrder, shopName: string, kind: OrderAlertKind): string {
  const number = normalizeWhatsappNumber(order.customerMobile);
  const text = encodeURIComponent(buildOrderWhatsappText(order, shopName, kind));
  return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
}

/** Opens WhatsApp with the prefilled message. Returns whether we targeted the customer's number. */
export function alertCustomerOnWhatsapp(order: CustomerOrder, shopName: string, kind: OrderAlertKind): { targetedCustomer: boolean } {
  const url = buildOrderWhatsappUrl(order, shopName, kind);
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
  return { targetedCustomer: Boolean(normalizeWhatsappNumber(order.customerMobile)) };
}
