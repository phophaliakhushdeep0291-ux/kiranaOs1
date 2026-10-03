import { offlineDB, assertCurrentOfflineScope } from "@/lib/offline/db";
import { getOfflineScope } from "@/lib/offline/context";
import { readBillIdentityTwins, uniqueRows } from "@/features/core/sync/bill-reconciliation";
import { billIdentityKeys, dedupeBillsForDisplay } from "@/features/core/sync/bill-reconciliation";
import { cacheTablesForEntity } from "@/features/core/sync/cache-dependencies";
import type { Bill } from "@/types/api";

type Row = Record<string, unknown> & { id: string };
type LocalBill = Bill & Row;

/** Unknown events (restore/reset) and sync may affect any record. */
export function dashboardChangeAffects(detail: Record<string, unknown> | undefined, area: "products" | "bills"): boolean {
  const type = detail?.type ?? detail?.entityType;
  const tables = typeof type === "string" && type !== "sync" ? cacheTablesForEntity(type) : null;
  return tables === null || tables.includes(area);
}

export async function loadRecentDashboardBills(limit = 10, includeCancelled = false): Promise<Bill[]> {
  const scope = getOfflineScope();
  const cancelled = (bill: Record<string, unknown>) => String(bill.status ?? "").toLowerCase().includes("cancel");
  let count = Math.max(20, limit * 2);
  for (;;) {
    const seeds = await offlineDB.getLatest<LocalBill>("bills", "_read_created_at", count);
    const rows = await readBillIdentityTwins(seeds);
    const ids = [...new Set(rows.flatMap(billIdentityKeys))];
    const [itemRows, paymentRows] = await Promise.all(["bill_items", "payments"].map(async (table) =>
      (await Promise.all(["bill_id", "billId"].map((field) => offlineDB.getWhere<Row>(table, field, ids)))).flat()));
    const group = (children: Row[]) => {
      const groups = new Map<string, Row[]>();
      for (const row of uniqueRows(children)) {
        const id = String(row.billId ?? row.bill_id ?? "");
        const list = groups.get(id) ?? [];
        list.push(row);
        groups.set(id, list);
      }
      return groups;
    };
    const items = group(itemRows);
    const payments = group(paymentRows);
    const joined: LocalBill[] = rows.map((bill) => {
      const identities = [...new Set(billIdentityKeys(bill))];
      return {
        ...bill,
        items: Array.isArray(bill.items) ? bill.items : identities.flatMap((id) => items.get(id) ?? []),
        payments: Array.isArray(bill.payments) ? bill.payments : identities.flatMap((id) => payments.get(id) ?? []),
      } as LocalBill;
    });
    const deduped = dedupeBillsForDisplay(joined);
    const visible = deduped.filter((bill) => !cancelled(bill))
      .sort((a, b) => Number(b._read_created_at ?? 0) - Number(a._read_created_at ?? 0));
    assertCurrentOfflineScope(scope);
    if (visible.length >= limit || seeds.length < count) return [
      ...visible.slice(0, limit), ...(includeCancelled ? deduped.filter(cancelled) : []),
    ] as unknown as Bill[];
    count *= 2;
  }
}
