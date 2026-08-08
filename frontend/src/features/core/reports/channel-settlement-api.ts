import { apiRequest, buildQuery } from "@/lib/api/http";

export type SettlementMoney = { paise: number; amount: number };
export type SettlementResolution = "open" | "matched" | "ignored";

export interface ChannelSettlementMapping {
  externalOrderId: string;
  orderDate: string;
  orderStatus?: string;
  gross: string;
  merchantDiscount?: string;
  platformCommission?: string;
  paymentFee?: string;
  taxOnFees?: string;
  tcs?: string;
  tds?: string;
  adjustment?: string;
  refund?: string;
  expectedNet?: string;
  paidNet: string;
}

export interface ChannelSettlementImport {
  id: string;
  locationId: string | null;
  provider: string;
  fileName: string;
  periodFrom: string;
  periodTo: string;
  rowCount: number;
  gross: SettlementMoney;
  calculatedNet: SettlementMoney;
  paidNet: SettlementMoney;
  variance: SettlementMoney;
  createdAt: string;
  idempotentReplay?: boolean;
}

export interface ChannelSettlementEvent {
  id: string;
  action: "match" | "ignore" | "reverse";
  reason: string | null;
  actorUserId: string | null;
  createdAt: string;
}

export interface ChannelSettlementRow {
  id: string;
  importId: string;
  locationId: string | null;
  provider: string;
  externalOrderId: string;
  orderDate: string;
  channelStatus: string | null;
  gross: SettlementMoney;
  merchantDiscount: SettlementMoney;
  platformCommission: SettlementMoney;
  paymentFee: SettlementMoney;
  taxOnFees: SettlementMoney;
  tcs: SettlementMoney;
  tds: SettlementMoney;
  adjustment: SettlementMoney;
  refund: SettlementMoney;
  providerExpectedNet: SettlementMoney | null;
  calculatedExpectedNet: SettlementMoney;
  paidNet: SettlementMoney;
  variance: SettlementMoney;
  mismatches: string[];
  matchStatus: "missing" | "ambiguous" | "suggested" | "matched" | "ignored";
  candidateCustomerOrderId: string | null;
  candidateBillId: string | null;
  matchedCustomerOrderId: string | null;
  matchedBillId: string | null;
  bankStatementTransactionId: string | null;
  resolutionStatus: SettlementResolution;
  resolutionNote: string | null;
  events: ChannelSettlementEvent[];
  import: ChannelSettlementImport & { location?: { id: string; name: string } | null };
}

export interface ChannelSettlementReport {
  calculationVersion: "channel-settlement-v1";
  autoPost: false;
  summary: {
    rowCount: number;
    matchedCount: number;
    ignoredCount: number;
    openCount: number;
    mismatchCount: number;
    gross: SettlementMoney;
    calculatedNet: SettlementMoney;
    paidNet: SettlementMoney;
    variance: SettlementMoney;
  };
  rollups: Array<{
    provider: string;
    locationId: string | null;
    locationName: string;
    rowCount: number;
    matchedCount: number;
    ignoredCount: number;
    mismatchCount: number;
    gross: SettlementMoney;
    calculatedNet: SettlementMoney;
    paidNet: SettlementMoney;
    variance: SettlementMoney;
  }>;
  rows: ChannelSettlementRow[];
  pagination: { offset: number; limit: number; total: number; hasMore: boolean };
  limitations: string[];
}

export function getChannelSettlementReport(params: {
  importId?: string;
  provider?: string;
  locationId?: string;
  resolutionStatus?: "all" | SettlementResolution;
  mismatchType?: string;
  limit?: number;
  offset?: number;
}) {
  return apiRequest<ChannelSettlementReport>(`/accounting/channel-settlements${buildQuery(params)}`, { background: true });
}

export function importChannelSettlement(input: {
  provider: string;
  locationId?: string;
  fileName: string;
  csvText: string;
  mapping: ChannelSettlementMapping;
}, ownerPin: string) {
  return apiRequest<ChannelSettlementImport>("/accounting/channel-settlements/import", {
    method: "POST",
    ownerPin,
    body: JSON.stringify(input),
  });
}

export function resolveChannelSettlementRow(
  rowId: string,
  input: {
    action: "match" | "ignore" | "reverse";
    customerOrderId?: string;
    billId?: string;
    bankStatementTransactionId?: string;
    reason?: string;
  },
  ownerPin: string,
) {
  return apiRequest<ChannelSettlementRow>(`/accounting/channel-settlement-rows/${encodeURIComponent(rowId)}/resolve`, {
    method: "POST",
    ownerPin,
    body: JSON.stringify(input),
  });
}
