import {
  dexieDB,
  rowMatchesCurrentScope,
  type PendingSyncEvent,
} from "@/lib/offline/db";
import { getOfflineScope } from "@/lib/offline/context";

export const syncOutboxRepository = {
  async listPending(limit = 50): Promise<PendingSyncEvent[]> {
    await dexieDB.open();
    const scope = getOfflineScope();
    return dexieDB.sync_outbox
      .where("[tenant_id+store_id]")
      .equals([scope.tenant_id, scope.store_id])
      .filter(
        (event) =>
          event.status === "PENDING" ||
          event.status === "FAILED" ||
          event.sync_status === "pending_sync" ||
          event.sync_status === "failed",
      )
      .limit(limit)
      .sortBy("createdAt");
  },

  async count(): Promise<number> {
    await dexieDB.open();
    const scope = getOfflineScope();
    return dexieDB.sync_outbox
      .where("[tenant_id+store_id]")
      .equals([scope.tenant_id, scope.store_id])
      .filter(
        (event) =>
          event.status === "PENDING" ||
          event.status === "FAILED" ||
          event.sync_status === "pending_sync" ||
          event.sync_status === "failed",
      )
      .count();
  },

  async remove(clientEventId: string): Promise<void> {
    await dexieDB.open();
    const row = await dexieDB.sync_outbox.get(clientEventId);
    if (row && rowMatchesCurrentScope(row))
      await dexieDB.sync_outbox.delete(clientEventId);
    const matching = await dexieDB.sync_outbox
      .where("op_id")
      .equals(clientEventId)
      .filter(rowMatchesCurrentScope)
      .toArray();
    if (matching.length > 0)
      await dexieDB.sync_outbox.bulkDelete(
        matching.map((event) => event.clientEventId),
      );
  },
};
