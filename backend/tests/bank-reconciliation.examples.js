import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BANK_RECONCILIATION_LIMITATIONS,
  BANK_RECONCILIATION_VERSION,
  bankImpactForLedgerRow,
  buildBankCandidateSuggestions,
  parseBankStatementCsv,
} from "../src/modules/finance/bank-reconciliation.service.js";
import { RESTORABLE_SHOP_MODELS } from "../src/modules/backups/backup-policy.js";

const account = { accountType: "bank", accountName: "HDFC current", accountLast4: "1234" };

let parsed = parseBankStatementCsv(
  "\uFEFFDate,Narration,Reference,Debit,Credit,Balance\r\n"
  + '2026-07-20,"UPI settlement, Bengaluru",UTR-101,,1234.56,"10,234.56"\r\n'
  + "21/07/2026,Supplier payment,NEFT-202,250.00,,9984.56\r\n",
  account,
);
assert.equal(parsed.rows.length, 2);
assert.equal(parsed.rows[0].description, "UPI settlement, Bengaluru");
assert.equal(parsed.rows[0].direction, "credit");
assert.equal(parsed.rows[0].amountPaise, 123456n, "decimal input must be represented in exact integer paise");
assert.equal(parsed.rows[0].balancePaise, 1023456n);
assert.equal(parsed.rows[1].direction, "debit");
assert.equal(parsed.rows[1].transactionDate.toISOString().slice(0, 10), "2026-07-21");

parsed = parseBankStatementCsv(
  "Transaction Date,Description,Amount\r\n"
  + "2026-07-22,Incoming transfer,+500\r\n"
  + "22-07-2026,Outgoing transfer,-125.4\r\n",
  account,
);
assert.deepEqual(parsed.rows.map((row) => [row.direction, row.amountPaise]), [
  ["credit", 50000n],
  ["debit", 12540n],
]);

let rejected;
try {
  parseBankStatementCsv(
    "Date,Description,Debit,Credit\n"
    + "2026-07-20,Valid row,,100\n"
    + "07/26/2026,Invalid ambiguous date,25,\n",
    account,
  );
} catch (error) {
  rejected = error;
}
assert.equal(rejected?.code, "BANK_STATEMENT_INVALID");
assert.equal(rejected?.publicData?.importedRowCount, 0, "one invalid row must reject the entire file");
assert.equal(rejected?.publicData?.invalidRowCount, 1);
assert.equal(rejected?.publicData?.rowErrors?.[0]?.rowNumber, 3);

assert.throws(
  () => parseBankStatementCsv("Date,Description,Amount\n2026-07-20,Direction is ambiguous,100", account),
  (error) => error.code === "BANK_STATEMENT_INVALID" && error.publicData?.rowErrors?.[0]?.message.includes("Unsigned amount"),
  "an unsigned single amount must never be guessed as money in",
);
assert.throws(
  () => parseBankStatementCsv('Date,Description,Debit,Credit\n2026-07-20,Bad grouping,,"1,2,3.00"', account),
  (error) => error.code === "BANK_STATEMENT_INVALID" && error.publicData?.rowErrors?.[0]?.message.includes("comma grouping"),
  "malformed numeric grouping must never be normalized into another value",
);
assert.throws(
  () => parseBankStatementCsv('Date,Description,Amount\n2026-07-20,"Unclosed,100', account),
  (error) => error.code === "BANK_STATEMENT_INVALID",
);

const ledger = (id, entryType, amountPaise, businessDate = "2026-07-20T12:00:00.000Z", extra = {}) => ({
  id,
  sourceType: "payment",
  sourceId: extra.sourceId ?? id,
  entryType,
  amountPaise,
  paymentMode: extra.paymentMode ?? null,
  businessDate,
  ...extra,
});

assert.deepEqual(bankImpactForLedgerRow(ledger("bank-in", "bank_in", 10000n), "bank"), {
  direction: "credit",
  amountPaise: 10000n,
});
assert.deepEqual(bankImpactForLedgerRow(ledger("bank-out", "bank_out", 5000n), "bank"), {
  direction: "debit",
  amountPaise: 5000n,
});
assert.deepEqual(bankImpactForLedgerRow(ledger("bank-out-reversal", "bank_out", -5000n), "bank"), {
  direction: "credit",
  amountPaise: 5000n,
});
assert.deepEqual(
  bankImpactForLedgerRow(ledger("supplier", "supplier_payment", 7500n, undefined, { paymentMode: "card" }), "bank"),
  { direction: "debit", amountPaise: 7500n },
);
assert.equal(bankImpactForLedgerRow(ledger("wrong-account", "upi_in", 10000n), "bank"), null);

const transaction = {
  accountType: "bank",
  transactionDate: "2026-07-20T12:00:00.000Z",
  direction: "credit",
  amountPaise: 10000n,
  remainingAmountPaise: 10000n,
  reference: "UTR101",
  description: "Settlement",
};
let candidates = buildBankCandidateSuggestions(transaction, [
  ledger("exact-reference", "bank_in", 10000n, "2026-07-20T12:00:00.000Z", { sourceId: "UTR101" }),
  ledger("exact-same-score-a", "bank_in", 10000n),
  ledger("exact-same-score-b", "bank_in", 10000n),
  ledger("partial", "bank_in", 4000n, "2026-07-21T12:00:00.000Z"),
  ledger("outside-window", "bank_in", 10000n, "2026-07-25T12:00:00.000Z"),
  ledger("wrong-direction", "bank_out", 10000n),
]);
assert.equal(candidates.autoMatched, false, "the engine must never perform an automatic match");
assert.equal(candidates.suggestions.length, 3, "only exact amount/direction candidates inside the date window are suggestions");
assert.equal(candidates.suggestions[0].ledgerRowId, "exact-reference", "reference evidence deterministically ranks the strongest candidate");
assert.equal(candidates.suggestions.some((candidate) => candidate.ledgerRowId === "outside-window"), false);
assert.equal(candidates.allocationOptions.some((candidate) => candidate.ledgerRowId === "outside-window"), true, "outside-suggestion-window rows stay available only as explicit manual options");
assert.equal(candidates.allocationOptions.find((candidate) => candidate.ledgerRowId === "outside-window")?.confidence, "eligible_manual_allocation");
assert.equal(candidates.allocationOptions.some((candidate) => candidate.ledgerRowId === "partial"), true, "smaller exact-direction rows remain available for explicit multi-allocation");

candidates = buildBankCandidateSuggestions(
  { ...transaction, reference: null },
  [
    ledger("tie-a", "bank_in", 10000n),
    ledger("tie-b", "bank_in", 10000n),
  ],
);
assert.equal(candidates.suggestions[0].ambiguous, true);
assert.equal(candidates.suggestions[1].ambiguous, true);
candidates = buildBankCandidateSuggestions(
  transaction,
  [ledger("calendar-boundary", "bank_in", 10000n, "2026-07-23T23:59:59.000Z")],
);
assert.equal(candidates.suggestions[0]?.ledgerRowId, "calendar-boundary", "the date window must compare calendar days, not time-of-day drift");

candidates = buildBankCandidateSuggestions(
  transaction,
  [ledger("already-used", "bank_in", 10000n)],
  new Set(["already-used"]),
);
assert.equal(candidates.suggestions.length, 0, "an active ledger allocation cannot be suggested twice");

assert.equal(BANK_RECONCILIATION_VERSION, "bank-reconciliation-v1");
assert.ok(BANK_RECONCILIATION_LIMITATIONS.some((item) => item.includes("never matched automatically")));
assert.ok(BANK_RECONCILIATION_LIMITATIONS.some((item) => item.includes("not a live bank")));

const routeSource = fs.readFileSync(new URL("../src/modules/finance/accounting.routes.js", import.meta.url), "utf8");
for (const route of [
  "/bank-statements",
  "/bank-statements/import",
  "/bank-reconciliation",
  "/bank-transactions/:id/match",
  "/bank-transactions/:id/unmatch",
  "/bank-transactions/:id/ignore",
  "/bank-transactions/:id/restore",
]) assert.ok(routeSource.includes(route), `${route} must be wired`);
assert.ok(routeSource.includes('requireFeature("csv_import_export")'), "statement workflows must obey plan entitlements");
for (const action of ["importStatement", "match", "unmatch", "ignore", "restore"]) {
  const routeLine = routeSource.split(/\r?\n/).find((line) => line.includes(`bankController.${action}`));
  assert.ok(routeLine?.includes("requireOwnerPin"), `${action} must require owner PIN proof`);
}

for (const path of [
  "../prisma/migrations/20260726100000_bank_statement_reconciliation/migration.sql",
  "../prisma-postgres/migrations/000067_bank_statement_reconciliation/migration.sql",
]) {
  const migration = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  for (const table of [
    "BankStatementImport",
    "BankStatementTransaction",
    "BankReconciliationAllocation",
    "BankReconciliationEvent",
  ]) assert.ok(migration.includes(table), `${path} must create ${table}`);
}

const backupSource = fs.readFileSync(new URL("../src/modules/backups/backup.service.js", import.meta.url), "utf8");
// The tenant backup walks RESTORABLE_SHOP_MODELS instead of naming each delegate,
// so membership in that registry is what actually decides whether these tables
// survive a restore. This used to grep the service source for `findMany` calls,
// which kept passing against a superseded builder nothing called any more.
for (const model of [
  "BankStatementImport",
  "BankStatementTransaction",
  "BankReconciliationAllocation",
  "BankReconciliationEvent",
]) assert.ok(RESTORABLE_SHOP_MODELS.includes(model), `encrypted tenant backup must include ${model}`);
// Pinned on purpose: adding a model to the tenant backup must be a deliberate
// act, so bumping BACKUP_SCHEMA_VERSION is expected to fail here until the new
// shape has been reviewed. Last reviewed for complete transactional restore,
// the preserved credential/control plane, and the shop maintenance lock.
assert.ok(backupSource.includes('BACKUP_SCHEMA_VERSION = "2026-08-27-complete-v6"'));
console.log("bank-reconciliation.examples.js OK");
