import { z } from "zod";
import { ApiClientError } from "@/lib/api/http";
import { getOfflineScope, nowIso } from "@/lib/offline/context";
import { createLocalId } from "@/lib/offline/instant-cache";
import type { SyncStatus } from "@/types/domain";

export interface LocalApiEntityMeta {
  local_id?: string;
  server_id?: string;
  tenant_id: string;
  store_id: string;
  device_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version: number;
  sync_status: SyncStatus;
}

export type LocalApiEntity<T extends { id: string }> = T & LocalApiEntityMeta;

export function makeLocalEntity<T extends { id?: string; createdAt?: string; updatedAt?: string }>(
  input: T,
  idPrefix: string,
  syncStatus: SyncStatus = "pending_sync",
): LocalApiEntity<Omit<T, "id"> & { id: string }> {
  const scope = getOfflineScope();
  const now = nowIso();
  const id = input.id || createLocalId(idPrefix);
  return {
    ...input,
    id,
    local_id: id,
    tenant_id: scope.tenant_id,
    store_id: scope.store_id,
    device_id: scope.device_id,
    created_at: input.createdAt ?? now,
    updated_at: input.updatedAt ?? now,
    deleted_at: null,
    version: 1,
    sync_status: syncStatus,
  } as LocalApiEntity<Omit<T, "id"> & { id: string }>;
}

export function touchLocalEntity<T extends { id: string; updatedAt?: string; version?: number }>(
  entity: T,
  syncStatus: SyncStatus = "pending_sync",
): T & Partial<LocalApiEntityMeta> {
  const now = nowIso();
  return {
    ...entity,
    updatedAt: now,
    updated_at: now,
    version: Number(entity.version ?? 1) + 1,
    sync_status: syncStatus,
  };
}

export function validationError(error: z.ZodError): ApiClientError {
  const message = error.issues[0]?.message ?? "Invalid input";
  return new ApiClientError(message, 400, { message, code: "LOCAL_VALIDATION_FAILED" });
}

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100 || 0;
}

export function readNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function removeUndefinedValues<T extends Record<string, unknown>>(input: T): T {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as T;
}
