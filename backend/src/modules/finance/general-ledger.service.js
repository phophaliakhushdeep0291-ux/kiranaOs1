import db, { databaseEngine } from "../../db.js";
import { serializableTransaction } from "../../lib/transactions.js";
import { GENERAL_LEDGER_VERSION, SYSTEM_ACCOUNTS, buildJournalProjection } from "./ledger-projection.js";
import { buildLedgerIntegrity } from "./ledger-integrity.js";
import { publicPaise } from "./ledger-money.js";
export { GENERAL_LEDGER_VERSION, SYSTEM_ACCOUNTS, buildJournalProjection, projectLedgerRow } from "./ledger-projection.js";
import { createHash } from "node:crypto";
import { accountingMarketSnapshot, assertAccountingMarketClaim, shopAccountingMarket } from "../shops/market-policy.js";

function accountingError(message, code, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

// Every posting and period change takes the same database lock. The no-op
// UPDATE also invalidates an older PostgreSQL serializable snapshot, unlike
// an advisory/read lock; the outer transaction retries and sees a new close.
const lockedShops = new WeakMap();
async function lockAccountingShop(shopId, client) {
  if (databaseEngine === "postgres" && typeof client.$executeRaw === "function") {
    const shops = lockedShops.get(client) ?? new Set();
    if (shops.has(shopId)) return;
    await client.$executeRaw`UPDATE "Shop" SET "updatedAt" = "updatedAt" WHERE "id" = ${shopId}`;
    shops.add(shopId);
    lockedShops.set(client, shops);
  }
}

export async function assertPeriodOpen(shopId, businessDate, client) {
  if (!client.accountingPeriod) return;
  await lockAccountingShop(shopId, client);
  const locked = await client.accountingPeriod.findFirst({ where: { shopId, status: "closed", startsAt: { lte: businessDate }, endsAt: { gte: businessDate } } });
  if (locked) throw accountingError(`Accounting period ${locked.name} is closed`, "ACCOUNTING_PERIOD_CLOSED");
}

function validateBalancedLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2 || lines.some((line) => {
    const values = [line.debitPaise ?? 0, line.creditPaise ?? 0];
    return values.some((value) => typeof value !== "bigint" && !Number.isSafeInteger(value))
      || values.some((value) => value < 0) || (values[0] > 0) === (values[1] > 0);
  })) throw accountingError("Each journal line needs one non-negative integer debit or credit", "JOURNAL_LINE_INVALID", 400);
  const debitPaise = lines.reduce((sum, line) => sum + BigInt(line.debitPaise ?? 0), 0n);
  const creditPaise = lines.reduce((sum, line) => sum + BigInt(line.creditPaise ?? 0), 0n);
  if (debitPaise <= 0n || debitPaise !== creditPaise) throw accountingError("Journal debits and credits must be equal and non-zero", "GENERAL_LEDGER_UNBALANCED_JOURNAL", 400);
  return { debitPaise, creditPaise };
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
      update: { name: account.name, category: account.category, normalSide: account.normalSide, systemKey: account.systemKey, active: true },
    });
  }
  return client.chartOfAccount.findMany({ where: { shopId }, orderBy: { code: "asc" } });
}

export async function postFinancialLedgerRows(client, rows) {
  if (typeof client.$transaction === "function") return serializableTransaction((tx) => postFinancialLedgerRows(tx, rows), { client, timeout: 30000 });
  if (!rows.length) return [];
  const shopId = rows[0].shopId;
  if (rows.some((row) => row.shopId !== shopId)) throw new Error("A journal batch cannot span shops");
  // Production transactions capture the immutable shop identity once per batch.
  // Pure projection test clients can supply their own row snapshot.
  const market = client.shop ? await shopAccountingMarket(client, shopId) : accountingMarketSnapshot(rows[0]);
  for (const row of rows) assertAccountingMarketClaim(row, market);
  for (const row of rows) await assertPeriodOpen(shopId, new Date(row.businessDate), client);
  const createdRows = [];
  for (const row of rows) createdRows.push(await client.financialLedger.create({ data: { ...row, ...market } }));
  // Lightweight unit-test transaction doubles intentionally expose only the
  // financial ledger. Real Prisma transaction clients always expose both.
  if (!client.chartOfAccount || !client.journalEntry) return createdRows;
  const groups = Map.groupBy(createdRows, (row) => `${row.sourceType}\u0000${row.sourceId}\u0000${new Date(row.businessDate).toISOString()}`);
  let accounts = await client.chartOfAccount.findMany({ where: { shopId, active: true } });
  if (SYSTEM_ACCOUNTS.some((required) => !accounts.some((account) => account.code === required.code))) accounts = await ensureSystemAccounts(shopId, client);
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));
  for (const sourceRows of groups.values()) {
    const source = sourceRows[0];
    const projection = buildJournalProjection(sourceRows);
    const batchSourceId = journalBatchSourceId(sourceRows);
    await client.journalEntry.create({ data: {
      ...accountingMarketSnapshot(source),
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
  if (typeof client.$transaction === "function") return serializableTransaction((tx) => createManualJournal(shopId, input, { sourceType, actorUserId, client: tx }), { client, timeout: 30000 });
  const market = await shopAccountingMarket(client, shopId);
  assertAccountingMarketClaim(input, market);
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
    ...market,
    shopId, sourceType, sourceId: input.reference, businessDate, description: input.description,
    evidenceJson: JSON.stringify({ version: 1, actorUserId, manuallyApproved: true }),
    lines: { create: input.lines.map((line, index) => ({ shopId, accountId: accountByCode.get(line.accountCode).id, lineNumber: index + 1, debitPaise: BigInt(line.debitPaise ?? 0), creditPaise: BigInt(line.creditPaise ?? 0), memo: line.memo ?? null, evidenceJson: JSON.stringify({ version: 1, actorUserId, accountCode: line.accountCode }) })) },
  }, include: { lines: { include: { account: true } } } });
}

export async function reverseJournal(shopId, journalId, input, actorUserId = null, client = db) {
  if (typeof client.$transaction === "function") return serializableTransaction((tx) => reverseJournal(shopId, journalId, input, actorUserId, tx), { client, timeout: 30000 });
  const original = await client.journalEntry.findFirst({ where: { id: journalId, shopId, status: "posted" }, include: { lines: { include: { account: true } }, reversals: true } });
  if (!original) throw accountingError("Posted journal not found", "JOURNAL_NOT_FOUND", 404);
  if (!["manual_journal", "opening_balance", "document_approval"].includes(original.sourceType)) throw accountingError("System-generated journals must be corrected through their originating business transaction", "SYSTEM_JOURNAL_REVERSAL_FORBIDDEN", 400);
  if (original.reversals.length) throw accountingError("Journal is already reversed", "JOURNAL_ALREADY_REVERSED");
  const businessDate = input.businessDate ? new Date(input.businessDate) : new Date();
  await assertPeriodOpen(shopId, businessDate, client);
  return client.journalEntry.create({ data: {
    ...accountingMarketSnapshot(original),
    shopId, sourceType: "journal_reversal", sourceId: original.id, businessDate, reversalOfId: original.id,
    description: `Reversal: ${input.reason}`, evidenceJson: JSON.stringify({ version: 1, actorUserId, reason: input.reason, originalJournalId: original.id }),
    lines: { create: original.lines.map((line, index) => ({ shopId, accountId: line.accountId, lineNumber: index + 1, debitPaise: line.creditPaise, creditPaise: line.debitPaise, memo: input.reason, evidenceJson: JSON.stringify({ version: 1, actorUserId, reversedLineId: line.id, accountCode: line.account.code }) })) },
  }, include: { lines: true } });
}

export async function createAccountingPeriod(shopId, input, client = db) {
  if (typeof client.$transaction === "function") return serializableTransaction((tx) => createAccountingPeriod(shopId, input, tx), { client, timeout: 30000 });
  await lockAccountingShop(shopId, client);
  const startsAt = new Date(input.startsAt); const endsAt = new Date(input.endsAt);
  const overlap = await client.accountingPeriod.findFirst({ where: { shopId, startsAt: { lte: endsAt }, endsAt: { gte: startsAt } } });
  if (overlap) throw accountingError(`Period overlaps ${overlap.name}`, "ACCOUNTING_PERIOD_OVERLAP");
  return client.accountingPeriod.create({ data: { shopId, name: input.name, startsAt, endsAt } });
}

export async function listAccountingPeriods(shopId, client = db) {
  return client.accountingPeriod.findMany({ where: { shopId }, orderBy: { startsAt: "desc" } });
}

export async function closeAccountingPeriod(shopId, periodId, input, actorUserId, client = db) {
  if (typeof client.$transaction === "function") return serializableTransaction((tx) => closeAccountingPeriod(shopId, periodId, input, actorUserId, tx), { client, timeout: 30000 });
  await lockAccountingShop(shopId, client);
  const period = await client.accountingPeriod.findFirst({ where: { id: periodId, shopId } });
  if (!period) throw accountingError("Accounting period not found", "ACCOUNTING_PERIOD_NOT_FOUND", 404);
  if (period.status === "closed") return period;
  const trial = await getTrialBalance(shopId, { from: period.startsAt.toISOString(), to: period.endsAt.toISOString() }, client);
  if (trial.integrity.status === "attention_required") throw accountingError("Resolve missing or inconsistent journal evidence before closing this period", "ACCOUNTING_PERIOD_INTEGRITY_FAILED");
  if (trial.differencePaise !== 0) throw accountingError("The period cannot close until its trial balance is balanced", "ACCOUNTING_PERIOD_UNBALANCED");
  return client.accountingPeriod.update({ where: { id: period.id }, data: { status: "closed", closedAt: new Date(), closedByUserId: actorUserId, closeReason: input.reason } });
}

export async function projectShopGeneralLedger(shopId, client = db) {
  if (typeof client.$transaction === "function") return serializableTransaction((tx) => projectShopGeneralLedger(shopId, tx), { client, timeout: 30000 });
  await lockAccountingShop(shopId, client);
  const accounts = await ensureSystemAccounts(shopId, client);
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));
  const rows = await client.financialLedger.findMany({ where: { shopId }, orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  const existingJournals = await client.journalEntry.findMany({ where: { shopId, status: "posted" }, include: { lines: { include: { account: true } } } });
  const integrity = buildLedgerIntegrity(shopId, rows, existingJournals);
  if (integrity.mismatchedRows || integrity.invalidJournals || integrity.unmappedRows) {
    throw accountingError("Existing journal evidence needs review before projecting more entries", "GENERAL_LEDGER_INTEGRITY_FAILED");
  }
  const projectedLedgerIds = new Set();
  for (const journal of existingJournals) {
    try { for (const id of JSON.parse(journal.evidenceJson).ledgerRowIds ?? []) projectedLedgerIds.add(id); } catch { /* permanent verification reports malformed evidence */ }
  }
  const groups = Map.groupBy(rows, (row) => `${row.sourceType}\u0000${row.sourceId}\u0000${new Date(row.businessDate).toISOString()}`);
  let created = 0;
  let existing = 0;
  for (const sourceRows of groups.values()) {
    const rowsToProject = sourceRows.filter((row) => !projectedLedgerIds.has(row.id));
    if (!rowsToProject.length) { existing += 1; continue; }
    const source = rowsToProject[0];
    await assertPeriodOpen(shopId, new Date(source.businessDate), client);
    const supplemental = rowsToProject.length !== sourceRows.length;
    const journalSourceType = supplemental ? `${source.sourceType}_projection_supplement` : source.sourceType;
    const batchSourceId = journalBatchSourceId(rowsToProject);
    const projection = buildJournalProjection(rowsToProject);
    await client.journalEntry.create({ data: {
      ...accountingMarketSnapshot(source),
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
  // A single snapshot prevents a sale committed between reads from looking like
  // a missing journal. Reuse an existing mutation transaction during close.
  if (typeof client.$transaction === "function") return serializableTransaction((tx) => getTrialBalance(shopId, { from, to }, tx), { client, timeout: 30000 });
  const businessDate = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
  const journals = await client.journalEntry.findMany({
    where: { shopId, status: "posted", businessDate },
    include: { lines: { include: { account: true } } },
  });
  const sources = await client.financialLedger.findMany({ where: { shopId, businessDate } });
  const integrity = buildLedgerIntegrity(shopId, sources, journals);
  // Include inactive accounts with history; disabling a name must never erase
  // its money from the books. Never disclose a foreign account's identity.
  const accounts = await client.chartOfAccount.findMany({ where: { shopId }, orderBy: { code: "asc" } });
  const totals = new Map(accounts.map((account) => [account.id, { debit: 0n, credit: 0n }]));
  for (const journal of journals) for (const line of journal.lines) {
    if (line.shopId !== shopId || line.account.shopId !== shopId) continue;
    const amount = totals.get(line.accountId);
    amount.debit += BigInt(line.debitPaise); amount.credit += BigInt(line.creditPaise);
  }
  const rows = accounts.map((account) => {
    const { debit, credit } = totals.get(account.id);
    return { code: account.code, name: account.name, category: account.category, normalSide: account.normalSide, debitPaise: debit, creditPaise: credit, balancePaise: debit - credit };
  });
  const debit = rows.reduce((sum, row) => sum + row.debitPaise, 0n);
  const credit = rows.reduce((sum, row) => sum + row.creditPaise, 0n);
  const status = integrity.status === "attention_required" || debit !== credit ? "attention_required"
    : integrity.status === "no_data" ? "no_data" : "balanced";
  return { version: GENERAL_LEDGER_VERSION, status, integrity, totalDebitPaise: publicPaise(debit), totalCreditPaise: publicPaise(credit), differencePaise: publicPaise(debit - credit),
    accounts: rows.map((row) => ({ ...row, debitPaise: publicPaise(row.debitPaise), creditPaise: publicPaise(row.creditPaise), balancePaise: publicPaise(row.balancePaise) })) };
}

const sumAmounts = (rows) => rows.reduce((sum, row) => sum + BigInt(row.amountPaise), 0n);
const statementRows = (trial, category, creditNormal) => trial.accounts.filter((row) => row.category === category).map((row) => ({
  ...row, amountPaise: publicPaise(creditNormal ? -BigInt(row.balancePaise) : BigInt(row.balancePaise)),
}));

export async function getProfitAndLoss(shopId, query = {}, client = db) {
  const trial = await getTrialBalance(shopId, query, client);
  const income = statementRows(trial, "income", true);
  const expenses = statementRows(trial, "expense", false);
  const totalIncome = sumAmounts(income); const totalExpense = sumAmounts(expenses);
  return { version: GENERAL_LEDGER_VERSION, status: trial.status, integrity: trial.integrity, from: query.from ?? null, to: query.to ?? null,
    totalIncomePaise: publicPaise(totalIncome), totalExpensePaise: publicPaise(totalExpense), netProfitPaise: publicPaise(totalIncome - totalExpense), income, expenses, basis: "posted_general_ledger" };
}

export async function getBalanceSheet(shopId, { asOf } = {}, client = db) {
  const trial = await getTrialBalance(shopId, { ...(asOf ? { to: asOf } : {}) }, client);
  const assets = statementRows(trial, "asset", false);
  const liabilities = statementRows(trial, "liability", true);
  const equityAccounts = statementRows(trial, "equity", true);
  const earnings = sumAmounts(statementRows(trial, "income", true)) - sumAmounts(statementRows(trial, "expense", false));
  const totalAssets = sumAmounts(assets); const totalLiabilities = sumAmounts(liabilities); const totalEquity = sumAmounts(equityAccounts) + earnings;
  return { version: GENERAL_LEDGER_VERSION, asOf: asOf ?? null, status: trial.status, integrity: trial.integrity,
    totalAssetsPaise: publicPaise(totalAssets), totalLiabilitiesPaise: publicPaise(totalLiabilities), totalEquityPaise: publicPaise(totalEquity),
    differencePaise: publicPaise(totalAssets - totalLiabilities - totalEquity), assets, liabilities,
    equity: [...equityAccounts, { code: "CURRENT_EARNINGS", name: "Current earnings", category: "equity", normalSide: "credit", debitPaise: 0, creditPaise: 0, balancePaise: publicPaise(-earnings), amountPaise: publicPaise(earnings) }] };
}

export async function getJournal(shopId, journalId, client = db) {
  const journal = await client.journalEntry.findFirst({ where: { id: journalId, shopId }, include: { lines: { orderBy: { lineNumber: "asc" }, include: { account: true } }, reversalOf: true, reversals: true } });
  if (!journal) throw accountingError("Journal not found", "JOURNAL_NOT_FOUND", 404);
  return journal;
}
