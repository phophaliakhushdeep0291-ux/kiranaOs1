import { apiRequest, buildQuery } from "@/lib/api/http";

export type GiftCardStatus = "active" | "depleted" | "disabled" | "expired";
export interface GiftCardTransaction { id: string; type: string; amount: number; balanceAfter: number; note?: string | null; billId?: string | null; createdAt: string }
export interface GiftCard {
  id: string;
  codeLast4: string;
  code?: string;
  status: GiftCardStatus;
  initialBalance: number;
  balance: number;
  expiresAt?: string | null;
  issuedAt: string;
  note?: string | null;
  customerId?: string | null;
  customer?: { id: string; name: string; mobile?: string | null } | null;
  transactions?: GiftCardTransaction[];
}

export const listGiftCards = (status: GiftCardStatus | "all" = "all") => apiRequest<GiftCard[]>(`/gift-cards${buildQuery({ status, limit: 100 })}`);
export const lookupGiftCard = (code: string) => apiRequest<GiftCard>("/gift-cards/lookup", { method: "POST", body: JSON.stringify({ code }) });
export const issueGiftCard = (data: { amount: number; customerId?: string; expiresOn?: string; note?: string; ownerPin: string }) => apiRequest<GiftCard>("/gift-cards", { method: "POST", ownerPin: data.ownerPin, body: JSON.stringify(data) });
export const disableGiftCard = (id: string, data: { reason: string; ownerPin: string }) => apiRequest<GiftCard>(`/gift-cards/${id}/disable`, { method: "POST", ownerPin: data.ownerPin, body: JSON.stringify(data) });
