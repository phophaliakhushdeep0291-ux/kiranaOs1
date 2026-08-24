import assert from "node:assert/strict";
import db from "../src/db.js";
import { closeAccountingPeriod, createAccount, createAccountingPeriod, createManualJournal, ensureSystemAccounts, getBalanceSheet, getProfitAndLoss, getTrialBalance, postFinancialLedgerRows, reverseJournal, updateAccount } from "../src/modules/finance/general-ledger.service.js";

const shop = await db.shop.create({ data: { name: `General ledger ${Date.now()}`, ownerName: "Owner", city: "Pune", address: "Test" } });
const expectCode = async (promise, code) => { const error = await promise.then(() => null, (caught) => caught); assert.equal(error?.code, code, error?.message); };
try {
  const accounts = await ensureSystemAccounts(shop.id);
  assert.ok(accounts.length >= 17);
  const custom = await createAccount(shop.id, { code: "6500", name: "Professional fees", category: "expense", normalSide: "debit" });
  await expectCode(createAccount(shop.id, { code: "6500", name: "Duplicate", category: "expense", normalSide: "debit" }), "ACCOUNT_CODE_EXISTS");
  assert.equal((await updateAccount(shop.id, custom.id, { name: "Professional service fees" })).name, "Professional service fees");

  await createManualJournal(shop.id, { reference: "OPEN-2026", businessDate: "2026-04-01T00:00:00.000Z", description: "Opening capital", lines: [{ accountCode: "1000", debitPaise: 10000, creditPaise: 0 }, { accountCode: "3000", debitPaise: 0, creditPaise: 10000 }] }, { sourceType: "opening_balance" });
  await expectCode(createManualJournal(shop.id, { reference: "OPEN-2026", businessDate: "2026-04-01T00:00:00.000Z", description: "Duplicate opening", lines: [{ accountCode: "1000", debitPaise: 100, creditPaise: 0 }, { accountCode: "3000", debitPaise: 0, creditPaise: 100 }] }, { sourceType: "opening_balance" }), "JOURNAL_REFERENCE_EXISTS");
  const sale = await createManualJournal(shop.id, { reference: "MANUAL-SALE-1", businessDate: "2026-04-02T00:00:00.000Z", description: "Manual sale", lines: [{ accountCode: "1000", debitPaise: 5000, creditPaise: 0 }, { accountCode: "4000", debitPaise: 0, creditPaise: 5000 }] });
  assert.equal((await getTrialBalance(shop.id)).status, "balanced");
  assert.equal((await getProfitAndLoss(shop.id)).netProfitPaise, 5000);
  const sheet = await getBalanceSheet(shop.id);
  assert.equal(sheet.status, "balanced");
  assert.equal(sheet.totalAssetsPaise, 15000);
  assert.equal(sheet.totalEquityPaise, 15000);

  await reverseJournal(shop.id, sale.id, { reason: "Entered for test", businessDate: "2026-04-03T00:00:00.000Z" });
  assert.equal((await getProfitAndLoss(shop.id)).netProfitPaise, 0);
  await expectCode(reverseJournal(shop.id, sale.id, { reason: "Duplicate reversal" }), "JOURNAL_ALREADY_REVERSED");

  const period = await createAccountingPeriod(shop.id, { name: "April 2026", startsAt: "2026-04-01T00:00:00.000Z", endsAt: "2026-04-30T23:59:59.999Z" });
  await closeAccountingPeriod(shop.id, period.id, { reason: "Owner approved month close" }, "owner-1");
  await expectCode(createManualJournal(shop.id, { reference: "LATE", businessDate: "2026-04-10T00:00:00.000Z", description: "Late entry", lines: [{ accountCode: "1000", debitPaise: 100, creditPaise: 0 }, { accountCode: "3000", debitPaise: 0, creditPaise: 100 }] }), "ACCOUNTING_PERIOD_CLOSED");
  const ledgerCount = await db.financialLedger.count({ where: { shopId: shop.id } });
  await expectCode(postFinancialLedgerRows(db, [{ shopId: shop.id, sourceType: "bill", sourceId: "LOCKED-BILL", entryType: "sale", direction: "credit", amountPaise: 100n, businessDate: new Date("2026-04-10T00:00:00.000Z"), idempotencyKey: "locked:bill:sale" }, { shopId: shop.id, sourceType: "bill", sourceId: "LOCKED-BILL", entryType: "cash_in", direction: "debit", amountPaise: 100n, businessDate: new Date("2026-04-10T00:00:00.000Z"), idempotencyKey: "locked:bill:cash" }]), "ACCOUNTING_PERIOD_CLOSED");
  assert.equal(await db.financialLedger.count({ where: { shopId: shop.id } }), ledgerCount, "closed-period rejection writes nothing");
  await expectCode(createAccountingPeriod(shop.id, { name: "Overlap", startsAt: "2026-04-15T00:00:00.000Z", endsAt: "2026-05-15T23:59:59.999Z" }), "ACCOUNTING_PERIOD_OVERLAP");
  await expectCode(updateAccount(shop.id, accounts.find((row) => row.code === "1000").id, { active: false }), "SYSTEM_ACCOUNT_IMMUTABLE");
  const batch = (suffix, amount) => [{ shopId: shop.id, sourceType: "bill_cancel", sourceId: "REPEAT-BILL", entryType: "sale", direction: "credit", amountPaise: BigInt(amount), businessDate: new Date("2026-06-01T00:00:00.000Z"), idempotencyKey: `repeat:${suffix}:sale` }, { shopId: shop.id, sourceType: "bill_cancel", sourceId: "REPEAT-BILL", entryType: "cash_in", direction: "debit", amountPaise: BigInt(amount), businessDate: new Date("2026-06-01T00:00:00.000Z"), idempotencyKey: `repeat:${suffix}:cash` }];
  await postFinancialLedgerRows(db, batch("one", -100));
  await postFinancialLedgerRows(db, batch("two", 100));
  const repeatedJournals = await db.journalEntry.findMany({ where: { shopId: shop.id, sourceType: "bill_cancel" } });
  assert.equal(repeatedJournals.length, 2, "repeat lifecycle events receive distinct immutable journal identities");
  await expectCode(reverseJournal(shop.id, repeatedJournals[0].id, { reason: "Wrong correction path" }), "SYSTEM_JOURNAL_REVERSAL_FORBIDDEN");
  console.log("general-ledger-db.examples.js OK");
} finally {
  await db.journalLine.deleteMany({ where: { shopId: shop.id } });
  await db.journalEntry.updateMany({ where: { shopId: shop.id }, data: { reversalOfId: null } });
  await db.journalEntry.deleteMany({ where: { shopId: shop.id } });
  await db.accountingPeriod.deleteMany({ where: { shopId: shop.id } });
  await db.financialLedger.deleteMany({ where: { shopId: shop.id } });
  await db.chartOfAccount.deleteMany({ where: { shopId: shop.id } });
  await db.shop.delete({ where: { id: shop.id } });
  await db.$disconnect();
}
