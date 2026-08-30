import { apiRequest } from "@/lib/api/http";

/**
 * The shop's own UPI QR, for a counter with no payment gateway.
 *
 * There is no provider behind this and nothing to poll. The link addresses the
 * shop's own UPI ID, the guest's app moves the money bank-to-bank, and this
 * software is never told that it moved — which is why the response carries
 * `verified: false` and the counter is asked to confirm from its own bank alert.
 */
export interface ShopUpiCollection {
  vpa: string;
  payeeName: string;
  amountPaise: number;
  /** `upi://pay?...` — encode it as a QR, or open it directly on a phone. */
  link: string;
  /** Always false. Nothing in this flow can confirm a payment. */
  verified: false;
}

export async function createShopUpiCollection(input: {
  amountPaise: number;
  note?: string;
  reference?: string;
}): Promise<ShopUpiCollection> {
  const response = await apiRequest<{ data: ShopUpiCollection }>("/shops/upi-collect", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.data;
}
