import { apiRequest } from "@/lib/api/http";

/**
 * Counter card/EDC terminal. A charge is pushed to the machine, the customer
 * taps or dips, and the bill stays locked until the acquirer confirms — the
 * same discipline as the dynamic UPI QR, never the terminal's own screen.
 *
 * An approved charge settles as the "bank" tender: that is where the acquirer
 * actually credits the shop.
 */

export interface CardTerminalReadiness {
  provider: "none" | "simulated" | "pine_labs" | "ezetap";
  configured: boolean;
  simulated: boolean;
  terminalId: string | null;
  tenderMode: "bank";
  chargeTimeoutSeconds: number;
}

export type CardTerminalStatus = "creating" | "pending" | "confirmed" | "failed" | "expired" | "cancelled";

export interface CardTerminalCharge {
  intentId: string;
  provider: string;
  mode: "terminal";
  status: CardTerminalStatus;
  amountPaise: number;
  currency: string;
  expiresAt: string;
  chargeId: string | null;
  location: { id: string; name: string | null };
  confirmedAt?: string | null;
  confirmationSource?: string | null;
  failureReason?: string | null;
  cardNetwork?: string | null;
  authCode?: string | null;
}

export function getCardTerminalReadiness() {
  return apiRequest<CardTerminalReadiness>("/payment-provider/terminal/readiness", { method: "GET", background: true });
}

export function startCardTerminalCharge(amountPaise: number) {
  return apiRequest<CardTerminalCharge>("/payment-provider/terminal/charges", { method: "POST", body: JSON.stringify({ amountPaise }) });
}

export function getCardTerminalChargeStatus(intentId: string) {
  return apiRequest<CardTerminalCharge>(`/payment-provider/terminal/charges/${encodeURIComponent(intentId)}/status`, { method: "GET", background: true });
}

export function cancelCardTerminalCharge(intentId: string) {
  return apiRequest<CardTerminalCharge>(`/payment-provider/terminal/charges/${encodeURIComponent(intentId)}/cancel`, { method: "POST", body: "{}" });
}
