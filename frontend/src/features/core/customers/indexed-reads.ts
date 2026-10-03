import { offlineDB } from "@/lib/offline/db";
import { customerReference, offlineReadIndexes } from "@/lib/offline/read-indexes";
import { uniqueRows } from "@/features/core/sync/bill-reconciliation";
import { dedupeLedgerEntries, isManualAdjustmentEntry, type CustomerLedgerEntry } from "@/features/core/ledger/accounting";

type Row = Record<string, unknown>;

/** Customer links are bidirectional. Ignore mappings belonging to other entities. */
export async function expandIndexedCustomerIds(seed: Iterable<string>): Promise<Set<string>> {
  const ids = new Set(seed);
  let frontier = [...ids];
  while (frontier.length) {
    const mappings = await offlineDB.getWhere<Row>("id_mappings", "_read_mapping_ids", frontier);
    const next = new Set<string>();
    for (const mapping of mappings) {
      const type = String(mapping.entity_type ?? mapping.entityType ?? "");
      if (type && type !== "customer" && type !== "customers") continue;
      for (const id of offlineReadIndexes("id_mappings", mapping)._read_mapping_ids as string[]) {
        if (!ids.has(id)) next.add(id);
      }
    }
    frontier = [...next];
    frontier.forEach((id) => ids.add(id));
  }
  return ids;
}

/** Adjustments and legacy rows without a scoped source need global dedupe. */
export async function readIndexedCustomerLedger(ids: Set<string>): Promise<CustomerLedgerEntry[]> {
  const own = uniqueRows(await offlineDB.getWhere<CustomerLedgerEntry>("customer_ledger", "_read_customer_id", ids));
  const globalDedupe = own.some((row) => isManualAdjustmentEntry(row)
    || typeof (row.customerId ?? row.customer_id) !== "string"
    || !["source_id", "sourceId", "bill_id", "billId", "payment_id", "paymentId", "local_bill_id", "localBillId"]
      .some((key) => typeof row[key] === "string" ? Boolean(String(row[key]).trim()) : typeof row[key] === "number" && Number.isFinite(row[key])));
  const rows = globalDedupe ? await offlineDB.getAll<CustomerLedgerEntry>("customer_ledger") : own;
  return dedupeLedgerEntries(rows).filter((row) => {
    const id = customerReference(row);
    return id !== undefined && ids.has(id);
  });
}
