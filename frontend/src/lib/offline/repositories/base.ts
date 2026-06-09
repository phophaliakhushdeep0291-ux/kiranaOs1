import type { Table } from "dexie";
import {
  dexieDB,
  rowMatchesCurrentScope,
  type OfflineRow,
} from "@/lib/offline/db";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import type { SyncStatus } from "@/types/domain";

export type LocalEntityRecord<
  T extends Record<string, unknown> = Record<string, unknown>,
> = T & OfflineRow;

export interface RepositoryListOptions {
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

function makeId(prefix: string) {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function withLocalEntityDefaults<T extends Record<string, unknown>>(
  input: T,
  prefix: string,
  syncStatus: SyncStatus = "synced",
): LocalEntityRecord<T> {
  const scope = getOfflineScope();
  const now = nowIso();
  const createdAt = input.created_at ?? input.createdAt ?? now;
  const updatedAt = input.updated_at ?? input.updatedAt ?? now;
  const id =
    typeof input.id === "string" && input.id.length > 0
      ? input.id
      : makeId(prefix);

  return {
    ...input,
    id,
    local_id: typeof input.local_id === "string" ? input.local_id : id,
    server_id:
      typeof input.server_id === "string"
        ? input.server_id
        : typeof input.serverId === "string"
          ? input.serverId
          : undefined,
    tenant_id:
      typeof input.tenant_id === "string" ? input.tenant_id : scope.tenant_id,
    store_id:
      typeof input.store_id === "string" ? input.store_id : scope.store_id,
    created_at: typeof createdAt === "string" ? createdAt : now,
    updated_at: typeof updatedAt === "string" ? updatedAt : now,
    deleted_at:
      typeof input.deleted_at === "string" || input.deleted_at === null
        ? (input.deleted_at as string | null)
        : null,
    version: typeof input.version === "number" ? input.version : 1,
    sync_status:
      typeof input.sync_status === "string"
        ? (input.sync_status as SyncStatus)
        : syncStatus,
    last_modified_by:
      typeof input.last_modified_by === "string" ||
      input.last_modified_by === null
        ? (input.last_modified_by as string | null)
        : null,
    device_id:
      typeof input.device_id === "string" ? input.device_id : scope.device_id,
  };
}

export class LocalRepository<T extends Record<string, unknown>> {
  constructor(
    private readonly tableName: string,
    private readonly idPrefix: string,
  ) {}

  private table(): Table<LocalEntityRecord<T>, string> {
    return dexieDB.table(this.tableName) as Table<LocalEntityRecord<T>, string>;
  }

  async get(id: string): Promise<LocalEntityRecord<T> | undefined> {
    await dexieDB.open();
    const row = await this.table().get(id);
    return row && rowMatchesCurrentScope(row) ? row : undefined;
  }

  async list(
    options: RepositoryListOptions = {},
  ): Promise<Array<LocalEntityRecord<T>>> {
    await dexieDB.open();
    const scope = getOfflineScope();
    let rows = await this.table()
      .where("[tenant_id+store_id]")
      .equals([scope.tenant_id, scope.store_id])
      .toArray()
      .catch(() => this.table().filter(rowMatchesCurrentScope).toArray());
    if (!options.includeDeleted)
      rows = rows.filter(
        (row) => row.deleted_at == null && row.deletedAt == null,
      );
    rows.sort((a, b) =>
      String(b.updated_at ?? b.updatedAt ?? "").localeCompare(
        String(a.updated_at ?? a.updatedAt ?? ""),
      ),
    );
    const offset = Math.max(0, Number(options.offset ?? 0));
    const limit = Number(options.limit ?? rows.length);
    return rows.slice(
      offset,
      Number.isFinite(limit) && limit > 0 ? offset + limit : rows.length,
    );
  }

  async searchByText(
    fields: string[],
    query: string,
    limit = 50,
  ): Promise<Array<LocalEntityRecord<T>>> {
    const q = query.trim().toLowerCase();
    if (!q) return this.list({ limit });
    const rows = await this.list({ limit: 1000 });
    return rows
      .filter((row) =>
        fields.some((field) =>
          String((row as Record<string, unknown>)[field] ?? "")
            .toLowerCase()
            .includes(q),
        ),
      )
      .slice(0, limit);
  }

  async put(
    input: T,
    syncStatus: SyncStatus = "synced",
  ): Promise<LocalEntityRecord<T>> {
    await dexieDB.open();
    const row = withLocalEntityDefaults(input, this.idPrefix, syncStatus);
    await this.table().put(row);
    return row;
  }

  async bulkPut(
    inputs: T[],
    syncStatus: SyncStatus = "synced",
  ): Promise<Array<LocalEntityRecord<T>>> {
    await dexieDB.open();
    if (inputs.length === 0) return [];
    const rows = inputs
      .filter(isRecord)
      .map((input) =>
        withLocalEntityDefaults(input as T, this.idPrefix, syncStatus),
      );
    await this.table().bulkPut(rows);
    return rows;
  }

  async softDelete(
    id: string,
    syncStatus: SyncStatus = "pending_sync",
  ): Promise<void> {
    await dexieDB.open();
    const existing = await this.table().get(id);
    if (!existing || !rowMatchesCurrentScope(existing)) return;
    await this.table().put({
      ...existing,
      deleted_at: nowIso(),
      updated_at: nowIso(),
      version: existing.version + 1,
      sync_status: syncStatus,
    });
  }

  async hardDelete(id: string): Promise<void> {
    await dexieDB.open();
    const existing = await this.table().get(id);
    if (!existing || !rowMatchesCurrentScope(existing)) return;
    await this.table().delete(id);
  }
}
