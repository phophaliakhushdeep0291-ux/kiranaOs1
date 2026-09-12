import { dedupePaymentsForDisplay } from "@/features/core/sync/bill-reconciliation";

type Row = Record<string, unknown>;
export function supplierPurchaseKeys(row: Row): string[] {
  return [...new Set(["purchase_history_id", "purchaseHistoryId", "purchase_bill_id", "purchaseBillId", "local_purchase_history_id", "localPurchaseHistoryId", "localPurchaseBillId", "local_purchase_bill_id"]
    .map((key) => String(row[key] ?? "")).filter(Boolean))];
}

function paymentKeys(row: Row): string[] {
  return ["id", "local_id", "server_id", "localId", "serverId"].map((key) => String(row[key] ?? "")).filter(Boolean);
}

/** Keep dated reversals as money coming back on the reversal day. Purchase
 * totals are cumulative; embedded ledger history also survives a fresh device. */
export function mergeSupplierPaymentHistory(payments: Row[], purchases: Row[]): Row[] {
  const embedded = purchases.flatMap((purchase) => Array.isArray(purchase.supplierPayments)
    ? purchase.supplierPayments.filter((row): row is Row => Boolean(row) && typeof row === "object") : []);
  const all = [...payments, ...embedded];
  const reversals: Row[] = [];
  for (const row of payments) {
    if (row.kind !== "supplier_payment" || row.status !== "reversed" || !row.reversed_at) continue;
    const keys = paymentKeys(row);
    if (all.some((entry) => keys.includes(String(entry.reverses_payment_id ?? "")))) continue;
    reversals.push({ ...row, id: `reversal:${keys[0]}`, local_id: `reversal:${keys[0]}`, server_id: undefined,
      status: "active", amount: -Math.abs(Number(row.amount) || 0), paid_at: row.reversed_at,
      created_at: row.reversed_at, reverses_payment_id: keys[0] });
  }
  const normalized = all.map((row) => row.kind === "supplier_payment" && row.status === "reversed" && row.reversed_at
    ? { ...row, status: "active" } : row);
  return dedupePaymentsForDisplay([...normalized, ...reversals]);
}
