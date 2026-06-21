import { normalizeWhatsappNumber } from "@/features/bills/share";

// Free, manual "remind this customer now" via the wa.me deep link (no paid API / no Pro gate).
// Distinct from the Pro "automated reminders" feature — this is one-tap, owner-initiated.

function rupees(n: number): string {
  const v = Math.abs(Math.round((n + Number.EPSILON) * 100) / 100);
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export interface UdharReminderInput {
  customerName?: string;
  customerMobile?: string;
  amount: number;
  shopName?: string;
  upiId?: string;
}

/** Warm, simple Hinglish reminder a shopkeeper can send as-is or edit before sending. */
export function buildUdharReminderText({ customerName, amount, shopName, upiId }: UdharReminderInput): string {
  const lines: string[] = [];
  lines.push(`नमस्ते ${customerName || "ji"} 🙏`);
  if (shopName) lines.push(`*${shopName}*`);
  lines.push("");
  lines.push(`Aapka udhar baki hai: *${rupees(amount)}*`);
  lines.push("Kripya jab samay mile, payment kar dijiye.");
  if (upiId) lines.push(`UPI: ${upiId}`);
  lines.push("");
  lines.push("Dhanyavaad! 🙏");
  return lines.join("\n");
}

export function buildUdharReminderUrl(input: UdharReminderInput): string {
  const number = normalizeWhatsappNumber(input.customerMobile);
  const text = encodeURIComponent(buildUdharReminderText(input));
  return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
}

/** Opens WhatsApp with the reminder. Returns whether the customer's number was targeted. */
export function sendUdharReminderOnWhatsapp(input: UdharReminderInput): { targetedCustomer: boolean } {
  if (typeof window !== "undefined") {
    window.open(buildUdharReminderUrl(input), "_blank", "noopener,noreferrer");
  }
  return { targetedCustomer: Boolean(normalizeWhatsappNumber(input.customerMobile)) };
}
