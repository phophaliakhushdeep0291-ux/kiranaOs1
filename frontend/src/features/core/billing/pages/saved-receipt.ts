import type { Bill } from "@/types/api";

/** Match the last saved receipt through the local-to-server id replacement. */
export function syncedReceiptIdentity(billId: string | undefined, bills: Bill[]) {
  if (!billId) return null;
  const bill = bills.find((candidate) => {
    const row = candidate as Bill & Record<string, unknown>;
    return [row.id, row.local_id, row.localId, row.server_id, row.clientBillId].includes(billId);
  });
  const billNo = bill?.billNumber ?? bill?.billNo;
  if (!bill || !billNo || /^PENDING-/i.test(billNo)) return null;
  return { billId: bill.id, billNo };
}
