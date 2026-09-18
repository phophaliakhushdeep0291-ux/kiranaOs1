import { dexieDB, rowMatchesCurrentScope, type PendingSyncEvent } from "@/lib/offline/db";
import { isLocalPurchaseOverride } from "@/features/core/purchases/sync-guards";
import { isRecord } from "@/features/core/sync/sync-types";

const PURCHASE_OPERATIONS = new Set([
  "UPDATE_PURCHASE_BILL", "DELETE_PURCHASE_BILL", "RECORD_SUPPLIER_PAYMENT", "REVERSE_SUPPLIER_PAYMENT",
]);
const TABLES = ["purchase_bills", "inventory_movements"] as const;
type PurchaseTable = typeof TABLES[number];
type Row = Record<string, unknown>;

function identities(row: Row): string[] {
  return [row.id, row.local_id, row.localId, row.server_id, row.serverId]
    .filter((id): id is string => typeof id === "string" && Boolean(id));
}

function targets(event: PendingSyncEvent, table: PurchaseTable, row: Row): boolean {
  const payload = isRecord(event.payload) ? event.payload : {};
  const affected = Array.isArray(payload.affectedRows) ? payload.affectedRows.filter(isRecord) : [];
  const ids = new Set(identities(row));
  return affected.some((target) => target.tableName === table && identities(target).some((id) => ids.has(id)))
    || (table === "purchase_bills"
      ? [payload.purchaseHistoryId, payload.purchaseBillId, payload.localPurchaseHistoryId, payload.localPurchaseBillId]
      : [payload.stockLedgerId, payload.inventoryMovementId, payload.localMovementId])
      .some((id) => typeof id === "string" && ids.has(id));
}

/** A purchase operation updates two local projections as well as its primary entity.
 * Acknowledge them together, but only after every operation targeting that row has
 * completed. The transaction prevents a new local payment racing this cleanup.
 */
export async function acknowledgeCompletedPurchaseRows(): Promise<number> {
  let acknowledged = 0;
  await dexieDB.transaction("rw", [dexieDB.sync_outbox, dexieDB.purchase_bills, dexieDB.inventory_movements], async () => {
    const events = await dexieDB.sync_outbox.filter(rowMatchesCurrentScope).toArray();
    const purchaseEvents = events.filter((event) => PURCHASE_OPERATIONS.has(event.operation_type));
    if (!purchaseEvents.length) return;
    for (const tableName of TABLES) {
      const table = dexieDB.table(tableName);
      const rows = await table.filter(rowMatchesCurrentScope).toArray();
      for (const row of rows) {
        if (!isLocalPurchaseOverride(row)) continue;
        const related = purchaseEvents.filter((event) => targets(event, tableName, row));
        // Failed/conflicted operations still own their optimistic changes.
        if (!related.length || related.some((event) => event.status !== "SYNCED")) continue;
        const marker = row.local_purchase_operation_id;
        const overrideAt = Date.parse(String(row.local_purchase_override_at ?? row.localPurchaseOverrideAt ?? ""));
        const proof = related.some((event) => marker
          ? marker === event.clientEventId
          : Number.isFinite(overrideAt) && Date.parse(event.last_attempt_at ?? "") >= overrideAt);
        if (!proof) continue;
        // Also preserve a separate stock mutation on the same physical row.
        if (events.some((event) => event.status !== "SYNCED" && identities(row).includes(event.entity_id))) continue;
        const clean: Row = { ...row, sync_status: "synced" };
        for (const key of ["local_purchase_action", "localPurchaseAction", "local_purchase_override_at", "localPurchaseOverrideAt", "local_purchase_previous_keys", "localPurchasePreviousKeys", "local_purchase_operation_id"]) {
          delete clean[key];
        }
        await table.put(clean);
        acknowledged += 1;
      }
    }
  });
  return acknowledged;
}
