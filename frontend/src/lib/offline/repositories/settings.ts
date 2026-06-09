import {
  dexieDB,
  rowMatchesCurrentScope,
  type LocalSettingRow,
} from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";

export const settingsRepository = {
  async get<T>(key: string): Promise<T | null> {
    await dexieDB.open();
    const row = await dexieDB.settings.get(key);
    if (
      !row ||
      !rowMatchesCurrentScope(row) ||
      (row.expires_at && row.expires_at < Date.now())
    )
      return null;
    return row.value as T;
  },

  async set<T>(
    key: string,
    value: T,
    expiresAt?: number | null,
  ): Promise<LocalSettingRow> {
    await dexieDB.open();
    const scope = getOfflineScope();
    const row: LocalSettingRow = {
      key,
      value,
      tenant_id: scope.tenant_id,
      store_id: scope.store_id,
      updated_at: nowIso(),
      expires_at: expiresAt ?? null,
    };
    await dexieDB.settings.put(row);
    return row;
  },

  async remove(key: string): Promise<void> {
    await dexieDB.open();
    const row = await dexieDB.settings.get(key);
    if (row && rowMatchesCurrentScope(row)) await dexieDB.settings.delete(key);
  },
};
