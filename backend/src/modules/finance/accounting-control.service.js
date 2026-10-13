import db from "../../db.js";
import { projectLedgerRow, SYSTEM_ACCOUNTS } from "./ledger-projection.js";
import { publicPaise } from "./ledger-money.js";
const accountsByCode = new Map(SYSTEM_ACCOUNTS.map((account) => [account.code, account]));

export const ACCOUNTING_CONTROL_VERSION = "accounting-control-v2";

function sourceGroupKey(row) {
  return `${row?.sourceType ?? "unknown"}:${row?.sourceId ?? row?.id ?? "missing"}`;
}

function publicMoney(paise) {
  return { paise: publicPaise(paise), amount: publicPaise(paise) / 100 };
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
    const amountPaise = BigInt(row.amountPaise);
    try {
      for (const line of projectLedgerRow(row)) group.lines.push({
        account: accountsByCode.get(line.accountCode),
        debitPaise: line.side === "debit" ? line.amountPaise : 0n,
        creditPaise: line.side === "credit" ? line.amountPaise : 0n,
      });
    } catch (error) {
      if (error.code !== "GENERAL_LEDGER_UNMAPPED_ENTRY") throw error;
      const entryType = String(row.entryType ?? "unknown");
      group.unmappedEntryTypes.push(entryType);
      unmappedRows.push({ id: row.id ?? null, sourceType: row.sourceType ?? "unknown", sourceId: row.sourceId ?? null, entryType, amount: publicMoney(amountPaise) });
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
    const balanced = differencePaise === 0n && group.unmappedEntryTypes.length === 0;
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
      "Sales cost of goods sold is posted at each bill's recorded line cost, not recomputed from a valuation method; non-purchase stock movements — adjustments, counts, write-offs and repacking — do not reach the ledger at all.",
      "Live bank and payment-provider feeds, TDS, TCS and statutory-format financial statements are not yet covered; imported CSV statement reconciliation is reported separately.",
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
