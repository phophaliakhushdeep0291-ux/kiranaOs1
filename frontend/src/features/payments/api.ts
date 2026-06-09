import { apiRequest } from "@/lib/api/http";
import type { UdharPaymentInput } from "@/types/api";

export function recordUdharPayment(customerId: string, data: UdharPaymentInput) {
  return apiRequest<unknown>(`/customers/${customerId}/udhar-payment`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
