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
  "accounting.title": "Accounting",
  "accounting.subtitle": "The posted general ledger — what the books say, not what the counter estimated.",
  "accounting.ownerOnly": "Only the owner can open the shop's books.",
  "accounting.loadFailed": "The books could not be loaded. Connect to the server and try again — no offline estimate is shown here, because an estimate is not a ledger.",
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
  "accounting.status.balanced": "Balanced",
  "accounting.status.attention": "Needs attention",
  "accounting.status.balancedHint": "Debits equal credits across every posted account.",
  "accounting.status.attentionHint": "Debits and credits do not agree. The difference is shown below.",

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
  "accounting.pnl.basisTitle": "This is the ledger's profit and loss",
  "accounting.pnl.basisBody": "It is built from posted journal lines. The profit shown on Reports is an operational estimate read straight off bills, so the two figures can differ — this one is what the books say.",

  // ── Balance sheet ──
  "accounting.bs.assets": "Assets",
  "accounting.bs.liabilities": "Liabilities",
  "accounting.bs.equity": "Capital",
  "accounting.bs.totalAssets": "Total assets",
  "accounting.bs.totalLiabilities": "Total liabilities",
  "accounting.bs.totalEquity": "Total capital",

  // ── Chart of accounts ──
  "accounting.coa.loadTitle": "Open the chart of accounts",
  "accounting.coa.loadBody": "Opening this also creates any missing system account and records that in the audit log, so it is not loaded until you ask for it.",
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
  "accounting.period.empty": "No accounting periods have been created. Until one is closed, any business date stays open for posting.",

  // ── Empty ──
  "accounting.empty.title": "Nothing posted in this range",
  "accounting.empty.body": "No journal lines carry a business date inside these dates.",

  // ── Entry point on the Reports screen ──
  "accounting.entry.body": "Trial balance, profit and loss, balance sheet and the chart of accounts, straight from the posted ledger.",
  "accounting.entry.action": "Open",
  // One clipped line in the phone's More sheet — keep it short; see entry.body for the card.
  "accounting.entry.menuHelper": "Trial balance, P&L, balance sheet",

  // ── Footer ──
  "accounting.note.version": "Projection",
} as const;
