import { fromPaise, toPaiseBigInt } from "../../utils/money.js";

const SETTLEMENT_SOURCES = ["supplier_payment", "supplier_payment_reversal"];

/** PurchaseHistory.paid is cumulative. Separate its original tender from the
 * dated settlement journal so a later UPI payment cannot become yesterday's cash.
 * PO receipts retain their initial paid amount separately and are counted once.
 */
export async function supplierCashPaidForDay(client, shopId, { start, end, locationId }) {
  const [receipts, purchases, settlements] = await Promise.all([
    client.purchaseReceipt.findMany({
      where: { shopId, ...(locationId && { locationId }), createdAt: { gte: start, lte: end }, paidAmount: { gt: 0 }, paymentMode: "cash" },
      select: { paidAmount: true },
    }),
    client.purchaseHistory.findMany({
      where: { shopId, ...(locationId && { locationId }), purchaseReceiptId: null, createdAt: { gte: start, lte: end }, purchasePaymentMode: "cash" },
      select: { id: true, purchasePaidAmount: true },
    }),
    client.financialLedger.findMany({
      where: { shopId, sourceType: { in: SETTLEMENT_SOURCES }, paymentMode: "cash", businessDate: { gte: start, lte: end } },
      select: { purchaseBillId: true, amountPaise: true },
    }),
  ]);
  const [settledTotals, scopedPurchases] = await Promise.all([
    purchases.length ? client.financialLedger.groupBy({
      by: ["purchaseBillId"],
      where: { shopId, sourceType: { in: SETTLEMENT_SOURCES }, purchaseBillId: { in: purchases.map((row) => row.id) } },
      _sum: { amountPaise: true },
    }) : [],
    locationId && settlements.length ? client.purchaseHistory.findMany({
      where: { shopId, locationId, id: { in: [...new Set(settlements.map((row) => row.purchaseBillId).filter(Boolean))] } },
      select: { id: true },
    }) : null,
  ]);
  const totals = new Map(settledTotals.map((row) => [row.purchaseBillId, row._sum.amountPaise ?? 0n]));
  const allowed = scopedPurchases ? new Set(scopedPurchases.map((row) => row.id)) : null;
  let cashPaise = receipts.reduce((sum, row) => sum + toPaiseBigInt(row.paidAmount), 0n);
  for (const row of purchases) {
    const initialPaid = toPaiseBigInt(row.purchasePaidAmount) - (totals.get(row.id) ?? 0n);
    cashPaise += initialPaid > 0n ? initialPaid : 0n;
  }
  for (const row of settlements) {
    if (!allowed || allowed.has(row.purchaseBillId)) cashPaise += row.amountPaise;
  }
  return fromPaise(Number(cashPaise));
}
