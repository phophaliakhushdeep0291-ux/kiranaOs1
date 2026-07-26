import { apiRequest, buildQuery } from "@/lib/api/http";

export interface ReconciliationMoney {
  paise: number;
  amount: number;
}

export interface BankStatementImportRecord {
  id: string;
  accountType: "bank" | "upi";
  accountName: string;
  accountLast4: string | null;
  fileName: string;
  statementFrom: string;
  statementTo: string;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  status: "processed" | "duplicate_only";
  importedByUserId: string | null;
  createdAt: string;
  idempotentReplay?: boolean;
}

export interface BankReconciliationCandidate {
  ledgerRowId: string;
  sourceType: string;
  sourceId: string;
  entryType: string;
  businessDate: string;
  paymentMode: string | null;
  direction: "debit" | "credit";
  amount: ReconciliationMoney;
  dateDeltaDays: number;
  exactAmount: boolean;
  referenceMatched: boolean;
  score: number;
  confidence: "exact_amount_date_reference" | "exact_amount_date" | "eligible_manual_allocation";
  reasons: string[];
  rank?: number;
  ambiguous?: boolean;
}

export interface BankReconciliationAllocation {
  id: string;
  ledgerRowId: string;
  amount: ReconciliationMoney;
  method: string;
  status: string;
  evidence: Record<string, unknown>;
  matchedByUserId: string | null;
  matchedAt: string;
  ledgerRow?: {
    sourceType: string;
    sourceId: string;
    entryType: string;
    paymentMode: string | null;
    businessDate: string;
  };
}

export interface BankStatementTransaction {
  id: string;
  rowNumber: number;
  transactionDate: string;
  description: string;
  reference: string | null;
  direction: "debit" | "credit";
  amount: ReconciliationMoney;
  balance: ReconciliationMoney | null;
  reconciledAmount: ReconciliationMoney;
  remainingAmount: ReconciliationMoney;
  matchStatus: "unmatched" | "partial" | "matched" | "ignored";
  ignoredReason: string | null;
  ignoredAt: string | null;
  import: BankStatementImportRecord;
  allocations: BankReconciliationAllocation[];
  suggestions: BankReconciliationCandidate[];
  allocationOptions: BankReconciliationCandidate[];
  autoMatched: false;
}

export interface BankReconciliationReport {
  calculationVersion: "bank-reconciliation-v1";
  scope: "shop";
  autoMatch: false;
  summary: {
    transactionCount: number;
    counts: Record<"unmatched" | "partial" | "matched" | "ignored", number>;
    total: ReconciliationMoney;
    reconciled: ReconciliationMoney;
    ignored: ReconciliationMoney;
    open: ReconciliationMoney;
    remaining: ReconciliationMoney;
  };
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  candidateCoverage: {
    suggestionWindowDays: number;
    manualAllocationWindowDays: number;
    ledgerRowsEvaluated: number;
    truncated: boolean;
  };
  transactions: BankStatementTransaction[];
  limitations: string[];
}

export interface BankStatementImportInput {
  accountType: "bank" | "upi";
  accountName: string;
  accountLast4?: string;
  fileName: string;
  csvText: string;
  note?: string;
}

export function getBankReconciliation(params: {
  from: string;
  to: string;
  status?: "all" | "unmatched" | "partial" | "matched" | "ignored";
  accountType?: "bank" | "upi";
  limit?: number;
  offset?: number;
}) {
  return apiRequest<BankReconciliationReport>(`/accounting/bank-reconciliation${buildQuery(params)}`, {
    background: true,
  });
}

export function importBankStatement(input: BankStatementImportInput, ownerPin: string) {
  return apiRequest<BankStatementImportRecord>("/accounting/bank-statements/import", {
    method: "POST",
    ownerPin,
    body: JSON.stringify(input),
  });
}

export function matchBankTransaction(
  transactionId: string,
  input: { ledgerRowIds: string[]; note?: string },
  ownerPin: string,
) {
  return apiRequest<{
    transactionId: string;
    matchStatus: "partial" | "matched";
    reconciledAmount: ReconciliationMoney;
    remainingAmount: ReconciliationMoney;
    allocatedLedgerRowIds: string[];
    autoMatched: false;
    calculationVersion: string;
  }>(`/accounting/bank-transactions/${encodeURIComponent(transactionId)}/match`, {
    method: "POST",
    ownerPin,
    body: JSON.stringify(input),
  });
}

export function unmatchBankTransaction(
  transactionId: string,
  input: { allocationIds?: string[]; reason: string },
  ownerPin: string,
) {
  return apiRequest(`/accounting/bank-transactions/${encodeURIComponent(transactionId)}/unmatch`, {
    method: "POST",
    ownerPin,
    body: JSON.stringify(input),
  });
}

export function ignoreBankTransaction(transactionId: string, reason: string, ownerPin: string) {
  return apiRequest(`/accounting/bank-transactions/${encodeURIComponent(transactionId)}/ignore`, {
    method: "POST",
    ownerPin,
    body: JSON.stringify({ reason }),
  });
}

export function restoreBankTransaction(transactionId: string, reason: string, ownerPin: string) {
  return apiRequest(`/accounting/bank-transactions/${encodeURIComponent(transactionId)}/restore`, {
    method: "POST",
    ownerPin,
    body: JSON.stringify({ reason }),
  });
}
