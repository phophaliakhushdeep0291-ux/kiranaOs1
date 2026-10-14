// The books screen: trial balance, profit and loss, balance sheet, chart of
// accounts and accounting periods.
//
// Audience is the owner and whoever does their accounts, not the counter — so
// the register is a shopkeeper's, not a textbook's. "डेबिट", "क्रेडिट",
// "ट्रायल बैलेंस" and "बैलेंस शीट" stay as the words every Indian accountant
// actually says out loud; inventing Sanskritised replacements for them would
// make the page harder to read, not easier.
export const accountingEn = {
  // ── Page ──
  "accounting.subtitle": "Posted journals, balances and financial statements.",
  "accounting.ownerOnly": "Only the owner can open the shop's books.",
  "accounting.loadFailed": "Books unavailable. Connect to the server and retry.",
  "accounting.loading": "Reading the ledger…",
  "accounting.retry": "Try again",

  // ── Tabs ──
  "accounting.tab.trialBalance": "Trial balance",
  "accounting.tab.profitAndLoss": "Profit and loss",
  "accounting.tab.balanceSheet": "Balance sheet",
  "accounting.tab.chartOfAccounts": "Chart of accounts",
  "accounting.tab.periods": "Periods",

  // ── Range ──
  "accounting.range.from": "From",
  "accounting.range.to": "To",
  "accounting.range.asOf": "As on",

  // ── Status ──
  "accounting.status.noData": "No postings",
  "accounting.integrity.review": "Review these books before relying on totals.",
  "accounting.integrity.checked": "Source entries reconcile with journals.",
  "accounting.integrity.unposted": "Unposted source entries",
  "accounting.integrity.mismatch": "Source discrepancies",
  "accounting.integrity.invalid": "Journals needing review",
  "accounting.integrity.action": "Totals include posted entries only. Resolve posting discrepancies with your accountant before closing.",
  "accounting.integrity.scope": "Checks cover ledger entries. Separately verify opening balances, stock valuation, taxes and bank reconciliation.",
  "accounting.status.balanced": "Balanced",
  "accounting.status.attention": "Needs attention",
  "accounting.status.balancedHint": "Debits equal credits across every posted account.",
  "accounting.status.attentionHint": "Review the posting checks and any debit/credit difference below.",

  // ── Columns ──
  "accounting.col.code": "Code",
  "accounting.col.account": "Account",
  "accounting.col.category": "Type",
  "accounting.col.debit": "Debit",
  "accounting.col.credit": "Credit",
  "accounting.col.balance": "Balance",
  "accounting.col.amount": "Amount",
  "accounting.col.status": "Status",

  // ── Totals ──
  "accounting.total.debit": "Total debit",
  "accounting.total.credit": "Total credit",
  "accounting.total.difference": "Difference",

  // ── Account categories ──
  "accounting.category.asset": "Asset",
  "accounting.category.liability": "Liability",
  "accounting.category.equity": "Capital",
  "accounting.category.income": "Income",
  "accounting.category.expense": "Expense",

  // ── Profit and loss ──
  "accounting.pnl.income": "Income",
  "accounting.pnl.expenses": "Expenses",
  "accounting.pnl.totalIncome": "Total income",
  "accounting.pnl.totalExpenses": "Total expenses",
  "accounting.pnl.netProfit": "Net profit",
  "accounting.pnl.netLoss": "Net loss",
  "accounting.pnl.basisTitle": "Profit and loss from posted journals",
  "accounting.pnl.basisBody": "Posted entries determine these totals. Reports uses bill estimates, so figures can differ.",

  // ── Balance sheet ──
  "accounting.bs.assets": "Assets",
  "accounting.bs.liabilities": "Liabilities",
  "accounting.bs.equity": "Capital",
  "accounting.bs.totalAssets": "Total assets",
  "accounting.bs.totalLiabilities": "Total liabilities",
  "accounting.bs.totalEquity": "Total capital",

  // ── Chart of accounts ──
  "accounting.coa.loadTitle": "Open the chart of accounts",
  "accounting.coa.loadBody": "Opening creates missing system accounts and records the action in the audit log.",
  "accounting.coa.loadAction": "Open chart of accounts",
  "accounting.coa.systemBadge": "System",
  "accounting.coa.inactiveBadge": "Inactive",
  "accounting.coa.empty": "No accounts yet.",

  // ── Periods ──
  "accounting.period.name": "Period",
  "accounting.period.starts": "Starts",
  "accounting.period.ends": "Ends",
  "accounting.period.open": "Open",
  "accounting.period.closed": "Closed",
  "accounting.period.closedOn": "Closed on",
  "accounting.period.reason": "Reason",
  "accounting.period.empty": "No periods yet. Dates stay open until their period is closed.",

  // ── Empty ──
  "accounting.empty.title": "Nothing posted in this range",
  "accounting.empty.body": "No journal lines carry a business date inside these dates.",

  // ── Entry point on the Reports screen ──
  // One clipped line in the phone's More sheet — keep it short; see entry.body for the card.

  // ── Footer ──
  "accounting.note.version": "Projection",
} as const;
