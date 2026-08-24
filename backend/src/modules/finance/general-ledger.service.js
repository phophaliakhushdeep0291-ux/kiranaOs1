import db from "../../db.js";
import { createHash } from "node:crypto";

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
  ["2210", "Input GST recoverable", "asset", "debit", "gst_input"],
  ["2300", "Accrued expense payables", "liability", "credit", "expense_payables"],
  ["2900", "Recycle-bin suspense", "liability", "credit", "recycle_bin_suspense"],
  ["3000", "Owner capital", "equity", "credit", "owner_capital"],
  ["3100", "Owner drawings", "equity", "debit", "owner_drawings"],
  ["4000", "Net sales", "income", "credit", "sales"],
  ["5000", "Cost of goods sold", "expense", "debit", "cost_of_goods_sold"],
  ["6000", "Operating expenses", "expense", "debit", "operating_expenses"],
  ["6100", "Waivers and rounding", "expense", "debit", "waivers"],
].map(([code, name, category, normalSide, systemKey]) => ({ code, name, category, normalSide, systemKey }));

const ENTRY_MAPPING = {
  sale: ["4000", "credit"], cash_in: ["1000", "debit"], upi_in: ["1010", "debit"], bank_in: ["1020", "debit"],
  udhar_debit: ["1100", "debit"], udhar_credit: ["1100", "credit"], udhar_return_credit: ["1100", "credit"],
  gift_card_issued: ["2100", "credit"], gift_card_redeemed: ["2100", "debit"], waiver_expense: ["6100", "debit"],
  recycle_bin_offset: ["2900", "credit"], gst_output: ["2200", "credit"], gst_sales_reclassification: ["4000", "debit"],
  cost_of_goods_sold: ["5000", "debit"], inventory_sale: ["1200", "credit"],
  inventory_purchase: ["1200", "debit"], inventory_purchase_return: ["1200", "credit"], supplier_payable: ["2000", "credit"],
  supplier_payable_reduction: ["2000", "debit"], supplier_credit_receivable: ["1300", "debit"], cash_out: ["1000", "credit"],
  upi_out: ["1010", "credit"], bank_out: ["1020", "credit"], other_out: ["1030", "credit"], cash_refund_in: ["1000", "debit"],
  upi_refund_in: ["1010", "debit"], bank_refund_in: ["1020", "debit"], operating_expense: ["6000", "debit"], expense_payable: ["2300", "credit"],
};

const opposite = (side) => side === "debit" ? "credit" : "debit";
const tenderCode = (mode) => String(mode).toLowerCase() === "upi" ? "1010" : ["bank", "card"].includes(String(mode).toLowerCase()) ? "1020" : "1000";

function accountingError(message, code, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

async function assertPeriodOpen(shopId, businessDate, client) {
  if (!client.accountingPeriod) return;
  const locked = await client.accountingPeriod.findFirst({ where: { shopId, status: "closed", startsAt: { lte: businessDate }, endsAt: { gte: businessDate } } });
  if (locked) throw accountingError(`Accounting period ${locked.name} is closed`, "ACCOUNTING_PERIOD_CLOSED");
}

function validateBalancedLines(lines) {
  const debitPaise = lines.reduce((sum, line) => sum + BigInt(line.debitPaise ?? 0), 0n);
  const creditPaise = lines.reduce((sum, line) => sum + BigInt(line.creditPaise ?? 0), 0n);
  if (debitPaise <= 0n || debitPaise !== creditPaise) throw accountingError("Journal debits and credits must be equal and non-zero", "GENERAL_LEDGER_UNBALANCED_JOURNAL", 400);
  return { debitPaise, creditPaise };
}

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

export function journalBatchSourceId(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("A journal batch needs at least one financial-ledger row");
  const sourceId = String(rows[0].sourceId ?? "");
  const keys = rows.map((row) => String(row.idempotencyKey ?? "")).sort();
  if (!sourceId || keys.some((key) => !key)) throw new Error("A journal batch needs a source and idempotency key on every row");
  const digest = createHash("sha256").update(JSON.stringify(keys)).digest("hex").slice(0, 24);
  return `${sourceId}:${digest}`;
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
  for (const row of rows) await assertPeriodOpen(shopId, new Date(row.businessDate), client);
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
    const batchSourceId = journalBatchSourceId(sourceRows);
    await client.journalEntry.create({ data: {
      shopId, sourceType: source.sourceType, sourceId: batchSourceId, businessDate: source.businessDate,
      description: `${source.sourceType}:${source.sourceId}`,
      evidenceJson: JSON.stringify({
        version: 2,
        projectionVersion: GENERAL_LEDGER_VERSION,
        originalSourceId: source.sourceId,
        batchSourceId,
        ledgerRowIds: sourceRows.map((row) => row.id),
        ledgerIdempotencyKeys: sourceRows.map((row) => row.idempotencyKey).sort(),
      }),
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

export async function createAccount(shopId, input, client = db) {
  const systemKey = null;
  const existing = await client.chartOfAccount.findFirst({ where: { shopId, code: input.code } });
  if (existing) throw accountingError("An account with this code already exists", "ACCOUNT_CODE_EXISTS");
  return client.chartOfAccount.create({ data: { shopId, ...input, systemKey } });
}

export async function updateAccount(shopId, accountId, input, client = db) {
  const account = await client.chartOfAccount.findFirst({ where: { id: accountId, shopId }, include: { _count: { select: { lines: true } } } });
  if (!account) throw accountingError("Account not found", "ACCOUNT_NOT_FOUND", 404);
  if (account.systemKey) throw accountingError("System accounts are controlled by the posting engine", "SYSTEM_ACCOUNT_IMMUTABLE");
  if (input.active === false && account._count.lines > 0) throw accountingError("An account with journal history cannot be deactivated", "ACCOUNT_HAS_JOURNAL_HISTORY");
  return client.chartOfAccount.update({ where: { id: account.id }, data: input });
}

export async function createManualJournal(shopId, input, { sourceType = "manual_journal", actorUserId = null, client = db } = {}) {
  validateBalancedLines(input.lines);
  const businessDate = new Date(input.businessDate);
  await assertPeriodOpen(shopId, businessDate, client);
  const existing = await client.journalEntry.findUnique({ where: { shopId_sourceType_sourceId: { shopId, sourceType, sourceId: input.reference } } });
  if (existing) throw accountingError("This journal reference already exists", "JOURNAL_REFERENCE_EXISTS");
  const codes = [...new Set(input.lines.map((line) => line.accountCode))];
  const accounts = await client.chartOfAccount.findMany({ where: { shopId, active: true, code: { in: codes } } });
  if (accounts.length !== codes.length) throw accountingError("Every journal line must reference an active account in this shop", "JOURNAL_ACCOUNT_INVALID", 400);
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));
  return client.journalEntry.create({ data: {
    shopId, sourceType, sourceId: input.reference, businessDate, description: input.description,
    evidenceJson: JSON.stringify({ version: 1, actorUserId, manuallyApproved: true }),
    lines: { create: input.lines.map((line, index) => ({ shopId, accountId: accountByCode.get(line.accountCode).id, lineNumber: index + 1, debitPaise: BigInt(line.debitPaise), creditPaise: BigInt(line.creditPaise), memo: line.memo ?? null, evidenceJson: JSON.stringify({ version: 1, actorUserId, accountCode: line.accountCode }) })) },
  }, include: { lines: { include: { account: true } } } });
}

export async function reverseJournal(shopId, journalId, input, actorUserId = null, client = db) {
  const original = await client.journalEntry.findFirst({ where: { id: journalId, shopId, status: "posted" }, include: { lines: { include: { account: true } }, reversals: true } });
  if (!original) throw accountingError("Posted journal not found", "JOURNAL_NOT_FOUND", 404);
  if (!["manual_journal", "opening_balance", "document_approval"].includes(original.sourceType)) throw accountingError("System-generated journals must be corrected through their originating business transaction", "SYSTEM_JOURNAL_REVERSAL_FORBIDDEN", 400);
  if (original.reversals.length) throw accountingError("Journal is already reversed", "JOURNAL_ALREADY_REVERSED");
  const businessDate = input.businessDate ? new Date(input.businessDate) : new Date();
  await assertPeriodOpen(shopId, businessDate, client);
  return client.journalEntry.create({ data: {
    shopId, sourceType: "journal_reversal", sourceId: original.id, businessDate, reversalOfId: original.id,
    description: `Reversal: ${input.reason}`, evidenceJson: JSON.stringify({ version: 1, actorUserId, reason: input.reason, originalJournalId: original.id }),
    lines: { create: original.lines.map((line, index) => ({ shopId, accountId: line.accountId, lineNumber: index + 1, debitPaise: line.creditPaise, creditPaise: line.debitPaise, memo: input.reason, evidenceJson: JSON.stringify({ version: 1, actorUserId, reversedLineId: line.id, accountCode: line.account.code }) })) },
  }, include: { lines: true } });
}

export async function createAccountingPeriod(shopId, input, client = db) {
  const startsAt = new Date(input.startsAt); const endsAt = new Date(input.endsAt);
  const overlap = await client.accountingPeriod.findFirst({ where: { shopId, startsAt: { lte: endsAt }, endsAt: { gte: startsAt } } });
  if (overlap) throw accountingError(`Period overlaps ${overlap.name}`, "ACCOUNTING_PERIOD_OVERLAP");
  return client.accountingPeriod.create({ data: { shopId, name: input.name, startsAt, endsAt } });
}

export async function listAccountingPeriods(shopId, client = db) {
  return client.accountingPeriod.findMany({ where: { shopId }, orderBy: { startsAt: "desc" } });
}

export async function closeAccountingPeriod(shopId, periodId, input, actorUserId, client = db) {
  const period = await client.accountingPeriod.findFirst({ where: { id: periodId, shopId } });
  if (!period) throw accountingError("Accounting period not found", "ACCOUNTING_PERIOD_NOT_FOUND", 404);
  if (period.status === "closed") return period;
  const trial = await getTrialBalance(shopId, { from: period.startsAt.toISOString(), to: period.endsAt.toISOString() }, client);
  if (trial.status !== "balanced") throw accountingError("The period cannot close until its trial balance is balanced", "ACCOUNTING_PERIOD_UNBALANCED");
  return client.accountingPeriod.update({ where: { id: period.id }, data: { status: "closed", closedAt: new Date(), closedByUserId: actorUserId, closeReason: input.reason } });
}

export async function projectShopGeneralLedger(shopId, client = db) {
  const accounts = await ensureSystemAccounts(shopId, client);
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));
  const rows = await client.financialLedger.findMany({ where: { shopId }, orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  const existingJournals = await client.journalEntry.findMany({ where: { shopId }, select: { evidenceJson: true } });
  const projectedLedgerIds = new Set();
  for (const journal of existingJournals) {
    try { for (const id of JSON.parse(journal.evidenceJson).ledgerRowIds ?? []) projectedLedgerIds.add(id); } catch { /* permanent verification reports malformed evidence */ }
  }
  const groups = Map.groupBy(rows, (row) => `${row.sourceType}\u0000${row.sourceId}`);
  let created = 0;
  let existing = 0;
  for (const sourceRows of groups.values()) {
    const source = sourceRows[0];
    const rowsToProject = sourceRows.filter((row) => !projectedLedgerIds.has(row.id));
    if (!rowsToProject.length) { existing += 1; continue; }
    const supplemental = rowsToProject.length !== sourceRows.length;
    const journalSourceType = supplemental ? `${source.sourceType}_projection_supplement` : source.sourceType;
    const batchSourceId = journalBatchSourceId(rowsToProject);
    const projection = buildJournalProjection(rowsToProject);
    await client.journalEntry.create({ data: {
      shopId, sourceType: journalSourceType, sourceId: batchSourceId, businessDate: source.businessDate,
      description: `${journalSourceType}:${source.sourceId}`,
      evidenceJson: JSON.stringify({ version: 2, projectionVersion: GENERAL_LEDGER_VERSION, originalSourceId: source.sourceId, batchSourceId, supplemental, ledgerRowIds: rowsToProject.map((row) => row.id), ledgerIdempotencyKeys: rowsToProject.map((row) => row.idempotencyKey).sort() }),
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

export async function getProfitAndLoss(shopId, query = {}, client = db) {
  const trial = await getTrialBalance(shopId, query, client);
  const income = trial.accounts.filter((row) => row.category === "income").map((row) => ({ ...row, amountPaise: row.creditPaise - row.debitPaise }));
  const expenses = trial.accounts.filter((row) => row.category === "expense").map((row) => ({ ...row, amountPaise: row.debitPaise - row.creditPaise }));
  const totalIncomePaise = income.reduce((sum, row) => sum + row.amountPaise, 0);
  const totalExpensePaise = expenses.reduce((sum, row) => sum + row.amountPaise, 0);
  return { version: GENERAL_LEDGER_VERSION, from: query.from ?? null, to: query.to ?? null, totalIncomePaise, totalExpensePaise, netProfitPaise: totalIncomePaise - totalExpensePaise, income, expenses, basis: "posted_general_ledger" };
}

export async function getBalanceSheet(shopId, { asOf } = {}, client = db) {
  const trial = await getTrialBalance(shopId, { ...(asOf ? { to: asOf } : {}) }, client);
  const assets = trial.accounts.filter((row) => row.category === "asset").map((row) => ({ ...row, amountPaise: row.debitPaise - row.creditPaise }));
  const liabilities = trial.accounts.filter((row) => row.category === "liability").map((row) => ({ ...row, amountPaise: row.creditPaise - row.debitPaise }));
  const equityAccounts = trial.accounts.filter((row) => row.category === "equity").map((row) => ({ ...row, amountPaise: row.creditPaise - row.debitPaise }));
  const currentEarningsPaise = trial.accounts.filter((row) => row.category === "income").reduce((sum, row) => sum + row.creditPaise - row.debitPaise, 0)
    - trial.accounts.filter((row) => row.category === "expense").reduce((sum, row) => sum + row.debitPaise - row.creditPaise, 0);
  const totalAssetsPaise = assets.reduce((sum, row) => sum + row.amountPaise, 0);
  const totalLiabilitiesPaise = liabilities.reduce((sum, row) => sum + row.amountPaise, 0);
  const totalEquityPaise = equityAccounts.reduce((sum, row) => sum + row.amountPaise, 0) + currentEarningsPaise;
  return { version: GENERAL_LEDGER_VERSION, asOf: asOf ?? null, status: totalAssetsPaise === totalLiabilitiesPaise + totalEquityPaise ? "balanced" : "attention_required", totalAssetsPaise, totalLiabilitiesPaise, totalEquityPaise, differencePaise: totalAssetsPaise - totalLiabilitiesPaise - totalEquityPaise, assets, liabilities, equity: [...equityAccounts, { code: "CURRENT_EARNINGS", name: "Current earnings", category: "equity", normalSide: "credit", debitPaise: 0, creditPaise: 0, balancePaise: -currentEarningsPaise, amountPaise: currentEarningsPaise }] };
}

export async function getJournal(shopId, journalId, client = db) {
  const journal = await client.journalEntry.findFirst({ where: { id: journalId, shopId }, include: { lines: { orderBy: { lineNumber: "asc" }, include: { account: true } }, reversalOf: true, reversals: true } });
  if (!journal) throw accountingError("Journal not found", "JOURNAL_NOT_FOUND", 404);
  return journal;
}
