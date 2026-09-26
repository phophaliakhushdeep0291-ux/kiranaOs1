import { postFinancialLedgerRows } from "../../../modules/finance/general-ledger.service.js";
import { AppError } from "../../../middleware/error.js";
import { toPaise } from "../../../utils/money.js";

/**
 * Receipts on this order that the ledger has no matching history for.
 *
 * Detection and repair read this same function on purpose. When the guard
 * decided for itself which receipts were unbacked and the repair decided
 * separately, the two could disagree — and the failure mode of that
 * disagreement is a repair that reports success while the order stays frozen,
 * or one that posts history for a receipt the guard never doubted.
 *
 * A receipt counts as backed only when BOTH its rows exist AND carry its exact
 * amount. A row whose amount has drifted is not partial history; it is history
 * that disagrees with the receipt, which is the case most worth stopping on.
 */
export async function unreconciledFurnitureReceipts(tx, order) {
  if (!order.payments.length) return [];
  const rows = await tx.financialLedger.findMany({ where: {
    shopId: order.shopId, sourceType: "furniture_order", sourceId: order.id,
    idempotencyKey: { startsWith: `furniture:${order.id}:receipt:` },
  } });
  const byKey = new Map(rows.map((entry) => [entry.idempotencyKey, entry]));
  return order.payments.filter((payment) => [furnitureTender(payment.mode), "furniture_advance"].some((entryType) => {
    const entry = byKey.get(`furniture:${order.id}:receipt:${payment.id}:${entryType}`);
    return !entry || entry.amountPaise !== BigInt(toPaise(payment.amount));
  }));
}

// Old child receipts are not proof that cash ever reached the ledger. Refuse
// to apply or reverse them until their history has been explicitly reconciled.
export async function requireFurnitureAccounting(tx, order) {
  if ((await unreconciledFurnitureReceipts(tx, order)).length > 0) {
    throw new AppError("This order has older payments that need accounting reconciliation before further financial changes.", 409, "ORDER_LEGACY_FINANCE_REVIEW");
  }
}

export function furnitureTender(mode) {
  if (!["cash", "upi", "bank", "card", "other"].includes(mode)) {
    throw new AppError("Select how the money was received", 400);
  }
  return `furniture_${mode === "card" ? "bank" : mode}`;
}

function row(order, payment, event, entryType, amount, businessDate, evidence) {
  return {
    shopId: order.shopId,
    customerId: order.customerId,
    sourceType: "furniture_order",
    sourceId: order.id,
    entryType,
    direction: entryType === "furniture_advance" ? "credit" : "debit",
    amountPaise: BigInt(toPaise(amount)),
    paymentMode: payment.mode,
    businessDate,
    idempotencyKey: `furniture:${order.id}:${event}:${payment.id}:${entryType}`,
    evidenceJson: JSON.stringify(evidence),
  };
}

/** Record money received before delivery as cash/bank against a liability. */
export async function postFurnitureReceipt(tx, order, payment) {
  const evidence = {
    version: 1,
    event: payment.kind ?? "receipt",
    locationId: order.locationId,
    orderNumber: order.orderNumber,
    paymentId: payment.id,
    paymentMode: payment.mode,
    reference: payment.reference,
    reason: payment.reason,
    reversesPaymentId: payment.reversesPaymentId,
  };
  await postFinancialLedgerRows(tx, [
    row(order, payment, "receipt", furnitureTender(payment.mode), payment.amount, payment.paidOn, evidence),
    row(order, payment, "receipt", "furniture_advance", payment.amount, payment.paidOn, evidence),
  ]);
}

/**
 * The ordinary sale bill recognizes revenue and repeats its tender. Reverse
 * that repeated tender and consume the advance liability when delivery links
 * the bill, leaving the original dated receipt and one sale in the accounts.
 */
export async function applyFurnitureReceiptsToBill(tx, order, bill) {
  await requireFurnitureAccounting(tx, order);
  if (await tx.bankReconciliationAllocation.findFirst({ where: { shopId: order.shopId, status: "active",
    ledgerRow: { billId: bill.id, sourceType: "bill", entryType: { in: ["bank_in", "upi_in"] } },
  } })) throw new AppError("Reverse the invoice's bank statement match and match the original order receipt before linking delivery.", 409, "ORDER_BILL_BANK_MATCH_REVIEW");
  // Offset the bill on its economic date, even if delivery is confirmed later.
  const businessDate = bill.businessDate;
  const rows = order.payments.flatMap((payment) => {
    const evidence = {
      version: 1,
      event: "invoice_application",
      orderNumber: order.orderNumber,
      paymentId: payment.id,
      billId: bill.id,
      billNumber: bill.billNo,
      paymentMode: payment.mode,
    };
    return [
      row(order, payment, `invoice:${bill.id}`, furnitureTender(payment.mode), -payment.amount, businessDate, evidence),
      row(order, payment, `invoice:${bill.id}`, "furniture_advance", -payment.amount, businessDate, evidence),
    ];
  });
  await postFinancialLedgerRows(tx, rows);
}
