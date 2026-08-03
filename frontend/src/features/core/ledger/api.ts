import { apiRequest, buildQuery } from "@/lib/api/http";
import type { LedgerResult, QueryParams, UdharSummary } from "@/types/api";

interface RawUdharCustomer {
  id?: string;
  customerId?: string;
  name?: string;
  customerName?: string;
  mobile?: string;
  amount?: number;
  udharAmount?: number;
  outstanding?: number;
}

interface RawUdharSummary {
  totalOutstanding?: number;
  customers?: RawUdharCustomer[];
}

export async function getUdharSummary() {
  const data = await apiRequest<RawUdharSummary>("/udhar/summary");
  return {
    totalOutstanding: Number(data.totalOutstanding ?? 0),
    customers: (data.customers ?? []).map((customer) => ({
      customerId: customer.customerId ?? customer.id ?? "",
      customerName: customer.customerName ?? customer.name ?? "Customer",
      mobile: customer.mobile,
      amount: customer.amount ?? customer.udharAmount ?? 0,
      outstanding: customer.outstanding ?? customer.amount ?? customer.udharAmount ?? 0,
    })),
  } satisfies UdharSummary;
}

export function getUdharLedger(params?: QueryParams) {
  return apiRequest<LedgerResult<unknown>>(`/udhar${buildQuery(params)}`);
}
