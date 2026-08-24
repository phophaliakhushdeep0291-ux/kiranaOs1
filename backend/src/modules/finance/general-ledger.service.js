import db from "../../db.js";

export const GENERAL_LEDGER_VERSION = "general-ledger-v1";

export const SYSTEM_ACCOUNTS = [
  ["1000", "Cash in hand", "asset", "debit", "cash"],
  ["1010", "UPI clearing", "asset", "debit", "upi"],
  ["1020", "Bank", "asset", "debit", "bank"],
  ["1030", "Other payment clearing", "asset", "debit", "other_clearing"],
  ["1100", "Customer receivables", "asset", "debit", "receivables"],
  ["1200", "Inventory at recorded purchase cost", "asset", "debit", "inventory"],
  ["1300", "Supplier advances and credits", "asset", "debit", "supplier_credits"],
  ["2000", "Supplier payables", "liability", "credit", "payables"],
  ["2100", "Gift card liability", "liability", "credit", "gift_cards"],
  ["2200", "GST output payable", "liability", "credit", "gst_output"],
  ["2300", "Accrued expense payables", "liability", "credit", "expense_payables"],
  ["2900", "Recycle-bin suspense", "liability", "credit", "recycle_bin_suspense"],
  ["3000", "Owner capital", "equity", "credit", "owner_capital"],
  ["3100", "Owner drawings", "equity", "debit", "owner_drawings"],
  ["4000", "Net sales", "income", "credit", "sales"],
  ["6000", "Operating expenses", "expense", "debit", "operating_expenses"],
  ["6100", "Waivers and rounding", "expense", "debit", "waivers"],
].map(([code, name, category, normalSide, systemKey]) => ({ code, name, category, normalSide, systemKey }));

const ENTRY_MAPPING = {
  sale: ["4000", "credit"], cash_in: ["1000", "debit"], upi_in: ["1010", "debit"], bank_in: ["1020", "debit"],
  udhar_debit: ["1100", "debit"], udhar_credit: ["1100", "credit"], udhar_return_credit: ["1100", "credit"],
  gift_card_issued: ["2100", "credit"], gift_card_redeemed: ["2100", "debit"], waiver_expense: ["6100", "debit"],
  recycle_bin_offset: ["2900", "credit"], gst_output: ["2200", "credit"], gst_sales_reclassification: ["4000", "debit"],
  inventory_purchase: ["1200", "debit"], inventory_purchase_return: ["1200", "credit"], supplier_payable: ["2000", "credit"],
  supplier_payable_reduction: ["2000", "debit"], supplier_credit_receivable: ["1300", "debit"], cash_out: ["1000", "credit"],
  upi_out: ["1010", "credit"], bank_out: ["1020", "credit"], other_out: ["1030", "credit"], cash_refund_in: ["1000", "debit"],
  upi_refund_in: ["1010", "debit"], bank_refund_in: ["1020", "debit"], operating_expense: ["6000", "debit"], expense_payable: ["2300", "credit"],
};

const opposite = (side) => side === "debit" ? "credit" : "debit";
const tenderCode = (mode) => String(mode).toLowerCase() === "upi" ? "1010" : ["bank", "card"].includes(String(mode).toLowerCase()) ? "1020" : "1000";

export function projectLedgerRow(row) {
  const signed = BigInt(row.amountPaise ?? 0);
  if (signed === 0n) return [];
  const amountPaise = signed < 0n ? -signed : signed;
  if (row.entryType === "supplier_payment") {
    const lines = [["2000", "debit"], [tenderCode(row.paymentMode), "credit"]];
    return lines.map(([accountCode, side]) => ({ accountCode, side: signed < 0n ? opposite(side) : side, amountPaise, financialLedgerId: row.id }));
  }
  const mapping = ENTRY_MAPPING[row.entryType];
  if (!mapping) throw Object.assign(new Error(`Unmapped financial-ledger entry type: ${row.entryType}`), { code: "GENERAL_LEDGER_UNMAPPED_ENTRY" });
  const [accountCode, side] = mapping;
  return [{ accountCode, side: signed < 0n ? opposite(side) : side, amountPaise, financialLedgerId: row.id }];
}

export function buildJournalProjection(rows) {
  const projected = rows.flatMap(projectLedgerRow);
  const debitPaise = projected.filter((line) => line.side === "debit").reduce((sum, line) => sum + line.amountPaise, 0n);
  const creditPaise = projected.filter((line) => line.side === "credit").reduce((sum, line) => sum + line.amountPaise, 0n);
  if (debitPaise !== creditPaise) throw Object.assign(new Error(`Journal is not balanced: debit ${debitPaise}, credit ${creditPaise}`), { code: "GENERAL_LEDGER_UNBALANCED_JOURNAL" });
  return { lines: projected, debitPaise, creditPaise };
}

export async function ensureSystemAccounts(shopId, client = db) {
  for (const account of SYSTEM_ACCOUNTS) {
    await client.chartOfAccount.upsert({
      where: { shopId_code: { shopId, code: account.code } },
      create: { shopId, ...account },
      update: { name: account.name, category: account.category, normalSide: account.normalSide, systemKey: account.systemKey },
    });
  }
  return client.chartOfAccount.findMany({ where: { shopId }, orderBy: { code: "asc" } });
}

export async function postFinancialLedgerRows(client, rows) {
  if (!rows.length) return [];
  const shopId = rows[0].shopId;
  if (rows.some((row) => row.shopId !== shopId)) throw new Error("A journal batch cannot span shops");
  const createdRows = [];
  for (const row of rows) createdRows.push(await client.financialLedger.create({ data: row }));
  // Lightweight unit-test transaction doubles intentionally expose only the
  // financial ledger. Real Prisma transaction clients always expose both.
  if (!client.chartOfAccount || !client.journalEntry) return createdRows;
  const groups = Map.groupBy(createdRows, (row) => `${row.sourceType}\u0000${row.sourceId}`);
  let accounts = await client.chartOfAccount.findMany({ where: { shopId, active: true } });
  if (accounts.length < SYSTEM_ACCOUNTS.length) accounts = await ensureSystemAccounts(shopId, client);
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));
  for (const sourceRows of groups.values()) {
    const source = sourceRows[0];
    const projection = buildJournalProjection(sourceRows);
    await client.journalEntry.create({ data: {
      shopId, sourceType: source.sourceType, sourceId: source.sourceId, businessDate: source.businessDate,
      description: `${source.sourceType}:${source.sourceId}`,
      evidenceJson: JSON.stringify({ version: 1, projectionVersion: GENERAL_LEDGER_VERSION, ledgerRowIds: sourceRows.map((row) => row.id) }),
      lines: { create: projection.lines.map((line, index) => ({
        shopId, accountId: accountByCode.get(line.accountCode).id, financialLedgerId: line.financialLedgerId,
        lineNumber: index + 1, debitPaise: line.side === "debit" ? line.amountPaise : 0n,
        creditPaise: line.side === "credit" ? line.amountPaise : 0n,
        evidenceJson: JSON.stringify({ version: 1, projectionVersion: GENERAL_LEDGER_VERSION, accountCode: line.accountCode }),
      })) },
    } });
  }
  return createdRows;
}

export async function projectShopGeneralLedger(shopId, client = db) {
  const accounts = await ensureSystemAccounts(shopId, client);
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));
  const rows = await client.financialLedger.findMany({ where: { shopId }, orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  const groups = Map.groupBy(rows, (row) => `${row.sourceType}\u0000${row.sourceId}`);
  let created = 0;
  let existing = 0;
  for (const sourceRows of groups.values()) {
    const source = sourceRows[0];
    const found = await client.journalEntry.findUnique({ where: { shopId_sourceType_sourceId: { shopId, sourceType: source.sourceType, sourceId: source.sourceId } } });
    if (found) { existing += 1; continue; }
    const projection = buildJournalProjection(sourceRows);
    await client.journalEntry.create({ data: {
      shopId, sourceType: source.sourceType, sourceId: source.sourceId, businessDate: source.businessDate,
      description: `${source.sourceType}:${source.sourceId}`,
      evidenceJson: JSON.stringify({ version: 1, projectionVersion: GENERAL_LEDGER_VERSION, ledgerRowIds: sourceRows.map((row) => row.id) }),
      lines: { create: projection.lines.map((line, index) => ({
        shopId, accountId: accountByCode.get(line.accountCode).id, financialLedgerId: line.financialLedgerId,
        lineNumber: index + 1, debitPaise: line.side === "debit" ? line.amountPaise : 0n,
        creditPaise: line.side === "credit" ? line.amountPaise : 0n,
        evidenceJson: JSON.stringify({ version: 1, projectionVersion: GENERAL_LEDGER_VERSION, accountCode: line.accountCode }),
      })) },
    } });
    created += 1;
  }
  return { shopId, sourceGroups: groups.size, journalsCreated: created, journalsExisting: existing };
}

export async function getTrialBalance(shopId, { from, to } = {}, client = db) {
  const businessDate = {};
  if (from) businessDate.gte = new Date(from);
  if (to) businessDate.lte = new Date(to);
  const accounts = await client.chartOfAccount.findMany({
    where: { shopId, active: true }, orderBy: { code: "asc" },
    include: { lines: { where: { journalEntry: { status: "posted", ...(Object.keys(businessDate).length ? { businessDate } : {}) } } } },
  });
  const rows = accounts.map((account) => {
    const debitPaise = account.lines.reduce((sum, line) => sum + BigInt(line.debitPaise), 0n);
    const creditPaise = account.lines.reduce((sum, line) => sum + BigInt(line.creditPaise), 0n);
    return { code: account.code, name: account.name, category: account.category, normalSide: account.normalSide, debitPaise, creditPaise, balancePaise: debitPaise - creditPaise };
  });
  const totalDebitPaise = rows.reduce((sum, row) => sum + row.debitPaise, 0n);
  const totalCreditPaise = rows.reduce((sum, row) => sum + row.creditPaise, 0n);
  const publicRows = rows.map((row) => ({ ...row, debitPaise: Number(row.debitPaise), creditPaise: Number(row.creditPaise), balancePaise: Number(row.balancePaise) }));
  return { version: GENERAL_LEDGER_VERSION, status: totalDebitPaise === totalCreditPaise ? "balanced" : "attention_required", totalDebitPaise: Number(totalDebitPaise), totalCreditPaise: Number(totalCreditPaise), differencePaise: Number(totalDebitPaise - totalCreditPaise), accounts: publicRows };
}
