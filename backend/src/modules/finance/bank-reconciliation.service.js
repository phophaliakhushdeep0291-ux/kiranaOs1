import crypto from "node:crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";

export const BANK_RECONCILIATION_VERSION = "bank-reconciliation-v1";
export const BANK_RECONCILIATION_LIMITATIONS = [
  "This is a CSV/manual reconciliation control, not a live bank or payment-provider feed.",
  "Candidate suggestions use recorded facts only and are never matched automatically; an owner must confirm every allocation.",
  "Only direct bank/UPI impacts already recorded in FinancialLedger are eligible. Netted fees and settlement batches may require explicit multi-row allocation.",
  "A ledger impact can belong to only one active statement match and cannot be split across statement transactions in this version.",
  "Historical activity missing from FinancialLedger cannot be inferred or reconciled by this control.",
];

const MAX_STATEMENT_ROWS = 5_000;
const MAX_SAFE_PAISE = BigInt(Number.MAX_SAFE_INTEGER);
const DAY_MS = 86_400_000;

const HEADER_ALIASES = {
  date: ["date", "transactiondate", "valuedate", "postingdate"],
  description: ["description", "narration", "particulars", "transactiondetails", "remarks", "details"],
  reference: ["reference", "referenceno", "referencenumber", "refno", "utr", "transactionid", "txnid", "chequeno"],
  debit: ["debit", "withdrawal", "withdrawals", "debitamount", "withdrawalamount"],
  credit: ["credit", "deposit", "deposits", "creditamount", "depositamount"],
  amount: ["amount", "transactionamount", "txnamount"],
  direction: ["direction", "type", "transactiontype", "debitcredit", "drcr"],
  balance: ["balance", "closingbalance", "runningbalance", "availablebalance"],
};

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeEvidenceText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function fail(message, statusCode, code, publicData) {
  const error = new AppError(message, statusCode, code);
  if (publicData) error.publicData = publicData;
  throw error;
}

function parseCsvMatrix(csvText) {
  const text = String(csvText ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length) fail("Malformed CSV: quote starts inside an unquoted value", 422, "BANK_STATEMENT_INVALID");
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (quoted) fail("Malformed CSV: unclosed quoted value", 422, "BANK_STATEMENT_INVALID");
  row.push(field);
  rows.push(row);
  return rows.filter((values) => values.some((value) => String(value).trim() !== ""));
}

function parseStatementDate(raw) {
  const value = String(raw ?? "").trim();
  let year;
  let month;
  let day;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    [, year, month, day] = match;
  } else {
    match = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value);
    if (!match) throw new Error("Use YYYY-MM-DD or DD/MM/YYYY");
    [, day, month, year] = match;
  }
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
  ) throw new Error("Date is not valid");
  return parsed;
}

function parsePaise(raw, { allowBlank = false, allowSigned = false } = {}) {
  const original = String(raw ?? "").trim();
  if (!original) {
    if (allowBlank) return null;
    throw new Error("Amount is required");
  }
  let value = original
    .replace(/₹/g, "")
    .replace(/\b(?:inr|rs\.?)\b/gi, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (value.startsWith("+")) value = value.slice(1);
  else if (value.startsWith("-")) {
    negative = !negative;
    value = value.slice(1);
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Amount must have at most two decimal places");
  }
  const [whole, fraction = ""] = value.split(".");
  let paise = (BigInt(whole) * 100n) + BigInt(fraction.padEnd(2, "0"));
  if (paise > MAX_SAFE_PAISE) throw new Error("Amount is too large");
  if (negative) paise = -paise;
  if (!allowSigned && paise < 0n) throw new Error("Amount cannot be negative in this column");
  return paise;
}

function parseDirection(raw) {
  const value = normalizeHeader(raw);
  if (["credit", "cr", "deposit", "in", "incoming", "received"].includes(value)) return "credit";
  if (["debit", "dr", "withdrawal", "out", "outgoing", "paid"].includes(value)) return "debit";
  throw new Error("Direction must identify debit/withdrawal or credit/deposit");
}

function columnIndexes(headers) {
  const normalized = headers.map(normalizeHeader);
  const result = {};
  for (const [name, aliases] of Object.entries(HEADER_ALIASES)) {
    result[name] = normalized.findIndex((header) => aliases.includes(header));
  }
  const missing = [];
  if (result.date < 0) missing.push("date");
  if (result.description < 0 && result.reference < 0) missing.push("description or reference");
  const hasDebitCredit = result.debit >= 0 && result.credit >= 0;
  if (!hasDebitCredit && result.amount < 0) missing.push("debit+credit columns or amount");
  if (missing.length) {
    fail(`Statement columns missing: ${missing.join(", ")}`, 422, "BANK_STATEMENT_INVALID", {
      requiredColumns: ["date", "description or reference", "debit+credit or amount(+direction)"],
    });
  }
  return result;
}

function cell(row, index) {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function canonicalTransactionFingerprint(account, row) {
  return sha256([
    account.accountType,
    normalizeEvidenceText(account.accountName),
    account.accountLast4 ?? "",
    row.transactionDate.toISOString().slice(0, 10),
    row.direction,
    row.amountPaise.toString(),
    normalizeEvidenceText(row.reference),
    normalizeEvidenceText(row.description),
  ].join("|"));
}

/**
 * Strict RFC4180-style CSV parsing. Every row is validated before anything is
 * written, so one malformed value rejects the whole import.
 */
export function parseBankStatementCsv(csvText, account = {}) {
  const matrix = parseCsvMatrix(csvText);
  if (matrix.length < 2) {
    fail("Statement must contain a header and at least one transaction", 422, "BANK_STATEMENT_INVALID");
  }
  if (matrix.length - 1 > MAX_STATEMENT_ROWS) {
    fail(`Statement exceeds the ${MAX_STATEMENT_ROWS}-row import limit`, 422, "BANK_STATEMENT_TOO_MANY_ROWS");
  }
  const indexes = columnIndexes(matrix[0]);
  const parsedRows = [];
  const rowErrors = [];

  for (let index = 1; index < matrix.length; index += 1) {
    const source = matrix[index];
    try {
      const transactionDate = parseStatementDate(cell(source, indexes.date));
      const description = cell(source, indexes.description) || cell(source, indexes.reference);
      const reference = cell(source, indexes.reference) || null;
      if (!description) throw new Error("Description or reference is required");

      let direction;
      let amountPaise;
      const usesDebitCredit = indexes.debit >= 0 && indexes.credit >= 0;
      if (usesDebitCredit) {
        const debit = parsePaise(cell(source, indexes.debit), { allowBlank: true }) ?? 0n;
        const credit = parsePaise(cell(source, indexes.credit), { allowBlank: true }) ?? 0n;
        if ((debit > 0n && credit > 0n) || (debit === 0n && credit === 0n)) {
          throw new Error("Exactly one of debit or credit must be greater than zero");
        }
        direction = debit > 0n ? "debit" : "credit";
        amountPaise = debit > 0n ? debit : credit;
      } else {
        const signedAmount = parsePaise(cell(source, indexes.amount), { allowSigned: true });
        if (signedAmount === 0n) throw new Error("Amount must be greater than zero");
        if (indexes.direction >= 0 && cell(source, indexes.direction)) {
          direction = parseDirection(cell(source, indexes.direction));
          amountPaise = signedAmount < 0n ? -signedAmount : signedAmount;
        } else {
          direction = signedAmount < 0n ? "debit" : "credit";
          amountPaise = signedAmount < 0n ? -signedAmount : signedAmount;
        }
      }

      let balancePaise = null;
      if (indexes.balance >= 0 && cell(source, indexes.balance)) {
        balancePaise = parsePaise(cell(source, indexes.balance), { allowSigned: true });
      }
      const parsed = {
        rowNumber: index + 1,
        transactionDate,
        description: description.slice(0, 500),
        reference: reference?.slice(0, 200) ?? null,
        direction,
        amountPaise,
        balancePaise,
      };
      parsed.fingerprint = canonicalTransactionFingerprint(account, parsed);
      parsedRows.push(parsed);
    } catch (error) {
      rowErrors.push({ rowNumber: index + 1, message: error.message });
    }
  }

  if (rowErrors.length) {
    fail("Statement import rejected; correct every invalid row and retry", 422, "BANK_STATEMENT_INVALID", {
      rowErrors: rowErrors.slice(0, 100),
      invalidRowCount: rowErrors.length,
      importedRowCount: 0,
    });
  }
  return {
    rows: parsedRows,
    statementFrom: new Date(Math.min(...parsedRows.map((row) => row.transactionDate.getTime()))),
    statementTo: new Date(Math.max(...parsedRows.map((row) => row.transactionDate.getTime()))),
  };
}

function asBigInt(value) {
  try { return BigInt(value ?? 0); } catch { return 0n; }
}

function publicMoney(paise) {
  const value = asBigInt(paise);
  return { paise: Number(value), amount: Number(value) / 100 };
}

/**
 * Returns the bank/UPI asset impact represented by one immutable ledger row.
 * Statement convention: credit means funds entered the asset, debit means left.
 */
export function bankImpactForLedgerRow(row, accountType) {
  const entryType = String(row?.entryType ?? "").toLowerCase();
  const paymentMode = String(row?.paymentMode ?? "").toLowerCase();
  let baseSign = 0n;

  if (accountType === "bank") {
    if (["bank_in", "bank_refund_in"].includes(entryType)) baseSign = 1n;
    else if (entryType === "bank_out") baseSign = -1n;
    else if (entryType === "supplier_payment" && ["bank", "card"].includes(paymentMode)) baseSign = -1n;
  } else if (accountType === "upi") {
    if (["upi_in", "upi_refund_in"].includes(entryType)) baseSign = 1n;
    else if (entryType === "upi_out") baseSign = -1n;
    else if (entryType === "supplier_payment" && paymentMode === "upi") baseSign = -1n;
  }

  const sourceAmount = asBigInt(row?.amountPaise);
  const signedImpact = baseSign * sourceAmount;
  if (signedImpact === 0n) return null;
  return {
    direction: signedImpact > 0n ? "credit" : "debit",
    amountPaise: signedImpact > 0n ? signedImpact : -signedImpact,
  };
}

function dateDeltaDays(left, right) {
  return Math.round(Math.abs(new Date(left).getTime() - new Date(right).getTime()) / DAY_MS);
}

function referenceMatches(transaction, row) {
  const needle = normalizeHeader(transaction?.reference || transaction?.description);
  if (!needle || needle.length < 4) return false;
  return [row?.sourceId, row?.paymentId, row?.billId, row?.purchaseBillId, row?.id]
    .map(normalizeHeader)
    .some((candidate) => candidate && (candidate.includes(needle) || needle.includes(candidate)));
}

function publicLedgerCandidate(row, impact, transaction) {
  const delta = dateDeltaDays(transaction.transactionDate, row.businessDate);
  const referenceMatched = referenceMatches(transaction, row);
  const exactAmount = impact.amountPaise === asBigInt(transaction.remainingAmountPaise ?? transaction.amountPaise);
  const score = 80 + Math.max(0, 15 - (delta * 5)) + (referenceMatched ? 5 : 0);
  return {
    ledgerRowId: row.id,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    entryType: row.entryType,
    businessDate: row.businessDate,
    paymentMode: row.paymentMode ?? null,
    direction: impact.direction,
    amount: publicMoney(impact.amountPaise),
    dateDeltaDays: delta,
    exactAmount,
    referenceMatched,
    score,
    confidence: exactAmount
      ? (referenceMatched ? "exact_amount_date_reference" : "exact_amount_date")
      : "eligible_manual_allocation",
    reasons: [
      "Exact statement direction",
      exactAmount ? "Exact remaining amount" : "Eligible amount for manual multi-row allocation",
      `Recorded ${delta} day${delta === 1 ? "" : "s"} from statement date`,
      ...(referenceMatched ? ["Recorded reference matches statement evidence"] : []),
    ],
  };
}

/**
 * Deterministic, inspectable suggestions. Exact amount, direction, and a
 * three-day window are mandatory. Equal top scores are labeled ambiguous.
 */
export function buildBankCandidateSuggestions(transaction, ledgerRows = [], activeLedgerRowIds = new Set()) {
  const remaining = asBigInt(transaction.remainingAmountPaise ?? transaction.amountPaise);
  const exact = [];
  const allocationOptions = [];
  for (const row of ledgerRows) {
    if (activeLedgerRowIds.has(row.id)) continue;
    const impact = bankImpactForLedgerRow(row, transaction.accountType);
    if (!impact || impact.direction !== transaction.direction) continue;
    const delta = dateDeltaDays(transaction.transactionDate, row.businessDate);
    if (delta > 3 || impact.amountPaise > remaining) continue;
    const candidate = publicLedgerCandidate(row, impact, { ...transaction, remainingAmountPaise: remaining });
    allocationOptions.push(candidate);
    if (impact.amountPaise === remaining) exact.push(candidate);
  }
  const order = (left, right) => right.score - left.score
    || left.dateDeltaDays - right.dateDeltaDays
    || String(left.ledgerRowId).localeCompare(String(right.ledgerRowId));
  exact.sort(order);
  allocationOptions.sort(order);
  const ambiguous = exact.length > 1 && exact[0].score === exact[1].score;
  return {
    suggestions: exact.map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      ambiguous: ambiguous && candidate.score === exact[0].score,
    })),
    allocationOptions,
    autoMatched: false,
  };
}

function publicImport(record) {
  return {
    id: record.id,
    accountType: record.accountType,
    accountName: record.accountName,
    accountLast4: record.accountLast4,
    fileName: record.fileName,
    statementFrom: record.statementFrom,
    statementTo: record.statementTo,
    rowCount: record.rowCount,
    importedCount: record.importedCount,
    duplicateCount: record.duplicateCount,
    status: record.status,
    importedByUserId: record.importedByUserId,
    createdAt: record.createdAt,
  };
}

async function findFingerprints(shopId, fingerprints, client = db) {
  const found = new Set();
  for (let offset = 0; offset < fingerprints.length; offset += 400) {
    const chunk = fingerprints.slice(offset, offset + 400);
    const records = await client.bankStatementTransaction.findMany({
      where: { shopId, fingerprint: { in: chunk } },
      select: { fingerprint: true },
    });
    for (const record of records) found.add(record.fingerprint);
  }
  return found;
}

export async function importBankStatement(shopId, input, { userId = null } = {}) {
  const account = {
    accountType: input.accountType,
    accountName: input.accountName.trim(),
    accountLast4: input.accountLast4 ?? null,
  };
  const parsed = parseBankStatementCsv(input.csvText, account);
  const normalizedCsv = String(input.csvText).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  const importFingerprint = sha256([
    account.accountType,
    normalizeEvidenceText(account.accountName),
    account.accountLast4 ?? "",
    normalizedCsv,
  ].join("|"));

  const replay = await db.bankStatementImport.findUnique({
    where: { shopId_fingerprint: { shopId, fingerprint: importFingerprint } },
  });
  if (replay) return { ...publicImport(replay), idempotentReplay: true };

  const existingFingerprints = await findFingerprints(shopId, parsed.rows.map((row) => row.fingerprint));
  const seen = new Set(existingFingerprints);
  const rowsToImport = [];
  let duplicateCount = 0;
  for (const row of parsed.rows) {
    if (seen.has(row.fingerprint)) {
      duplicateCount += 1;
    } else {
      seen.add(row.fingerprint);
      rowsToImport.push(row);
    }
  }

  const now = new Date();
  const importId = crypto.randomUUID();
  try {
    const created = await db.$transaction(async (tx) => {
      const record = await tx.bankStatementImport.create({
        data: {
          id: importId,
          shopId,
          ...account,
          fileName: input.fileName,
          statementFrom: parsed.statementFrom,
          statementTo: parsed.statementTo,
          rowCount: parsed.rows.length,
          importedCount: rowsToImport.length,
          duplicateCount,
          status: rowsToImport.length ? "processed" : "duplicate_only",
          fingerprint: importFingerprint,
          importedByUserId: userId,
          createdAt: now,
        },
      });
      for (let offset = 0; offset < rowsToImport.length; offset += 75) {
        const chunk = rowsToImport.slice(offset, offset + 75);
        await tx.bankStatementTransaction.createMany({
          data: chunk.map((row) => ({
            id: crypto.randomUUID(),
            shopId,
            importId,
            rowNumber: row.rowNumber,
            transactionDate: row.transactionDate,
            description: row.description,
            reference: row.reference,
            direction: row.direction,
            amountPaise: row.amountPaise,
            balancePaise: row.balancePaise,
            fingerprint: row.fingerprint,
            matchStatus: "unmatched",
            reconciledAmountPaise: 0n,
            createdAt: now,
            updatedAt: now,
          })),
        });
      }
      return record;
    });
    return { ...publicImport(created), idempotentReplay: false };
  } catch (error) {
    if (error?.code === "P2002") {
      const concurrentReplay = await db.bankStatementImport.findUnique({
        where: { shopId_fingerprint: { shopId, fingerprint: importFingerprint } },
      });
      if (concurrentReplay) return { ...publicImport(concurrentReplay), idempotentReplay: true };
      fail("One or more statement rows were imported concurrently; reload before retrying", 409, "BANK_STATEMENT_IMPORT_CONFLICT");
    }
    throw error;
  }
}

export async function listBankStatementImports(shopId, { accountType, limit = 25 } = {}) {
  const records = await db.bankStatementImport.findMany({
    where: { shopId, ...(accountType ? { accountType } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return {
    imports: records.map(publicImport),
    calculationVersion: BANK_RECONCILIATION_VERSION,
    limitations: BANK_RECONCILIATION_LIMITATIONS,
  };
}

function transactionWhere(shopId, query) {
  const where = { shopId };
  if (query.status && query.status !== "all") where.matchStatus = query.status;
  if (query.accountType) where.import = { accountType: query.accountType };
  if (query.from || query.to) {
    where.transactionDate = {};
    if (query.from) where.transactionDate.gte = new Date(query.from);
    if (query.to) where.transactionDate.lte = new Date(query.to);
  }
  return where;
}

function publicAllocation(allocation) {
  return {
    id: allocation.id,
    ledgerRowId: allocation.ledgerRowId,
    amount: publicMoney(allocation.amountPaise),
    method: allocation.method,
    status: allocation.status,
    evidence: safeJson(allocation.evidenceJson),
    matchedByUserId: allocation.matchedByUserId,
    matchedAt: allocation.matchedAt,
    ledgerRow: allocation.ledgerRow ? {
      sourceType: allocation.ledgerRow.sourceType,
      sourceId: allocation.ledgerRow.sourceId,
      entryType: allocation.ledgerRow.entryType,
      paymentMode: allocation.ledgerRow.paymentMode,
      businessDate: allocation.ledgerRow.businessDate,
    } : undefined,
  };
}

function safeJson(value) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function publicTransaction(record, candidates) {
  const remaining = asBigInt(record.amountPaise) - asBigInt(record.reconciledAmountPaise);
  return {
    id: record.id,
    rowNumber: record.rowNumber,
    transactionDate: record.transactionDate,
    description: record.description,
    reference: record.reference,
    direction: record.direction,
    amount: publicMoney(record.amountPaise),
    balance: record.balancePaise === null ? null : publicMoney(record.balancePaise),
    reconciledAmount: publicMoney(record.reconciledAmountPaise),
    remainingAmount: publicMoney(remaining),
    matchStatus: record.matchStatus,
    ignoredReason: record.ignoredReason,
    ignoredAt: record.ignoredAt,
    import: publicImport(record.import),
    allocations: record.allocations.map(publicAllocation),
    ...candidates,
  };
}

export async function getBankReconciliation(shopId, query = {}) {
  const where = transactionWhere(shopId, query);
  const include = {
    import: true,
    allocations: {
      where: { status: "active" },
      include: { ledgerRow: true },
      orderBy: [{ matchedAt: "asc" }, { id: "asc" }],
    },
  };
  const [total, aggregate, statusGroups, records] = await Promise.all([
    db.bankStatementTransaction.count({ where }),
    db.bankStatementTransaction.aggregate({
      where,
      _sum: { amountPaise: true, reconciledAmountPaise: true },
    }),
    db.bankStatementTransaction.groupBy({
      by: ["matchStatus"],
      where,
      _count: { _all: true },
    }),
    db.bankStatementTransaction.findMany({
      where,
      include,
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: query.offset ?? 0,
      take: query.limit ?? 50,
    }),
  ]);

  let ledgerRows = [];
  let candidateCoverageTruncated = false;
  if (records.length) {
    const times = records.map((record) => record.transactionDate.getTime());
    const start = new Date(Math.min(...times) - (3 * DAY_MS));
    const end = new Date(Math.max(...times) + (3 * DAY_MS));
    ledgerRows = await db.financialLedger.findMany({
      where: {
        shopId,
        businessDate: { gte: start, lte: end },
        OR: [
          { entryType: { in: ["bank_in", "bank_out", "bank_refund_in", "upi_in", "upi_out", "upi_refund_in"] } },
          { entryType: "supplier_payment", paymentMode: { in: ["bank", "card", "upi"] } },
        ],
      },
      orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: 5_001,
    });
    if (ledgerRows.length > 5_000) {
      candidateCoverageTruncated = true;
      ledgerRows = ledgerRows.slice(0, 5_000);
    }
  }
  const ledgerIds = ledgerRows.map((row) => row.id);
  const active = ledgerIds.length ? await db.bankReconciliationAllocation.findMany({
    where: { shopId, status: "active", ledgerRowId: { in: ledgerIds } },
    select: { ledgerRowId: true },
  }) : [];
  const activeLedgerRowIds = new Set(active.map((record) => record.ledgerRowId));

  const transactions = records.map((record) => {
    const remainingAmountPaise = asBigInt(record.amountPaise) - asBigInt(record.reconciledAmountPaise);
    const candidates = record.matchStatus === "ignored" || remainingAmountPaise <= 0n
      ? { suggestions: [], allocationOptions: [], autoMatched: false }
      : buildBankCandidateSuggestions({
        transactionDate: record.transactionDate,
        direction: record.direction,
        amountPaise: record.amountPaise,
        remainingAmountPaise,
        reference: record.reference,
        description: record.description,
        accountType: record.import.accountType,
      }, ledgerRows, activeLedgerRowIds);
    return publicTransaction(record, candidates);
  });
  const counts = Object.fromEntries(statusGroups.map((group) => [group.matchStatus, group._count._all]));
  const totalPaise = asBigInt(aggregate._sum.amountPaise);
  const reconciledPaise = asBigInt(aggregate._sum.reconciledAmountPaise);

  return {
    calculationVersion: BANK_RECONCILIATION_VERSION,
    scope: "shop",
    autoMatch: false,
    summary: {
      transactionCount: total,
      counts: {
        unmatched: counts.unmatched ?? 0,
        partial: counts.partial ?? 0,
        matched: counts.matched ?? 0,
        ignored: counts.ignored ?? 0,
      },
      total: publicMoney(totalPaise),
      reconciled: publicMoney(reconciledPaise),
      remaining: publicMoney(totalPaise - reconciledPaise),
    },
    pagination: {
      offset: query.offset ?? 0,
      limit: query.limit ?? 50,
      total,
      hasMore: (query.offset ?? 0) + records.length < total,
    },
    candidateCoverage: {
      windowDays: 3,
      ledgerRowsEvaluated: ledgerRows.length,
      truncated: candidateCoverageTruncated,
    },
    transactions,
    limitations: BANK_RECONCILIATION_LIMITATIONS,
  };
}

async function loadTransaction(shopId, transactionId) {
  const transaction = await db.bankStatementTransaction.findFirst({
    where: { id: transactionId, shopId },
    include: {
      import: true,
      allocations: { where: { status: "active" }, orderBy: [{ matchedAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!transaction) fail("Statement transaction not found", 404, "BANK_TRANSACTION_NOT_FOUND");
  return transaction;
}

function assertReconciliationState(transaction) {
  const allocated = transaction.allocations.reduce((sum, allocation) => sum + asBigInt(allocation.amountPaise), 0n);
  if (allocated !== asBigInt(transaction.reconciledAmountPaise)) {
    fail("Reconciliation state drift detected; review the transaction before changing it", 409, "BANK_RECONCILIATION_STATE_DRIFT");
  }
  return allocated;
}

export async function matchBankTransaction(shopId, transactionId, input, { userId = null } = {}) {
  const transaction = await loadTransaction(shopId, transactionId);
  if (transaction.matchStatus === "ignored") {
    fail("Restore this ignored transaction before matching it", 409, "BANK_TRANSACTION_IGNORED");
  }
  const allocated = assertReconciliationState(transaction);
  const ledgerRows = await db.financialLedger.findMany({
    where: { shopId, id: { in: input.ledgerRowIds } },
  });
  if (ledgerRows.length !== input.ledgerRowIds.length) {
    fail("One or more ledger rows do not exist in this shop", 404, "BANK_LEDGER_ROW_NOT_FOUND");
  }
  const rowById = new Map(ledgerRows.map((row) => [row.id, row]));
  const orderedRows = input.ledgerRowIds.map((id) => rowById.get(id));
  const conflicts = await db.bankReconciliationAllocation.findMany({
    where: { shopId, status: "active", ledgerRowId: { in: input.ledgerRowIds } },
    select: { ledgerRowId: true, bankStatementTransactionId: true },
  });
  if (conflicts.length) {
    fail("A selected ledger impact already belongs to an active statement match", 409, "BANK_LEDGER_ALREADY_MATCHED", {
      conflictingLedgerRowIds: conflicts.map((record) => record.ledgerRowId),
    });
  }

  const evidence = orderedRows.map((row) => {
    const impact = bankImpactForLedgerRow(row, transaction.import.accountType);
    if (!impact || impact.direction !== transaction.direction) {
      fail("Every selected ledger row must affect the same account and direction as the statement transaction", 422, "BANK_LEDGER_DIRECTION_MISMATCH", {
        ledgerRowId: row.id,
      });
    }
    return {
      row,
      impact,
      dateDeltaDays: dateDeltaDays(transaction.transactionDate, row.businessDate),
      referenceMatched: referenceMatches(transaction, row),
    };
  });
  const added = evidence.reduce((sum, item) => sum + item.impact.amountPaise, 0n);
  const newReconciled = allocated + added;
  const statementAmount = asBigInt(transaction.amountPaise);
  if (newReconciled > statementAmount) {
    fail("Selected ledger impacts exceed the statement amount", 422, "BANK_RECONCILIATION_OVERALLOCATED", {
      statementAmount: publicMoney(statementAmount),
      alreadyReconciled: publicMoney(allocated),
      selectedAmount: publicMoney(added),
    });
  }
  const requiresNote = input.ledgerRowIds.length > 1
    || newReconciled < statementAmount
    || evidence.some((item) => item.dateDeltaDays > 3);
  if (requiresNote && !input.note) {
    fail("A note is required for partial, multi-row, or outside-window matching", 422, "BANK_RECONCILIATION_NOTE_REQUIRED");
  }
  const now = new Date();
  const nextStatus = newReconciled === statementAmount ? "matched" : "partial";

  try {
    await db.$transaction(async (tx) => {
      for (const item of evidence) {
        await tx.bankReconciliationAllocation.create({
          data: {
            id: crypto.randomUUID(),
            shopId,
            bankStatementTransactionId: transaction.id,
            ledgerRowId: item.row.id,
            amountPaise: item.impact.amountPaise,
            activeLedgerKey: item.row.id,
            activeBankLedgerKey: `${transaction.id}:${item.row.id}`,
            method: "manual_exact_direction",
            evidenceJson: JSON.stringify({
              calculationVersion: BANK_RECONCILIATION_VERSION,
              statementDirection: transaction.direction,
              statementAmountPaise: transaction.amountPaise.toString(),
              ledgerAmountPaise: item.impact.amountPaise.toString(),
              dateDeltaDays: item.dateDeltaDays,
              referenceMatched: item.referenceMatched,
              note: input.note ?? null,
              autoMatched: false,
            }),
            status: "active",
            matchedByUserId: userId,
            matchedAt: now,
          },
        });
      }
      const changed = await tx.bankStatementTransaction.updateMany({
        where: {
          id: transaction.id,
          shopId,
          reconciledAmountPaise: transaction.reconciledAmountPaise,
          matchStatus: transaction.matchStatus,
        },
        data: {
          reconciledAmountPaise: newReconciled,
          matchStatus: nextStatus,
          updatedAt: now,
        },
      });
      if (changed.count !== 1) {
        fail("Transaction changed during matching; reload and retry", 409, "BANK_RECONCILIATION_CONFLICT");
      }
      await tx.bankReconciliationEvent.create({
        data: {
          id: crypto.randomUUID(),
          shopId,
          bankStatementTransactionId: transaction.id,
          action: "match",
          payloadJson: JSON.stringify({
            calculationVersion: BANK_RECONCILIATION_VERSION,
            ledgerRowIds: input.ledgerRowIds,
            addedAmountPaise: added.toString(),
            resultingAmountPaise: newReconciled.toString(),
            resultingStatus: nextStatus,
            note: input.note ?? null,
            autoMatched: false,
          }),
          userId,
          createdAt: now,
        },
      });
    });
  } catch (error) {
    if (error?.code === "P2002") {
      fail("A selected ledger impact was matched concurrently; reload before retrying", 409, "BANK_LEDGER_ALREADY_MATCHED");
    }
    throw error;
  }
  return {
    transactionId: transaction.id,
    matchStatus: nextStatus,
    reconciledAmount: publicMoney(newReconciled),
    remainingAmount: publicMoney(statementAmount - newReconciled),
    allocatedLedgerRowIds: input.ledgerRowIds,
    autoMatched: false,
    calculationVersion: BANK_RECONCILIATION_VERSION,
  };
}

export async function unmatchBankTransaction(shopId, transactionId, input, { userId = null } = {}) {
  const transaction = await loadTransaction(shopId, transactionId);
  const allocated = assertReconciliationState(transaction);
  const selected = input.allocationIds
    ? transaction.allocations.filter((allocation) => input.allocationIds.includes(allocation.id))
    : transaction.allocations;
  if (!selected.length || (input.allocationIds && selected.length !== input.allocationIds.length)) {
    fail("One or more active allocations were not found on this transaction", 404, "BANK_ALLOCATION_NOT_FOUND");
  }
  const removed = selected.reduce((sum, allocation) => sum + asBigInt(allocation.amountPaise), 0n);
  const newReconciled = allocated - removed;
  const nextStatus = newReconciled > 0n ? "partial" : "unmatched";
  const now = new Date();

  await db.$transaction(async (tx) => {
    const reversed = await tx.bankReconciliationAllocation.updateMany({
      where: { shopId, id: { in: selected.map((allocation) => allocation.id) }, status: "active" },
      data: {
        status: "reversed",
        activeLedgerKey: null,
        activeBankLedgerKey: null,
        reversedByUserId: userId,
        reversedAt: now,
        reversalReason: input.reason,
      },
    });
    if (reversed.count !== selected.length) {
      fail("Allocation changed during reversal; reload and retry", 409, "BANK_RECONCILIATION_CONFLICT");
    }
    const changed = await tx.bankStatementTransaction.updateMany({
      where: {
        id: transaction.id,
        shopId,
        reconciledAmountPaise: transaction.reconciledAmountPaise,
        matchStatus: transaction.matchStatus,
      },
      data: { reconciledAmountPaise: newReconciled, matchStatus: nextStatus, updatedAt: now },
    });
    if (changed.count !== 1) {
      fail("Transaction changed during reversal; reload and retry", 409, "BANK_RECONCILIATION_CONFLICT");
    }
    await tx.bankReconciliationEvent.create({
      data: {
        id: crypto.randomUUID(),
        shopId,
        bankStatementTransactionId: transaction.id,
        action: "unmatch",
        payloadJson: JSON.stringify({
          allocationIds: selected.map((allocation) => allocation.id),
          ledgerRowIds: selected.map((allocation) => allocation.ledgerRowId),
          removedAmountPaise: removed.toString(),
          resultingAmountPaise: newReconciled.toString(),
          resultingStatus: nextStatus,
          reason: input.reason,
        }),
        userId,
        createdAt: now,
      },
    });
  });
  return {
    transactionId: transaction.id,
    matchStatus: nextStatus,
    reconciledAmount: publicMoney(newReconciled),
    remainingAmount: publicMoney(asBigInt(transaction.amountPaise) - newReconciled),
    reversedAllocationIds: selected.map((allocation) => allocation.id),
    calculationVersion: BANK_RECONCILIATION_VERSION,
  };
}

export async function ignoreBankTransaction(shopId, transactionId, input, { userId = null } = {}) {
  const transaction = await loadTransaction(shopId, transactionId);
  const allocated = assertReconciliationState(transaction);
  if (allocated !== 0n) {
    fail("Reverse active allocations before ignoring this transaction", 409, "BANK_TRANSACTION_HAS_ALLOCATIONS");
  }
  if (transaction.matchStatus === "ignored") {
    fail("Transaction is already ignored", 409, "BANK_TRANSACTION_ALREADY_IGNORED");
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    const changed = await tx.bankStatementTransaction.updateMany({
      where: { id: transaction.id, shopId, matchStatus: transaction.matchStatus, reconciledAmountPaise: 0n },
      data: {
        matchStatus: "ignored",
        ignoredReason: input.reason,
        ignoredByUserId: userId,
        ignoredAt: now,
        updatedAt: now,
      },
    });
    if (changed.count !== 1) fail("Transaction changed while being ignored; reload and retry", 409, "BANK_RECONCILIATION_CONFLICT");
    await tx.bankReconciliationEvent.create({
      data: {
        id: crypto.randomUUID(),
        shopId,
        bankStatementTransactionId: transaction.id,
        action: "ignore",
        payloadJson: JSON.stringify({ reason: input.reason }),
        userId,
        createdAt: now,
      },
    });
  });
  return { transactionId: transaction.id, matchStatus: "ignored", ignoredReason: input.reason };
}

export async function restoreBankTransaction(shopId, transactionId, input, { userId = null } = {}) {
  const transaction = await loadTransaction(shopId, transactionId);
  if (transaction.matchStatus !== "ignored") {
    fail("Only an ignored transaction can be restored", 409, "BANK_TRANSACTION_NOT_IGNORED");
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    const changed = await tx.bankStatementTransaction.updateMany({
      where: { id: transaction.id, shopId, matchStatus: "ignored", reconciledAmountPaise: 0n },
      data: {
        matchStatus: "unmatched",
        ignoredReason: null,
        ignoredByUserId: null,
        ignoredAt: null,
        updatedAt: now,
      },
    });
    if (changed.count !== 1) fail("Transaction changed while being restored; reload and retry", 409, "BANK_RECONCILIATION_CONFLICT");
    await tx.bankReconciliationEvent.create({
      data: {
        id: crypto.randomUUID(),
        shopId,
        bankStatementTransactionId: transaction.id,
        action: "restore",
        payloadJson: JSON.stringify({ reason: input.reason }),
        userId,
        createdAt: now,
      },
    });
  });
  return { transactionId: transaction.id, matchStatus: "unmatched", restoreReason: input.reason };
}
