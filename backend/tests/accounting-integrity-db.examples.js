import assert from "node:assert/strict";
import db from "../src/db.js";
import { closeAccountingPeriod, createAccountingPeriod, createManualJournal, ensureSystemAccounts, getBalanceSheet, getProfitAndLoss, getTrialBalance, postFinancialLedgerRows, projectShopGeneralLedger } from "../src/modules/finance/general-ledger.service.js";
import { postBillCreatedLedger, postExpenseEffectLedger, postPurchaseReceiptLedger, postSaleReturnLedger } from "../src/modules/finance/financial-ledger.service.js";
import { buildAccountingControl } from "../src/modules/finance/accounting-control.service.js";
import { buildLedgerIntegrity } from "../src/modules/finance/ledger-integrity.js";
import { createAuditLog } from "../src/modules/audit/audit.service.js";

const date = new Date("2033-04-10T10:00:00Z");
const range = { from: "2033-04-01T00:00:00Z", to: "2033-04-30T23:59:59.999Z" };
const newShop = async () => db.shop.create({ data: { name: "Isolated accounting proof", ownerName: "Owner", city: "Pune", address: "Test" } });
const rejectCode = (operation, code) => assert.rejects(operation, (error) => error.code === code);
const sourceRows = (shopId, key, amount = 100n, businessDate = date) => ["sale", "cash_in"].map((entryType) => ({
  shopId, sourceType: "bill", sourceId: "same-business-source", entryType, direction: entryType === "sale" ? "credit" : "debit",
  amountPaise: amount, businessDate, idempotencyKey: `${key}:${entryType}`,
}));
const periodFor = (shopId) => createAccountingPeriod(shopId, { name: "April", startsAt: range.from, endsAt: range.to });

try {
  // A complete business cycle, independently reconciled to 1,415.00 assets,
  // 500.00 liabilities and 915.00 equity (capital 1,000 less losses 85).
  const shop = await newShop();
  await ensureSystemAccounts(shop.id);
  assert.equal((await getTrialBalance(shop.id)).status, "no_data");
  await createManualJournal(shop.id, { reference: "OPEN", businessDate: date.toISOString(), description: "Owner capital", lines: [
    { accountCode: "1000", debitPaise: 100000, creditPaise: 0 }, { accountCode: "3000", debitPaise: 0, creditPaise: 100000 },
  ] }, { sourceType: "opening_balance" });
  await postPurchaseReceiptLedger(db, { shopId: shop.id, supplierId: "supplier", receipt: { id: "purchase", totalAmount: 1000, paidAmount: 300, dueAmount: 700, paymentMode: "upi", createdAt: date } });
  await postFinancialLedgerRows(db, [{ shopId: shop.id, sourceType: "supplier_payment", sourceId: "pay", entryType: "supplier_payment", direction: "debit", amountPaise: 20000n, paymentMode: "cash", businessDate: date, idempotencyKey: "supplier:payment" }]);
  await postBillCreatedLedger(db, { shopId: shop.id, bill: { id: "sale", grandTotal: 118, gst: 18, createdAt: date, items: [{ lineCost: 60 }] }, tenderPayments: [{ id: "cash", mode: "cash", amount: 118 }] });
  await postExpenseEffectLedger(db, { shopId: shop.id, expense: { id: "expense", amount: 25, status: "paid", paymentMode: "cash", spentAt: date }, keyBase: "expense:create" });
  await postSaleReturnLedger(db, { shopId: shop.id, bill: { id: "return", grandTotal: -118, gst: -18, createdAt: date, items: [{ lineCost: -60 }], payments: [{ id: "refund", mode: "cash", amount: -118 }] }, refundMode: "cash", refundAmount: 118, damagedReturnCost: 60 });
  const pnl = await getProfitAndLoss(shop.id, range);
  assert.equal(pnl.status, "balanced");
  assert.equal(pnl.netProfitPaise, -8500);
  assert.equal(pnl.totalIncomePaise, 0);
  assert.equal(pnl.expenses.find((row) => row.code === "6200").amountPaise, 6000);
  const sheet = await getBalanceSheet(shop.id);
  assert.equal(sheet.totalAssetsPaise, 141500);
  assert.equal(sheet.totalLiabilitiesPaise, 50000);
  assert.equal(sheet.totalEquityPaise, 91500);
  assert.equal(sheet.assets.find((row) => row.code === "1200").amountPaise, 94000, "damaged goods cannot inflate inventory");
  assert.equal(sheet.differencePaise, 0);
  assert.equal(sheet.integrity.issueCount, 0);
  const period = await periodFor(shop.id);
  await closeAccountingPeriod(shop.id, period.id, { reason: "Reconciled cycle" }, null);
  await rejectCode(() => postFinancialLedgerRows(db, sourceRows(shop.id, "late")), "ACCOUNTING_PERIOD_CLOSED");

  // Missing sources must block closing even though 0 debit equals 0 credit.
  const missing = await newShop();
  await db.financialLedger.createMany({ data: sourceRows(missing.id, "missing") });
  let trial = await getTrialBalance(missing.id, range);
  assert.equal(trial.differencePaise, 0);
  assert.equal(trial.status, "attention_required");
  assert.equal(trial.integrity.unpostedRows, 2);
  const missingPeriod = await periodFor(missing.id);
  await rejectCode(() => closeAccountingPeriod(missing.id, missingPeriod.id, { reason: "Must not close" }, null), "ACCOUNTING_PERIOD_INTEGRITY_FAILED");
  await projectShopGeneralLedger(missing.id);
  assert.equal((await getTrialBalance(missing.id)).status, "balanced");
  assert.equal((await projectShopGeneralLedger(missing.id)).journalsCreated, 0, "projection replay is idempotent");

  // Backfill cannot bypass an already closed period, and direct service callers
  // get the same all-or-nothing transaction as the HTTP endpoint.
  const closed = await newShop();
  const closedPeriod = await periodFor(closed.id);
  await closeAccountingPeriod(closed.id, closedPeriod.id, { reason: "Empty period closed" }, null);
  await db.financialLedger.createMany({ data: sourceRows(closed.id, "legacy") });
  await rejectCode(() => projectShopGeneralLedger(closed.id), "ACCOUNTING_PERIOD_CLOSED");
  assert.equal(await db.journalEntry.count({ where: { shopId: closed.id } }), 0);
  assert.equal(await db.chartOfAccount.count({ where: { shopId: closed.id } }), 0, "failed projection rolls account initialization back too");
  const atomic = await newShop();
  await rejectCode(() => postFinancialLedgerRows(db, sourceRows(atomic.id, "unbalanced").slice(0, 1)), "GENERAL_LEDGER_UNBALANCED_JOURNAL");
  assert.equal(await db.financialLedger.count({ where: { shopId: atomic.id } }), 0);

  // Same source across dates must not be squeezed into the first day's journal.
  const dated = await newShop();
  await db.financialLedger.createMany({ data: [...sourceRows(dated.id, "day-one"), ...sourceRows(dated.id, "day-two", 200n, new Date("2033-04-11T10:00:00Z"))] });
  assert.equal((await projectShopGeneralLedger(dated.id)).journalsCreated, 2);
  assert.equal((await getProfitAndLoss(dated.id, { from: "2033-04-11T00:00:00Z", to: "2033-04-11T23:59:59Z" })).netProfitPaise, 200);

  // Opposing corrupt journals cancel in aggregate but each is invalid.
  const corrupt = await newShop();
  const accounts = await ensureSystemAccounts(corrupt.id);
  for (const [code, debit, credit] of [["1000", 100n, 0n], ["3000", 0n, 100n]]) {
    await db.journalEntry.create({ data: { shopId: corrupt.id, sourceType: "manual_journal", sourceId: code, businessDate: date, lines: { create: { shopId: corrupt.id, accountId: accounts.find((a) => a.code === code).id, lineNumber: 1, debitPaise: debit, creditPaise: credit } } } });
  }
  trial = await getTrialBalance(corrupt.id);
  assert.equal(trial.differencePaise, 0);
  assert.equal(trial.integrity.invalidJournals, 2);
  assert.equal(trial.status, "attention_required");
  const corruptPeriod = await periodFor(corrupt.id);
  await rejectCode(() => closeAccountingPeriod(corrupt.id, corruptPeriod.id, { reason: "Cannot hide offsetting errors" }, null), "ACCOUNTING_PERIOD_INTEGRITY_FAILED");

  // Reject malformed direct-service lines, not only malformed HTTP requests.
  await rejectCode(() => createManualJournal(corrupt.id, { reference: "NEGATIVE", businessDate: date.toISOString(), description: "Invalid line", lines: [
    { accountCode: "1000", debitPaise: 200, creditPaise: 100 }, { accountCode: "3000", debitPaise: -100, creditPaise: 0 },
  ] }), "JOURNAL_LINE_INVALID");

  // Inactive historical accounts remain included, and integer overflow fails
  // explicitly instead of displaying a plausible but rounded money figure.
  await db.chartOfAccount.update({ where: { id: accounts.find((a) => a.code === "1000").id }, data: { active: false } });
  assert.equal((await getTrialBalance(corrupt.id)).totalDebitPaise, 100);
  const huge = await newShop();
  await ensureSystemAccounts(huge.id);
  await createManualJournal(huge.id, { reference: "HUGE", businessDate: date.toISOString(), description: "Precision boundary", lines: [
    { accountCode: "1000", debitPaise: 9007199254740993n, creditPaise: 0n }, { accountCode: "3000", debitPaise: 0n, creditPaise: 9007199254740993n },
  ] });
  await rejectCode(() => getTrialBalance(huge.id), "ACCOUNTING_AMOUNT_OUT_OF_RANGE");

  const postedSources = await db.financialLedger.findMany({ where: { shopId: missing.id } });
  const postedJournals = await db.journalEntry.findMany({ where: { shopId: missing.id }, include: { lines: { include: { account: true } } } });
  const duplicate = structuredClone(postedJournals[0]);
  duplicate.id = "duplicate-journal";
  assert.equal(buildLedgerIntegrity(missing.id, postedSources, [...postedJournals, duplicate]).mismatchedRows, 2, "duplicated balanced journals cannot pass source coverage");
  const forged = structuredClone(postedJournals);
  forged[0].lines = [];
  assert.equal(buildLedgerIntegrity(missing.id, postedSources, forged).mismatchedRows, 2, "evidence claiming row IDs without actual lines is not posting proof");
  const foreign = structuredClone(postedJournals);
  foreign[0].lines[0].account.shopId = "other-shop";
  assert.equal(buildLedgerIntegrity(missing.id, postedSources, foreign).invalidJournals, 1, "cross-tenant account reference is an integrity failure");
  const wrongDate = structuredClone(postedJournals);
  wrongDate[0].businessDate = new Date("2033-04-11T10:00:00Z");
  assert.equal(buildLedgerIntegrity(missing.id, postedSources, wrongDate).invalidJournals, 1, "source date must match journal date");

  const rentalRows = [
    { id: "r1", sourceType: "rental", sourceId: "rental", entryType: "rental_cash", amountPaise: 10000n },
    { id: "r2", sourceType: "rental", sourceId: "rental", entryType: "rental_income", amountPaise: 10000n },
    { id: "f1", sourceType: "furniture", sourceId: "order", entryType: "furniture_bank", amountPaise: 20000n },
    { id: "f2", sourceType: "furniture", sourceId: "order", entryType: "furniture_advance", amountPaise: 20000n },
  ];
  assert.equal(buildAccountingControl(rentalRows).status, "balanced");
  let auditData;
  await createAuditLog({ shopId: shop.id, action: "LEDGER_PROOF", after: { amountPaise: 9007199254740993n }, client: { auditLog: { create: async ({ data }) => { auditData = data; return data; } } } });
  assert.equal(JSON.parse(auditData.afterJson).amountPaise, "9007199254740993", "audit keeps exact BigInt evidence instead of serializationError");
  console.log("accounting-integrity-db.examples.js OK");
} finally {
  await db.$disconnect();
}
