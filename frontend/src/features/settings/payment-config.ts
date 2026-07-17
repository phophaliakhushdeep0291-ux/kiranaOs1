export interface PaymentConfig {
  upiId: string;
  payeeName: string;
}

let cache: PaymentConfig = { upiId: "", payeeName: "Artha merchant" };

export function setPaymentConfigCache(bank: Record<string, unknown> | undefined, shopName?: string | null) {
  cache = {
    upiId: typeof bank?.upi === "string" ? bank.upi.trim() : "",
    payeeName: typeof bank?.holder === "string" && bank.holder.trim() ? bank.holder.trim() : (shopName?.trim() || "Artha merchant"),
  };
}

export function getPaymentConfigSync() {
  return cache;
}

export function buildUpiPaymentUri({ upiId, payeeName, amount, note }: PaymentConfig & { amount: number; note?: string }) {
  if (!/^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/.test(upiId)) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const query = new URLSearchParams({ pa: upiId, pn: payeeName || "Merchant", am: amount.toFixed(2), cu: "INR", tn: note || "Artha counter payment" });
  return `upi://pay?${query.toString()}`;
}

