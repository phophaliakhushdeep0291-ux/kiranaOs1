import { apiRequest, buildQuery } from "@/lib/api/http";
import type { Bill, BillInput, BillListResult, QueryParams } from "@/types/api";

export function createBill(data: BillInput) {
  return apiRequest<Bill>("/bills/confirm", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function listBills(params?: QueryParams) {
  return apiRequest<BillListResult>(`/bills${buildQuery(params)}`);
}
