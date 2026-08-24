import assert from "node:assert/strict";
import { buildJournalProjection, GENERAL_LEDGER_VERSION, journalBatchSourceId, projectLedgerRow, SYSTEM_ACCOUNTS } from "../src/modules/finance/general-ledger.service.js";
import fs from "node:fs";

const row = (entryType, amountPaise, extra = {}) => ({ id: `${entryType}:${amountPaise}`, entryType, amountPaise: BigInt(amountPaise), ...extra });
assert.equal(GENERAL_LEDGER_VERSION, "general-ledger-v1");
assert.equal(new Set(SYSTEM_ACCOUNTS.map((account) => account.code)).size, SYSTEM_ACCOUNTS.length);
assert.deepEqual(projectLedgerRow(row("sale", -1000)), [{ accountCode: "4000", side: "debit", amountPaise: 1000n, financialLedgerId: "sale:-1000" }]);
const sale = buildJournalProjection([row("sale", 10000), row("cash_in", 6000), row("udhar_debit", 4000)]);
assert.equal(sale.debitPaise, 10000n);
assert.equal(sale.creditPaise, 10000n);
const supplier = buildJournalProjection([row("supplier_payment", 5000, { paymentMode: "upi" })]);
assert.deepEqual(supplier.lines.map((line) => [line.accountCode, line.side, line.amountPaise]), [["2000", "debit", 5000n], ["1010", "credit", 5000n]]);
assert.throws(() => buildJournalProjection([row("sale", 1000)]), (error) => error.code === "GENERAL_LEDGER_UNBALANCED_JOURNAL");
assert.throws(() => projectLedgerRow(row("future_unknown", 1000)), (error) => error.code === "GENERAL_LEDGER_UNMAPPED_ENTRY");
const originalBatch = [
  { sourceId: "bill-1", idempotencyKey: "bill:bill-1:delete:100:sale" },
  { sourceId: "bill-1", idempotencyKey: "bill:bill-1:delete:100:cash_in" },
];
assert.equal(journalBatchSourceId(originalBatch), journalBatchSourceId([...originalBatch].reverse()), "journal batch identity must not depend on row order");
assert.notEqual(
  journalBatchSourceId(originalBatch),
  journalBatchSourceId(originalBatch.map((item) => ({ ...item, idempotencyKey: item.idempotencyKey.replace(":100:", ":200:") }))),
  "a later delete/restore cycle for the same bill must receive a distinct journal identity",
);
const routes = fs.readFileSync(new URL("../src/modules/finance/accounting.routes.js", import.meta.url), "utf8");
assert.match(routes, /\/chart-of-accounts/);
assert.match(routes, /\/general-ledger\/project/);
assert.match(routes, /\/trial-balance/);
console.log("general-ledger.examples.js OK");
