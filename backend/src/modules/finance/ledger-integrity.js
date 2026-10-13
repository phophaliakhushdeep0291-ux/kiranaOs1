import { projectLedgerRow } from "./ledger-projection.js";

const manualSources = new Set(["manual_journal", "opening_balance", "document_approval", "journal_reversal"]);
const categories = new Set(["asset", "liability", "equity", "income", "expense"]);
const signature = (code, debit, credit) => `${code}:${debit}:${credit}`;

/** Check individual journals and exact source-to-line coverage, not just totals.
 * Inputs must be scoped to the same shop and business-date window. Evidence
 * claims alone cannot prove posting: accounts, amounts, dates and lines agree.
 */
export function buildLedgerIntegrity(shopId, rows, journals) {
  const sources = new Map(rows.map((row) => [row.id, row]));
  const actual = new Map();
  const claims = new Map();
  const invalidJournals = new Set();
  const issues = [];
  let issueCount = 0;
  const add = (code, detail = {}) => {
    issueCount += 1;
    if (issues.length < 100) issues.push({ code, ...detail });
  };
  for (const journal of journals) {
    let invalid = false;
    let evidence;
    try { evidence = JSON.parse(journal.evidenceJson); } catch { invalid = true; }
    const ids = evidence?.ledgerRowIds;
    const isProjection = Array.isArray(ids);
    const claimedIds = new Set(isProjection ? ids : []);
    if (!isProjection && !manualSources.has(journal.sourceType)) invalid = true;
    if (isProjection) {
      if (claimedIds.size !== ids.length || ids.length === 0) invalid = true;
      for (const id of claimedIds) {
        claims.set(id, (claims.get(id) ?? 0) + 1);
        if (!sources.has(id)) invalid = true;
      }
    }
    let debit = 0n; let credit = 0n;
    for (const line of journal.lines) {
      const d = BigInt(line.debitPaise); const c = BigInt(line.creditPaise);
      debit += d; credit += c;
      if (d < 0n || c < 0n || (d > 0n) === (c > 0n) || line.shopId !== shopId || line.account?.shopId !== shopId
        || !categories.has(line.account?.category)) invalid = true;
      if (line.financialLedgerId) {
        const source = sources.get(line.financialLedgerId);
        if (!isProjection || !claimedIds.has(line.financialLedgerId) || !source) invalid = true;
        if (source && (new Date(source.businessDate).getTime() !== new Date(journal.businessDate).getTime()
          || ["currencyCode", "countryCode", "accountingTimeZone", "taxRegime"].some((key) => source[key] !== journal[key]))) invalid = true;
        const lines = actual.get(line.financialLedgerId) ?? [];
        lines.push(signature(line.account?.code, d, c));
        actual.set(line.financialLedgerId, lines);
      } else if (isProjection) invalid = true;
    }
    if (debit !== credit || (!isProjection && debit === 0n) || journal.shopId !== shopId) invalid = true;
    if (invalid) {
      invalidJournals.add(journal.id);
      add("INVALID_JOURNAL", { journalId: journal.id });
    }
  }
  let unpostedRows = 0; let mismatchedRows = 0; let unmappedRows = 0;
  for (const row of rows) {
    let expected;
    try {
      expected = projectLedgerRow(row).map((line) => signature(line.accountCode,
        line.side === "debit" ? line.amountPaise : 0n, line.side === "credit" ? line.amountPaise : 0n)).sort();
    } catch {
      unmappedRows += 1;
      add("UNMAPPED_LEDGER_ROW", { ledgerRowId: row.id });
      continue;
    }
    const posted = (actual.get(row.id) ?? []).sort();
    const count = claims.get(row.id) ?? 0;
    if (posted.length === 0 && count === 0) {
      unpostedRows += 1;
      add("UNPOSTED_LEDGER_ROW", { ledgerRowId: row.id });
    } else if (count !== 1 || JSON.stringify(posted) !== JSON.stringify(expected)) {
      mismatchedRows += 1;
      add("MISMATCHED_LEDGER_ROW", { ledgerRowId: row.id });
    }
  }
  return {
    status: issueCount ? "attention_required" : rows.length || journals.length ? "verified" : "no_data",
    ledgerRows: rows.length, journalCount: journals.length, unpostedRows, mismatchedRows, unmappedRows,
    invalidJournals: invalidJournals.size, issueCount, issues, issuesTruncated: issueCount > issues.length,
  };
}
