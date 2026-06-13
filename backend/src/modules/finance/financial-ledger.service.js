// FinancialLedger is the append-only accounting source of truth. Domain tables
// (Bill / Payment / UdharLedger / StockLedger) keep the detail; this ledger keeps one
// canonical, never-edited money row per economic effect so dashboards/reports cannot
// double-count. Reversals are posted as NEW rows, never by editing old ones.
//
// Idempotency: every row's idempotencyKey is derived deterministically from the immutable
// source id (e.g. the bill id), and `@@unique([shopId, idempotencyKey])` enforces that a
// retried/replayed money command can only ever produce the row once.
import { toPaiseBigInt } from "../../utils/money.js";

// "credit" = increases the shop's position (revenue / money received).
// "debit"  = a receivable / money owed to the shop (udhar).
const TENDER_ENTRY = {
  cash: { entryType: "cash_in", direction: "credit" },
  upi: { entryType: "upi_in", direction: "credit" },
};

function ledgerRow({
  shopId,
  customerId = null,
  billId = null,
  paymentId = null,
  sourceType,
  sourceId,
  entryType,
  direction,
  amount,
  paymentMode = null,
  businessDate,
  idempotencyKey,
}) {
  return {
    shopId,
    customerId,
    billId,
    paymentId,
    sourceType,
    sourceId,
    entryType,
    direction,
    amountPaise: toPaiseBigInt(amount),
    paymentMode,
    businessDate: businessDate ?? new Date(),
    idempotencyKey,
  };
}

/**
 * Posts the ledger entries for a freshly created bill, inside the caller's transaction:
 *   - one `sale` row for the full bill value,
 *   - one `cash_in` / `upi_in` row per tender payment,
 *   - one `udhar_debit` row when part of the bill went to credit.
 * Estimates post nothing (they are quotes, not money movements).
 */
export async function postBillCreatedLedger(tx, { shopId, bill, tenderPayments = [], creditAmount = 0, customerId = null }) {
  if (!bill?.id) return;
  const businessDate = bill.createdAt ?? new Date();
  const base = `bill:${bill.id}`;
  const rows = [];

  rows.push(ledgerRow({
    shopId,
    billId: bill.id,
    customerId,
    sourceType: "bill",
    sourceId: bill.id,
    entryType: "sale",
    direction: "credit",
    amount: bill.grandTotal,
    businessDate,
    idempotencyKey: `${base}:sale`,
  }));

  tenderPayments.forEach((payment, index) => {
    const mode = String(payment?.mode ?? "").toLowerCase();
    const mapping = TENDER_ENTRY[mode];
    if (!mapping) return;
    rows.push(ledgerRow({
      shopId,
      billId: bill.id,
      paymentId: payment.id ?? null,
      customerId,
      sourceType: "bill",
      sourceId: bill.id,
      entryType: mapping.entryType,
      direction: mapping.direction,
      amount: payment.amount,
      paymentMode: mode,
      businessDate,
      idempotencyKey: `${base}:${mapping.entryType}:${index}`,
    }));
  });

  if (creditAmount > 0 && customerId) {
    rows.push(ledgerRow({
      shopId,
      billId: bill.id,
      customerId,
      sourceType: "bill",
      sourceId: bill.id,
      entryType: "udhar_debit",
      direction: "debit",
      amount: creditAmount,
      paymentMode: "credit",
      businessDate,
      idempotencyKey: `${base}:udhar_debit`,
    }));
  }

  for (const row of rows) {
    await tx.financialLedger.create({ data: row });
  }
}
