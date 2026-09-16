import { apiRequest, buildQuery } from "@/lib/api/http";

/**
 * The shop's books, as the posted general ledger sees them.
 *
 * Every endpoint here was built and tested on the server long before any screen
 * called it — `/accounting/trial-balance`, `/profit-and-loss`, `/balance-sheet`,
 * `/chart-of-accounts` and `/periods` had no client at all. This module is that
 * client, and it deliberately stays a thin one: the projection lives in
 * `general-ledger.service.js` and the numbers must not be re-derived here, or the
 * screen and the ledger start disagreeing about the same shop.
 *
 * Money crosses the wire as integer paise (the server widens its BigInt columns
 * to Number on the way out), so nothing in this file rounds or reformats — that
 * is the view layer's job, once, at the point of display.
 */

export type AccountCategory = "asset" | "liability" | "equity" | "income" | "expense";
export type NormalSide = "debit" | "credit";

export interface LedgerAccountRow {
  code: string;
  name: string;
  category: AccountCategory;
  normalSide: NormalSide;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
}

/** A trial-balance row carrying the signed figure a statement wants to print. */
export interface StatementRow extends LedgerAccountRow {
  amountPaise: number;
}

export interface TrialBalance {
  version: string;
  status: "balanced" | "attention_required";
  totalDebitPaise: number;
  totalCreditPaise: number;
  differencePaise: number;
  accounts: LedgerAccountRow[];
}

export interface ProfitAndLoss {
  version: string;
  from: string | null;
  to: string | null;
  totalIncomePaise: number;
  totalExpensePaise: number;
  netProfitPaise: number;
  income: StatementRow[];
  expenses: StatementRow[];
  /** "posted_general_ledger" — the thing that distinguishes this from /reports/pnl. */
  basis: string;
}

export interface BalanceSheet {
  version: string;
  asOf: string | null;
  status: "balanced" | "attention_required";
  totalAssetsPaise: number;
  totalLiabilitiesPaise: number;
  totalEquityPaise: number;
  differencePaise: number;
  assets: StatementRow[];
  liabilities: StatementRow[];
  equity: StatementRow[];
}

export interface ChartAccount {
  id: string;
  code: string;
  name: string;
  category: AccountCategory;
  normalSide: NormalSide;
  /** Non-null on the accounts the posting engine owns; those cannot be edited. */
  systemKey: string | null;
  active: boolean;
}

export interface AccountingPeriodRow {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: "open" | "closed";
  closedAt: string | null;
  closeReason: string | null;
}

/**
 * A `type` rather than an `interface` on purpose: `buildQuery` takes a
 * `Record<string, unknown>`, and only a type alias carries the implicit index
 * signature that satisfies it.
 */
export type LedgerRange = {
  from?: string;
  to?: string;
};

/**
 * A calendar date as the instant the server's `z.string().datetime({offset:true})`
 * will accept. `end` takes the last millisecond so a range reads inclusively —
 * a period that ends "on the 30th" must contain the 30th.
 */
export function ledgerBoundary(date: string, end = false) {
  return new Date(`${date}T${end ? "23:59:59.999" : "00:00:00.000"}`).toISOString();
}

export function getTrialBalance(range: LedgerRange) {
  return apiRequest<TrialBalance>(`/accounting/trial-balance${buildQuery(range)}`);
}

export function getLedgerProfitAndLoss(range: LedgerRange) {
  return apiRequest<ProfitAndLoss>(`/accounting/profit-and-loss${buildQuery(range)}`);
}

export function getBalanceSheet(params: { asOf?: string }) {
  return apiRequest<BalanceSheet>(`/accounting/balance-sheet${buildQuery(params)}`);
}

/**
 * NOT a read. The server handler runs `ensureSystemAccounts` inside a
 * transaction and writes a `LEDGER_SYSTEM_ACCOUNTS_ENSURED` audit row on every
 * call, so fetching it on page mount would stamp the audit trail once per view.
 * Call it only when the operator has actually opened the chart of accounts.
 */
export function ensureChartOfAccounts() {
  return apiRequest<ChartAccount[]>("/accounting/chart-of-accounts");
}

export function getAccountingPeriods() {
  return apiRequest<AccountingPeriodRow[]>("/accounting/periods");
}
