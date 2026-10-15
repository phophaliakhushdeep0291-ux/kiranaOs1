export interface CaPeriodQuery {
  from?: string;
  to?: string;
  month?: string;
  status?: "all" | "not_reviewed" | "attention_needed";
}
export interface CaClientFinancials {
  periodFrom: string;
  periodTo: string;
  mtdTurnover: number;
  mtdTurnoverPaise: number;
  mtdOutputTax: number;
  mtdOutputTaxPaise: number;
  totalUdhar: number;
  totalUdharPaise: number;
  billCount: number;
  b2bCount: number;
  b2cCount: number;
}
export interface CaClientAudit {
  openFindingsCount: number;
  hasClosingDiscrepancy: boolean;
  latestClosingDifference: number | null;
  status: "not_reviewed" | "attention_needed";
}
export interface CaShop {
  id: string;
  name: string;
  ownerName: string;
  city: string;
  address: string;
  gstNumber: string | null;
  phone: string | null;
  currencyCode: string;
  taxRegime: string;
}
export interface CaClientSummary extends CaShop {
  userRole: "owner" | "accountant";
  financials: CaClientFinancials;
  audit: CaClientAudit;
}
export interface CaOverviewData {
  accountant: { userId: string; name: string; mobile: string | null; email: string | null };
  aggregates: {
    totalClientShops: number;
    attentionShopsCount: number;
    totalOpenAuditFindings: number;
    totalsByCurrency: Array<{
      currencyCode: string;
      combinedMtdTurnover: number;
      combinedMtdTurnoverPaise: number;
      combinedOutputTax: number;
      combinedOutputTaxPaise: number;
      combinedUdharBook: number;
      combinedUdharBookPaise: number;
    }>;
  };
  clients: CaClientSummary[];
}
export interface TenderSummary {
  cash: number; upi: number; card: number; udhar: number;
  bank: number; gift_card: number; other: number; total: number; unallocated: number;
}
export interface ClientShopDetailsData {
  shop: CaShop;
  period: { from: string; to: string };
  financials: CaClientFinancials;
  audit: CaClientAudit;
  overview: { billCount: number; totalSales: number; totalTax: number; waivedAmount: number; tenderSummary: TenderSummary };
  gstr1: unknown;
  gstr3b: unknown;
  recentClosings: Array<{ date: string; locationId: string | null; counted: number | null; expected: number; difference: number | null }>;
  auditFindings: Array<{ id: string; title: string; riskLevel: string; primaryCategory: string; createdAt: string }>;
}
export interface CaAccess {
  id: string;
  accountantUserId: string | null;
  inviteExpiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  note: string;
}
export interface CaLinkResult {
  success: boolean;
  alreadyLinked: boolean;
  shop: { id: string; name: string; city: string; gstNumber: string | null };
}
