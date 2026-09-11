/**
 * The two rules the books screen has to get right that are not about markup.
 *
 * They live here rather than inside the page component so they can be tested
 * for what they DO. This repo has no DOM test environment, so a rule left
 * inside a `.tsx` can only ever be asserted as a string of source — which is
 * how a harmless reorder once turned the release gate red. A pure module is
 * the cheap way out of that for anything that is genuinely logic.
 */

export const LEDGER_TABS = ["trialBalance", "profitAndLoss", "balanceSheet", "chartOfAccounts", "periods"] as const;
export type LedgerTab = (typeof LEDGER_TABS)[number];

/**
 * India keeps books from 1 April to 31 March, so that — not "this month" and
 * not "this calendar year" — is where a statement should open. In January the
 * year to show started last April.
 */
export function financialYearStart(today = new Date()) {
  const year = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return toIsoDate(new Date(year, 3, 1));
}

export function toIsoDate(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Which of the five queries may fire.
 *
 * The one that matters is `chartOfAccounts`. Its endpoint is a GET that is not
 * a read: the server runs `ensureSystemAccounts` in a transaction and writes a
 * `LEDGER_SYSTEM_ACCOUNTS_ENSURED` audit row every time it is called. Firing it
 * because a tab mounted would stamp the shop's audit trail once per page view,
 * so it waits for the operator to ask.
 */
export function ledgerQueryEnabled(tab: LedgerTab, chartRequested: boolean) {
  return {
    trialBalance: tab === "trialBalance",
    profitAndLoss: tab === "profitAndLoss",
    balanceSheet: tab === "balanceSheet",
    chartOfAccounts: tab === "chartOfAccounts" && chartRequested,
    periods: tab === "periods",
  } as const;
}
