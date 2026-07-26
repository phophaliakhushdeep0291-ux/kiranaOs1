import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  addMoney,
  moneyEquals,
  multiplyMoney,
  round2,
  subtractMoney,
  sumMoney,
  toPaise,
  fromPaise,
} from "../src/utils/money.js";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

assert.equal(round2(0.1 + 0.2), 0.3, "round2 should normalize floating drift");
assert.equal(toPaise(12.345), 1235, "toPaise should round to nearest paise");
assert.equal(fromPaise(1235), 12.35, "fromPaise should convert paise to rupees");
assert.equal(sumMoney([0.1, 0.2]), 0.3, "sumMoney should sum via paise");
assert.equal(addMoney(0.1, 0.2, 0.3), 0.6, "addMoney should add via paise");
assert.equal(subtractMoney(1, 0.1, 0.2), 0.7, "subtractMoney should subtract via paise");
assert.equal(multiplyMoney(46, 0.5), 23, "multiplyMoney should handle rate × quantity");
assert.equal(moneyEquals(0.1 + 0.2, 0.3), true, "moneyEquals should compare by paise");
assert.throws(() => round2(Number.NaN), /finite number/, "money helpers should reject NaN");

const moneyUtils = read("src/utils/money.js");
for (const name of ["toPaise", "fromPaise", "sumMoney", "addMoney", "subtractMoney", "multiplyMoney", "moneyEquals"]) {
  assert.match(moneyUtils, new RegExp(`export function ${name}\\b`), `${name} should be exported from money.js`);
}

const billsService = read("src/modules/bills/bills.service.js");
assert.match(billsService, /moneyEquals\(paymentCoverage, grandTotal\)/, "bill validation must compare money using moneyEquals");
assert.match(billsService, /sumMoney\(billPayments\.filter/, "payment totals must use sumMoney");
assert.match(billsService, /multiplyMoney\(item\.ratePerRateUnit, qtyInRateUnit\)/, "line total must use multiplyMoney");
assert.doesNotMatch(billsService, /round2\(paidAmount \+ creditAmount \+ waivedAmount\)/, "payment coverage should not use raw addition inside round2");

const reportsService = read("src/modules/reports/reports.service.js");
assert.match(reportsService, /sumMoney\(bills\.map\(\(b\) => b\.grandTotal\)\)/, "report grossSales should use sumMoney");
assert.match(reportsService, /totalCollected: addMoney\(cashCollected, upiCollected(?:, bankCollected)?(?:, udharRecoveredThisPeriod)?\)/, "report totalCollected should use addMoney");
assert.doesNotMatch(reportsService, /reduce\(\(s, [^)]+\) => s \+ [^)]+\.amount, 0\)/, "reports should not raw-sum amount fields");

const suppliersService = read("src/modules/suppliers/suppliers.service.js");
assert.match(suppliersService, /avgPrice: round2\(sumMoney\(prices\) \/ prices\.length\)/, "supplier average price should use money helpers");
assert.doesNotMatch(suppliersService, /Math\.round\(\(prices\.reduce/, "supplier average must not use raw Math.round reduce");

const udharService = read("src/modules/udhar/udhar.service.js");
assert.match(udharService, /sumMoney\((customers|rows)\.map\(\(c\) => c\.udharAmount\)\)/, "udhar summary should use sumMoney");

const customersService = read("src/modules/customers/customers.service.js");
assert.match(customersService, /toPaise\(currentBalance\.balance\) < toPaise\(paymentAmount\)/, "udhar payment limits must compare integer paise");

const syncService = read("src/modules/sync/sync.service.js");
assert.match(syncService, /const nextBalance = addMoney\(currentBalance\.balance, amount\)/, "synced ledger adjustments must add integer paise");
assert.match(syncService, /toPaise\(nextBalance\) < 0/, "synced ledger adjustment limits must compare integer paise");

const moneyDocs = read("docs/MONEY_MIGRATION.md");
for (const required of ["Float", "integer paise", "Bill", "BillItem", "Payment", "Product", "Customer", "StockLedger", "future migration"]) {
  assert.match(moneyDocs, new RegExp(required, "i"), `MONEY_MIGRATION.md should mention ${required}`);
}

console.log("Money safety examples passed");
