import db from "../src/db.js";
import { ACCOUNTING_CONTROL_VERSION, buildAccountingControl } from "../src/modules/finance/accounting-control.service.js";

const [shops, ledger, bills, payments, purchaseHistory, purchaseReceipts, assuranceFindings, journalEntries] = await Promise.all([
  db.shop.findMany({ select: { id: true, name: true } }),
  db.financialLedger.findMany({ orderBy: [{ shopId: "asc" }, { createdAt: "asc" }, { id: "asc" }] }),
  db.bill.findMany(),
  db.payment.findMany(),
  db.purchaseHistory.findMany(),
  db.purchaseReceipt.findMany(),
  db.auditFinding.findMany({
    where: { rules: { some: { ruleCode: "CLOSING_SPLIT_PAYMENT_MISMATCH", active: true } } },
    include: { rules: true },
  }),
  db.journalEntry.findMany({ include: { lines: true } }),
]);

const byId = (items) => new Map(items.map((item) => [item.id, item]));
const billById = byId(bills);
const paymentById = byId(payments);
const purchaseHistoryById = byId(purchaseHistory);
const purchaseReceiptById = byId(purchaseReceipts);
const ledgerByShop = Map.groupBy(ledger, (row) => row.shopId);
const recognizedMismatchShops = new Set(assuranceFindings.map((finding) => finding.shopId));
const absolute = (value) => {
  const paise = BigInt(value ?? 0);
  return paise < 0n ? -paise : paise;
};
const sourcePaise = (row, paiseKey, amountKey) => row?.[paiseKey] == null
  ? BigInt(Math.round(Number(row?.[amountKey] ?? 0) * 100))
  : BigInt(row[paiseKey]);

const structuralFailures = [];
const archivedSourceReferences = [];
const sourceAmountMismatches = [];
const evidenceFailures = [];

for (const row of ledger) {
  let evidence;
  try { evidence = JSON.parse(row.evidenceJson); }
  catch { evidenceFailures.push({ ledgerId: row.id, reason: "invalid_json" }); continue; }
  if (evidence?.version !== 1) evidenceFailures.push({ ledgerId: row.id, reason: "unsupported_version" });
  if (String(evidence?.amountPaise) !== String(row.amountPaise)) evidenceFailures.push({ ledgerId: row.id, reason: "amount_changed" });

  const missing = [];
  if (row.billId && !billById.has(row.billId)) missing.push(["billId", row.billId]);
  if (row.paymentId && !paymentById.has(row.paymentId)) missing.push(["paymentId", row.paymentId]);
  if (row.purchaseBillId) {
    const source = String(row.sourceType).startsWith("supplier_payment")
      ? purchaseHistoryById.get(row.purchaseBillId)
      : purchaseReceiptById.get(row.purchaseBillId);
    if (!source) missing.push(["purchaseBillId", row.purchaseBillId]);
  }
  for (const [field, targetId] of missing) {
    const item = { ledgerId: row.id, shopId: row.shopId, field, targetId, sourceType: row.sourceType };
    if (["source_absent", "partial"].includes(evidence?.sourceReferenceState)) archivedSourceReferences.push(item);
    else structuralFailures.push({ ...item, reason: "missing_source_without_archived_evidence" });
  }

  if (row.entryType === "sale" && row.billId && billById.has(row.billId)) {
    const expected = sourcePaise(billById.get(row.billId), "grandTotalPaise", "grandTotal");
    if (absolute(row.amountPaise) !== absolute(expected)) sourceAmountMismatches.push({ ledgerId: row.id, shopId: row.shopId, sourceId: row.billId, kind: "bill", ledgerPaise: String(row.amountPaise), sourcePaise: String(expected) });
  }
  if (["cash_in", "upi_in", "bank_in"].includes(row.entryType) && row.paymentId && paymentById.has(row.paymentId)) {
    const expected = sourcePaise(paymentById.get(row.paymentId), "amountPaise", "amount");
    if (absolute(row.amountPaise) !== absolute(expected)) sourceAmountMismatches.push({ ledgerId: row.id, shopId: row.shopId, sourceId: row.paymentId, kind: "payment", ledgerPaise: String(row.amountPaise), sourcePaise: String(expected) });
  }
}

const controls = shops.map((shop) => ({ shop, result: buildAccountingControl(ledgerByShop.get(shop.id) ?? []) }));
const accountingFailures = controls.filter(({ result }) => result.status === "attention_required");
const coveredBills = new Set(ledger.filter((row) => row.billId).map((row) => row.billId));
const uncoveredBills = bills.filter((bill) => String(bill.billType).toLowerCase() !== "estimate" && !coveredBills.has(bill.id));
const unrecognizedMismatches = sourceAmountMismatches.filter((item) => !recognizedMismatchShops.has(item.shopId));
const ledgerSourceKeys = new Set(ledger.map((row) => `${row.shopId}\u0000${row.sourceType}\u0000${row.sourceId}`));
const journalSourceKeys = new Set(journalEntries.map((entry) => `${entry.shopId}\u0000${entry.sourceType}\u0000${entry.sourceId}`));
const missingJournalProjections = [...ledgerSourceKeys].filter((key) => !journalSourceKeys.has(key));
const journalBalanceFailures = journalEntries.flatMap((entry) => {
  const debitPaise = entry.lines.reduce((sum, line) => sum + BigInt(line.debitPaise), 0n);
  const creditPaise = entry.lines.reduce((sum, line) => sum + BigInt(line.creditPaise), 0n);
  return debitPaise === creditPaise && entry.lines.length >= 2 ? [] : [{ journalEntryId: entry.id, shopId: entry.shopId, sourceType: entry.sourceType, sourceId: entry.sourceId, debitPaise: String(debitPaise), creditPaise: String(creditPaise), lines: entry.lines.length }];
});

const failures = accountingFailures.length + uncoveredBills.length + structuralFailures.length + evidenceFailures.length + unrecognizedMismatches.length + missingJournalProjections.length + journalBalanceFailures.length;
const report = {
  ok: failures === 0,
  engineVersion: ACCOUNTING_CONTROL_VERSION,
  counts: {
    shops: shops.length,
    ledgerRows: ledger.length,
    sourceGroups: controls.reduce((sum, item) => sum + item.result.coverage.sourceGroups, 0),
    accountingFailures: accountingFailures.length,
    uncoveredNonEstimateBills: uncoveredBills.length,
    evidenceFailures: evidenceFailures.length,
    structuralFailures: structuralFailures.length,
    archivedSourceReferences: archivedSourceReferences.length,
    recognizedSourceAmountMismatches: sourceAmountMismatches.length - unrecognizedMismatches.length,
    unrecognizedSourceAmountMismatches: unrecognizedMismatches.length,
    journalEntries: journalEntries.length,
    missingJournalProjections: missingJournalProjections.length,
    journalBalanceFailures: journalBalanceFailures.length,
  },
  failures: { accountingFailures, uncoveredBills, evidenceFailures, structuralFailures, unrecognizedMismatches, missingJournalProjections, journalBalanceFailures },
};

console.log(JSON.stringify(report, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
await db.$disconnect();
if (!report.ok) process.exitCode = 1;
