import { dexieDB, type IdMappingRow } from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";

export const idMappingsRepository = {
  async toMap(entityType?: string): Promise<Record<string, string>> {
    await dexieDB.open();
    const scope = getOfflineScope();
    const rows = await dexieDB.id_mappings
      .where("[tenant_id+store_id]")
      .equals([scope.tenant_id, scope.store_id])
      .filter((row) => !entityType || row.entity_type === entityType)
      .toArray();
    return Object.fromEntries(rows.map((row) => [row.local_id, row.server_id]));
  },

  async putMany(
    map: Record<string, string>,
    entityType = "unknown",
  ): Promise<IdMappingRow[]> {
    await dexieDB.open();
    const scope = getOfflineScope();
    const rows = Object.entries(map).map(([local_id, server_id]) => ({
      local_id,
      server_id,
      entity_type: entityType,
      tenant_id: scope.tenant_id,
      store_id: scope.store_id,
      updated_at: nowIso(),
    }));
    if (rows.length > 0) await dexieDB.id_mappings.bulkPut(rows);
    return rows;
  },
};
