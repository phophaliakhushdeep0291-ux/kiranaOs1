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
  // URLSearchParams is correct and still wrong for a UPI intent, in two ways
  // that both end with a guest unable to pay.
  //
  // "%40" for the "@" in a VPA is textbook encoding, and every UPI QR in
  // circulation carries it raw. An app that does not decode it addresses a payee
  // who does not exist, and the guest sees "invalid UPI ID" at the counter.
  //
  // "+" for a space is read literally by several apps, so a shop called Flow
  // Cafe is shown to the guest as "Flow+Cafe" on the approval screen — the one
  // moment they are deciding whether this is really the restaurant.
  return `upi://pay?${query.toString().replace(/\+/g, "%20").replace(/%40/g, "@")}`;
}

