// FinancialLedger is the append-only accounting source of truth. Domain tables
// (Bill / Payment / UdharLedger / StockLedger) keep the detail; this ledger keeps one
// canonical, never-edited money row per economic effect so dashboards/reports cannot
// double-count. Reversals are posted as NEW rows, never by editing old ones.
//
// Convention: a reversal is the SAME entryType with a NEGATED amount. So every KPI is a
// plain sum of its entryType and cancellations/restores net out exactly:
//   today sales     = sum(sale)        cash collected  = sum(cash_in)
//   upi collected   = sum(upi_in)      bank collected  = sum(bank_in)
//   udhar created   = sum(udhar_debit)
//   udhar recovered = sum(udhar_credit)
//   outstanding     = sum(udhar_debit) - sum(udhar_credit) - sum(udhar_return_credit)
//
// Idempotency: every row's idempotencyKey is deterministic and `@@unique([shopId,
// idempotencyKey])` enforces exactly-once. Create keys off the immutable bill id; cancel/
// restore keys include the operation timestamp so a legitimate cancel→restore→cancel
// cycle posts distinct rows instead of colliding.
import { toPaiseBigInt } from "../../utils/money.js";

const TENDER_ENTRY = {
  cash: { entryType: "cash_in", direction: "credit" },
  upi: { entryType: "upi_in", direction: "credit" },
  bank: { entryType: "bank_in", direction: "credit" },
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

// Posts a bill's full economic effect (sale + tenders + udhar debit) with a sign and key
// prefix. sign=+1 records it (create/restore); sign=-1 reverses it (cancel).
async function postBillEffectLedger(tx, {
  shopId,
  bill,
  tenderPayments = [],
  creditAmount = 0,
  customerId = null,
  keyBase,
  sourceType,
  sign = 1,
  businessDate,
}) {
  if (!bill?.id) return;
  const date = businessDate ?? bill.createdAt ?? new Date();
  const rows = [];

  rows.push(ledgerRow({
    shopId,
    billId: bill.id,
    customerId,
    sourceType,
    sourceId: bill.id,
    entryType: "sale",
    direction: "credit",
    amount: sign * Number(bill.grandTotal ?? 0),
    businessDate: date,
    idempotencyKey: `${keyBase}:sale`,
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
      sourceType,
      sourceId: bill.id,
      entryType: mapping.entryType,
      direction: mapping.direction,
      amount: sign * Number(payment.amount ?? 0),
      paymentMode: mode,
      businessDate: date,
      // Key on the payment's own id (stable, content-tied) rather than its array
      // position, so the key never points at a different payment if order ever shifts.
      idempotencyKey: `${keyBase}:${mapping.entryType}:${payment.id ?? index}`,
    }));
  });

  if (creditAmount > 0 && customerId) {
    rows.push(ledgerRow({
      shopId,
      billId: bill.id,
      customerId,
      sourceType,
      sourceId: bill.id,
      entryType: "udhar_debit",
      direction: "debit",
      amount: sign * Number(creditAmount),
      paymentMode: "credit",
      businessDate: date,
      idempotencyKey: `${keyBase}:udhar_debit`,
    }));
  }

  for (const row of rows) {
    await tx.financialLedger.create({ data: row });
  }
}

export async function postBillCreatedLedger(tx, args) {
  return postBillEffectLedger(tx, { ...args, keyBase: `bill:${args.bill.id}`, sourceType: "bill", sign: 1 });
}

export async function postBillCancelledLedger(tx, { reversalAt, ...args }) {
  const date = reversalAt ?? new Date();
  return postBillEffectLedger(tx, {
    ...args,
    keyBase: `bill:${args.bill.id}:cancel:${date.getTime()}`,
    sourceType: "bill_cancel",
    sign: -1,
    businessDate: date,
  });
}

export async function postBillRestoredLedger(tx, { restoreAt, ...args }) {
  const date = restoreAt ?? new Date();
  return postBillEffectLedger(tx, {
    ...args,
    keyBase: `bill:${args.bill.id}:restore:${date.getTime()}`,
    sourceType: "bill_restore",
    sign: 1,
    businessDate: date,
  });
}

/**
 * Post the economic effect of a finalized sale return. Return bills already
 * store negative sale/tender amounts, so those values flow into the same KPI
 * buckets as ordinary bill reversals. Udhar refunds are tracked separately
 * from customer repayments: both reduce outstanding, but only a real payment
 * belongs in the "udhar recovered" metric.
 */
export async function postSaleReturnLedger(tx, {
  shopId,
  bill,
  refundMode,
  refundAmount,
  customerId = null,
  businessDate,
}) {
  if (!bill?.id || !(Number(refundAmount) > 0)) return;
  const date = businessDate ?? bill.createdAt ?? new Date();
  const keyBase = `return:${bill.id}`;
  const mode = String(refundMode ?? "").toLowerCase();
  const rows = [ledgerRow({
    shopId,
    billId: bill.id,
    customerId,
    sourceType: "sale_return",
    sourceId: bill.id,
    entryType: "sale",
    direction: "credit",
    amount: Number(bill.grandTotal ?? -Math.abs(Number(refundAmount))),
    businessDate: date,
    idempotencyKey: `${keyBase}:sale`,
  })];

  const tender = TENDER_ENTRY[mode];
  if (tender) {
    const payment = (bill.payments ?? []).find((row) => String(row.mode).toLowerCase() === mode);
    rows.push(ledgerRow({
      shopId,
      billId: bill.id,
      paymentId: payment?.id ?? null,
      customerId,
      sourceType: "sale_return",
      sourceId: bill.id,
      entryType: tender.entryType,
      direction: tender.direction,
      amount: Number(payment?.amount ?? -Math.abs(Number(refundAmount))),
      paymentMode: mode,
      businessDate: date,
      idempotencyKey: `${keyBase}:${tender.entryType}`,
    }));
  } else if (mode === "udhar") {
    rows.push(ledgerRow({
      shopId,
      billId: bill.id,
      customerId,
      sourceType: "sale_return",
      sourceId: bill.id,
      entryType: "udhar_return_credit",
      direction: "credit",
      amount: Math.abs(Number(refundAmount)),
      paymentMode: "credit",
      businessDate: date,
      idempotencyKey: `${keyBase}:udhar_return_credit`,
    }));
  } else if (mode === "gift_card") {
    rows.push(ledgerRow({
      shopId,
      billId: bill.id,
      customerId,
      sourceType: "sale_return",
      sourceId: bill.id,
      entryType: "gift_card_issued",
      direction: "credit",
      amount: Math.abs(Number(refundAmount)),
      paymentMode: "gift_card",
      businessDate: date,
      idempotencyKey: `${keyBase}:gift_card_issued`,
    }));
  }

  for (const row of rows) await tx.financialLedger.create({ data: row });
}

// Udhar khata payment: money in (cash_in/upi_in/bank_in) + outstanding down (udhar_credit).
// sign=-1 reverses it (cash back out + outstanding restored). Keyed on the immutable
// ledger entry id, which the caller already creates idempotently.
export async function postUdharPaymentLedger(tx, {
  shopId,
  ledgerEntryId,
  customerId = null,
  amount,
  mode = "cash",
  businessDate,
  sign = 1,
  keyPrefix = "udhar-payment",
}) {
  if (!ledgerEntryId || !(Number(amount) > 0)) return;
  const tender = TENDER_ENTRY[String(mode).toLowerCase()] ?? TENDER_ENTRY.cash;
  const base = `${keyPrefix}:${ledgerEntryId}`;
  const date = businessDate ?? new Date();
  const rows = [
    ledgerRow({
      shopId,
      customerId,
      sourceType: "udhar_payment",
      sourceId: ledgerEntryId,
      entryType: tender.entryType,
      direction: tender.direction,
      amount: sign * Number(amount),
      paymentMode: String(mode).toLowerCase(),
      businessDate: date,
      idempotencyKey: `${base}:${tender.entryType}`,
    }),
    ledgerRow({
      shopId,
      customerId,
      sourceType: "udhar_payment",
      sourceId: ledgerEntryId,
      entryType: "udhar_credit",
      direction: "credit",
      amount: sign * Number(amount),
      paymentMode: String(mode).toLowerCase(),
      businessDate: date,
      idempotencyKey: `${base}:udhar_credit`,
    }),
  ];
  for (const row of rows) {
    await tx.financialLedger.create({ data: row });
  }
}

const PAISE_PER_RUPEE = 100;
const SUMMARY_ENTRY_TYPES = ["sale", "cash_in", "upi_in", "bank_in", "udhar_debit", "udhar_credit", "udhar_return_credit", "gift_card_issued"];

/**
 * Summarize FinancialLedger rows into KPIs. Because a reversal is the SAME entryType with a
 * negated amount, every KPI is a plain sum over its entryType and cancellations net out — so this
 * is just a grouped sum of amountPaise. Pure (no DB), so it can back both a server read and tests.
 * Input rows carry `entryType` + `amountPaise` (BigInt | number | numeric string); output is rupees.
 *
 * This is the read foundation for sourcing dashboard/report KPIs from the ledger. It is NOT yet
 * wired into any report — that switch changes displayed numbers and needs a backfill of pre-ledger
 * bills, which is a deliberate, separate step.
 */
export function summarizeFinancialLedger(rows = []) {
  const totals = Object.fromEntries(SUMMARY_ENTRY_TYPES.map((type) => [type, 0n]));
  for (const row of rows) {
    const type = row?.entryType;
    if (!Object.prototype.hasOwnProperty.call(totals, type)) continue;
    totals[type] += BigInt(row.amountPaise ?? 0);
  }
  const rupees = (paise) => Number(paise) / PAISE_PER_RUPEE;
  const udharCreated = rupees(totals.udhar_debit);
  const udharRecovered = rupees(totals.udhar_credit);
  const udharReturnCredits = rupees(totals.udhar_return_credit);
  return {
    sales: rupees(totals.sale),
    cashCollected: rupees(totals.cash_in),
    upiCollected: rupees(totals.upi_in),
    bankCollected: rupees(totals.bank_in),
    udharCreated,
    udharRecovered,
    udharReturnCredits,
    giftCardIssued: rupees(totals.gift_card_issued),
    outstanding: Math.round((udharCreated - udharRecovered - udharReturnCredits) * PAISE_PER_RUPEE) / PAISE_PER_RUPEE,
  };
}
