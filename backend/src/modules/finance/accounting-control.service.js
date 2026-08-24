import db from "../../db.js";

export const ACCOUNTING_CONTROL_VERSION = "accounting-control-v2";

const ACCOUNTS = {
  cash: { code: "1000", name: "Cash in hand", category: "asset" },
  upi: { code: "1010", name: "UPI clearing", category: "asset" },
  bank: { code: "1020", name: "Bank", category: "asset" },
  otherClearing: { code: "1030", name: "Other payment clearing", category: "asset" },
  receivables: { code: "1100", name: "Customer receivables", category: "asset" },
  inventory: { code: "1200", name: "Inventory at recorded purchase cost", category: "asset" },
  supplierCredits: { code: "1300", name: "Supplier advances and credits", category: "asset" },
  payables: { code: "2000", name: "Supplier payables", category: "liability" },
  giftCards: { code: "2100", name: "Gift card liability", category: "liability" },
  gstOutput: { code: "2200", name: "GST output payable", category: "liability" },
  expensePayables: { code: "2300", name: "Accrued expense payables", category: "liability" },
  // Holds the udhar and gift-card value of bills sitting in the recycle bin: a delete takes the
  // sale off the books but leaves the debt on the customer's khata, and that receivable has to
  // sit against something. Clears when the bill is cancelled (debt reversed) or restored.
  recycleBinSuspense: { code: "2900", name: "Recycle-bin suspense", category: "liability" },
  sales: { code: "4000", name: "Net sales", category: "income" },
  costOfGoodsSold: { code: "5000", name: "Cost of goods sold", category: "expense" },
  operatingExpenses: { code: "6000", name: "Operating expenses", category: "expense" },
  waivers: { code: "6100", name: "Waivers and rounding", category: "expense" },
};

const ENTRY_MAPPING = {
  sale: { account: ACCOUNTS.sales, side: "credit" },
  cash_in: { account: ACCOUNTS.cash, side: "debit" },
  upi_in: { account: ACCOUNTS.upi, side: "debit" },
  bank_in: { account: ACCOUNTS.bank, side: "debit" },
  udhar_debit: { account: ACCOUNTS.receivables, side: "debit" },
  udhar_credit: { account: ACCOUNTS.receivables, side: "credit" },
  udhar_return_credit: { account: ACCOUNTS.receivables, side: "credit" },
  gift_card_issued: { account: ACCOUNTS.giftCards, side: "credit" },
  gift_card_redeemed: { account: ACCOUNTS.giftCards, side: "debit" },
  waiver_expense: { account: ACCOUNTS.waivers, side: "debit" },
  recycle_bin_offset: { account: ACCOUNTS.recycleBinSuspense, side: "credit" },
  gst_output: { account: ACCOUNTS.gstOutput, side: "credit" },
  gst_sales_reclassification: { account: ACCOUNTS.sales, side: "debit" },
  cost_of_goods_sold: { account: ACCOUNTS.costOfGoodsSold, side: "debit" },
  inventory_sale: { account: ACCOUNTS.inventory, side: "credit" },
  inventory_purchase: { account: ACCOUNTS.inventory, side: "debit" },
  inventory_purchase_return: { account: ACCOUNTS.inventory, side: "credit" },
  supplier_payable: { account: ACCOUNTS.payables, side: "credit" },
  supplier_payable_reduction: { account: ACCOUNTS.payables, side: "debit" },
  supplier_credit_receivable: { account: ACCOUNTS.supplierCredits, side: "debit" },
  cash_out: { account: ACCOUNTS.cash, side: "credit" },
  upi_out: { account: ACCOUNTS.upi, side: "credit" },
  bank_out: { account: ACCOUNTS.bank, side: "credit" },
  other_out: { account: ACCOUNTS.otherClearing, side: "credit" },
  cash_refund_in: { account: ACCOUNTS.cash, side: "debit" },
  upi_refund_in: { account: ACCOUNTS.upi, side: "debit" },
  bank_refund_in: { account: ACCOUNTS.bank, side: "debit" },
  operating_expense: { account: ACCOUNTS.operatingExpenses, side: "debit" },
  expense_payable: { account: ACCOUNTS.expensePayables, side: "credit" },
};

function asPaise(value) {
  try { return BigInt(value ?? 0); }
  catch { return 0n; }
}

function tenderAccount(mode) {
  const normalized = String(mode ?? "cash").toLowerCase();
  if (normalized === "upi") return ACCOUNTS.upi;
  if (["bank", "card"].includes(normalized)) return ACCOUNTS.bank;
  return ACCOUNTS.cash;
}

function sourceGroupKey(row) {
  return `${row?.sourceType ?? "unknown"}:${row?.sourceId ?? row?.id ?? "missing"}`;
}

function appendSignedLine(lines, { account, side }, signedPaise, row) {
  if (signedPaise === 0n) return;
  const negative = signedPaise < 0n;
  const amountPaise = negative ? -signedPaise : signedPaise;
  const effectiveSide = negative ? (side === "debit" ? "credit" : "debit") : side;
  lines.push({
    account,
    debitPaise: effectiveSide === "debit" ? amountPaise : 0n,
    creditPaise: effectiveSide === "credit" ? amountPaise : 0n,
    ledgerRowId: row?.id ?? null,
    entryType: row?.entryType ?? "unknown",
  });
}

function paiseToAmount(paise) {
  return Number(paise) / 100;
}

function publicMoney(paise) {
  return { paise: Number(paise), amount: paiseToAmount(paise) };
}

export function buildAccountingControl(rows = []) {
  const groups = new Map();
  const unmappedRows = [];

  for (const row of rows) {
    const key = sourceGroupKey(row);
    const group = groups.get(key) ?? {
      key,
      sourceType: row?.sourceType ?? "unknown",
      sourceId: row?.sourceId ?? row?.id ?? null,
      businessDate: row?.businessDate ?? null,
      lines: [],
      unmappedEntryTypes: [],
    };
    const amountPaise = asPaise(row?.amountPaise);

    if (row?.entryType === "supplier_payment") {
      appendSignedLine(group.lines, { account: ACCOUNTS.payables, side: "debit" }, amountPaise, row);
      appendSignedLine(group.lines, { account: tenderAccount(row?.paymentMode), side: "credit" }, amountPaise, row);
    } else {
      const mapping = ENTRY_MAPPING[row?.entryType];
      if (mapping) {
        appendSignedLine(group.lines, mapping, amountPaise, row);
      } else {
        const entryType = String(row?.entryType ?? "unknown");
        group.unmappedEntryTypes.push(entryType);
        unmappedRows.push({
          id: row?.id ?? null,
          sourceType: row?.sourceType ?? "unknown",
          sourceId: row?.sourceId ?? null,
          entryType,
          amount: publicMoney(amountPaise),
        });
      }
    }
    groups.set(key, group);
  }

  const accountActivity = new Map();
  const exceptions = [];
  let totalDebitPaise = 0n;
  let totalCreditPaise = 0n;
  let balancedGroups = 0;

  for (const group of groups.values()) {
    let debitPaise = 0n;
    let creditPaise = 0n;
    for (const line of group.lines) {
      debitPaise += line.debitPaise;
      creditPaise += line.creditPaise;
      const activity = accountActivity.get(line.account.code) ?? {
        ...line.account,
        debitPaise: 0n,
        creditPaise: 0n,
      };
      activity.debitPaise += line.debitPaise;
      activity.creditPaise += line.creditPaise;
      accountActivity.set(line.account.code, activity);
    }
    totalDebitPaise += debitPaise;
    totalCreditPaise += creditPaise;
    const differencePaise = debitPaise - creditPaise;
    const balanced = differencePaise === 0n && group.unmappedEntryTypes.length === 0 && group.lines.length > 0;
    if (balanced) balancedGroups += 1;
    else exceptions.push({
      sourceType: group.sourceType,
      sourceId: group.sourceId,
      businessDate: group.businessDate,
      debit: publicMoney(debitPaise),
      credit: publicMoney(creditPaise),
      difference: publicMoney(differencePaise),
      unmappedEntryTypes: [...new Set(group.unmappedEntryTypes)],
    });
  }

  const accounts = [...accountActivity.values()]
    .map((account) => {
      const netPaise = account.debitPaise - account.creditPaise;
      return {
        code: account.code,
        name: account.name,
        category: account.category,
        debitActivity: publicMoney(account.debitPaise),
        creditActivity: publicMoney(account.creditPaise),
        debitBalance: publicMoney(netPaise > 0n ? netPaise : 0n),
        creditBalance: publicMoney(netPaise < 0n ? -netPaise : 0n),
      };
    })
    .sort((left, right) => left.code.localeCompare(right.code));

  const trialDebitPaise = accounts.reduce((sum, account) => sum + BigInt(account.debitBalance.paise), 0n);
  const trialCreditPaise = accounts.reduce((sum, account) => sum + BigInt(account.creditBalance.paise), 0n);
  const status = rows.length === 0
    ? "no_data"
    : exceptions.length === 0 && unmappedRows.length === 0 && totalDebitPaise === totalCreditPaise
      ? "balanced"
      : "attention_required";

  return {
    status,
    calculationVersion: ACCOUNTING_CONTROL_VERSION,
    scope: "shop",
    periodActivity: {
      debit: publicMoney(totalDebitPaise),
      credit: publicMoney(totalCreditPaise),
      difference: publicMoney(totalDebitPaise - totalCreditPaise),
    },
    trialBalance: {
      debit: publicMoney(trialDebitPaise),
      credit: publicMoney(trialCreditPaise),
      difference: publicMoney(trialDebitPaise - trialCreditPaise),
      accounts,
    },
    coverage: {
      ledgerRows: rows.length,
      mappedRows: rows.length - unmappedRows.length,
      unmappedRows: unmappedRows.length,
      sourceGroups: groups.size,
      balancedGroups,
      exceptionGroups: exceptions.length,
    },
    exceptions: exceptions.slice(0, 100),
    unmapped: unmappedRows.slice(0, 100),
    limitations: [
      "This control covers append-only FinancialLedger rows in the selected shop-wide period; it does not claim statutory books are complete.",
      "Historical purchases and expenses recorded before accounting-control-v2 remain outside this projection unless they are explicitly backfilled.",
      "Purchase inventory and expenses are posted at their gross recorded amounts; the source records do not yet contain enough immutable tax evidence to infer GST input credit.",
      "GST output is reclassified as one aggregate liability; CGST, SGST and IGST component evidence remains in the GST register rather than separate journal accounts.",
      "Sales COGS, non-purchase stock valuation changes, live bank/provider feeds, TDS, TCS and statutory financial statements are not yet covered; imported CSV statement reconciliation is reported separately.",
    ],
  };
}

export async function getAccountingControl(shopId, { from, to } = {}) {
  const businessDate = {};
  if (from) businessDate.gte = new Date(from);
  if (to) businessDate.lte = new Date(to);
  const rows = await db.financialLedger.findMany({
    where: { shopId, ...(Object.keys(businessDate).length ? { businessDate } : {}) },
    orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return buildAccountingControl(rows);
}
