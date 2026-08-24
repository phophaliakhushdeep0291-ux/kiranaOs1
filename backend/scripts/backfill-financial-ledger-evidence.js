import db from "../src/db.js";

const apply = process.argv.includes("--apply");
const [ledgerRows, bills, payments, purchaseHistory, purchaseReceipts] = await Promise.all([
  db.financialLedger.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  db.bill.findMany(),
  db.payment.findMany(),
  db.purchaseHistory.findMany(),
  db.purchaseReceipt.findMany(),
]);
const billById = new Map(bills.map((row) => [row.id, row]));
const paymentById = new Map(payments.map((row) => [row.id, row]));
const purchaseHistoryById = new Map(purchaseHistory.map((row) => [row.id, row]));
const purchaseReceiptById = new Map(purchaseReceipts.map((row) => [row.id, row]));

function moneySnapshot(row, amountKey, paiseKey) {
  if (!row) return null;
  const paise = row[paiseKey] == null ? Math.round(Number(row[amountKey] ?? 0) * 100) : Number(row[paiseKey]);
  return { amount: Number(row[amountKey] ?? paise / 100), amountPaise: String(paise) };
}

function evidenceFor(row) {
  const bill = row.billId ? billById.get(row.billId) : null;
  const payment = row.paymentId ? paymentById.get(row.paymentId) : null;
  const purchase = row.purchaseBillId
    ? (String(row.sourceType).startsWith("supplier_payment") ? purchaseHistoryById.get(row.purchaseBillId) : purchaseReceiptById.get(row.purchaseBillId))
    : null;
  const referenced = [row.billId && bill, row.paymentId && payment, row.purchaseBillId && purchase].filter(Boolean).length;
  const expected = [row.billId, row.paymentId, row.purchaseBillId].filter(Boolean).length;
  return JSON.stringify({
    version: 1,
    capturedAt: new Date().toISOString(),
    legacyBackfill: true,
    sourceReferenceState: expected === 0 ? "not_applicable" : referenced === expected ? "complete" : referenced > 0 ? "partial" : "source_absent",
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    billId: row.billId,
    paymentId: row.paymentId,
    purchaseBillId: row.purchaseBillId,
    entryType: row.entryType,
    direction: row.direction,
    amountPaise: String(row.amountPaise),
    paymentMode: row.paymentMode,
    bill: bill ? { billNo: bill.billNo, billType: bill.billType, status: bill.status, ...moneySnapshot(bill, "grandTotal", "grandTotalPaise") } : null,
    payment: payment ? { mode: payment.mode, status: payment.status, ...moneySnapshot(payment, "amount", "amountPaise") } : null,
    purchase: purchase ? {
      id: purchase.id,
      invoiceNumber: purchase.invoiceNumber ?? purchase.supplierInvoiceNumber ?? null,
      ...moneySnapshot(purchase, purchase.totalAmount == null ? "billAmount" : "totalAmount", purchase.totalAmountPaise == null ? "billAmountPaise" : "totalAmountPaise"),
    } : null,
  });
}

const candidates = ledgerRows.filter((row) => !row.evidenceJson || row.evidenceJson === "{}");
if (apply) {
  for (const row of candidates) {
    await db.financialLedger.update({ where: { id: row.id }, data: { evidenceJson: evidenceFor(row) } });
  }
}
const states = candidates.reduce((counts, row) => {
  const state = JSON.parse(evidenceFor(row)).sourceReferenceState;
  counts[state] = (counts[state] ?? 0) + 1;
  return counts;
}, {});
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ledgerRows: ledgerRows.length, evidenceRowsUpdated: apply ? candidates.length : 0, evidenceRowsProposed: candidates.length, sourceReferenceStates: states }, null, 2));
await db.$disconnect();
