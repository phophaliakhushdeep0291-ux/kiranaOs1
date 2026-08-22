import Dexie, { type Table } from "dexie";
import type { SyncStatus } from "@/types/domain";
import { getOfflineScope, nowIso, type OfflineScope } from "@/lib/offline/context";
import { StorageFullError, isQuotaExceededError } from "@/lib/offline/storage-errors";

export interface OfflineRow {
  id: string;
  local_id?: string;
  server_id?: string;
  tenant_id: string;
  store_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version: number;
  sync_status: SyncStatus;
  last_modified_by?: string | null;
  device_id: string;
  [key: string]: unknown;
}

export interface LocalSettingRow {
  key: string;
  value: unknown;
  tenant_id: string;
  store_id: string;
  updated_at: string;
  expires_at?: number | null;
}

export interface SyncCursorRow extends OfflineRow {
  entity_type: string;
  cursor?: string | null;
  last_pulled_at?: string | null;
}

export interface IdMappingRow {
  local_id: string;
  server_id: string;
  entity_type: string;
  tenant_id: string;
  store_id: string;
  updated_at: string;
}

export type SyncOutboxStatus =
  | "PENDING"
  | "SYNCING"
  | "SYNCED"
  | "FAILED"
  | "CONFLICT";

export interface PendingSyncEvent {
  op_id: string;
  clientEventId: string;
  type: string;
  tenant_id: string;
  store_id: string;
  device_id: string;
  entity_type: string;
  entity_id: string;
  operation_type: string;
  payload: Record<string, unknown>;
  client_created_at: string;
  status: SyncOutboxStatus;
  retry_count: number;
  idempotency_key: string;
  error_message?: string | null;
  last_attempt_at?: string | null;
  createdAt: number;
  attempts: number;
  sync_status: SyncStatus;
  next_retry_at?: string | null;
  last_error?: string | null;
  // How many times a repair sweep has re-queued this event after it failed
  // validation. Bounds the sweep↔push loop; see MAX_REPAIR_REQUEUES.
  repair_requeues?: number;
}

function isCriticalBillSyncEvent(event: PendingSyncEvent): boolean {
  const type = String(event.operation_type || event.type || "").toUpperCase();
  const entityType = String(event.entity_type || "").toLowerCase();
  return entityType === "bill" || type.includes("BILL");
}

function retryDelayForFailedEvent(event: PendingSyncEvent, retryCount: number): number {
  const attempt = Math.max(0, Math.min(retryCount - 1, 6));
  if (isCriticalBillSyncEvent(event)) {
    return Math.min(30_000, 1_000 * 2 ** attempt);
  }
  return Math.min(120_000, 2_500 * 2 ** attempt);
}

export interface OfflineWriteTransaction {
  put<T>(storeName: string, value: T): Promise<void>;
  putMany<T>(storeName: string, values: T[]): Promise<void>;
  enqueueOutboxOperation(event: PendingSyncEvent): Promise<void>;
  setSetting<T>(
    key: string,
    value: T,
    expiresAt?: number | null,
  ): Promise<void>;
}

export interface SubscriptionCacheRow extends OfflineRow {
  plan_code?: string;
  payload?: Record<string, unknown>;
}

export interface DeviceLicenseCacheRow extends OfflineRow {
  device_fingerprint?: string;
  status?: string;
  payload?: Record<string, unknown>;
}

export class KiranaDexieDB extends Dexie {
  products!: Table<OfflineRow, string>;
  customers!: Table<OfflineRow, string>;
  bills!: Table<OfflineRow, string>;
  bill_items!: Table<OfflineRow, string>;
  payments!: Table<OfflineRow, string>;
  customer_ledger!: Table<OfflineRow, string>;
  inventory_movements!: Table<OfflineRow, string>;
  suppliers!: Table<OfflineRow, string>;
  purchase_bills!: Table<OfflineRow, string>;
  expenses!: Table<OfflineRow, string>;
  settings!: Table<LocalSettingRow, string>;
  sync_outbox!: Table<PendingSyncEvent, string>;
  sync_cursor!: Table<SyncCursorRow, string>;
  sync_conflicts!: Table<OfflineRow, string>;
  id_mappings!: Table<IdMappingRow, string>;
  local_audit_logs!: Table<OfflineRow, string>;
  subscription_cache!: Table<SubscriptionCacheRow, string>;
  device_license_cache!: Table<DeviceLicenseCacheRow, string>;
  staff_users!: Table<OfflineRow, string>;

  constructor() {
    super("kirana_os_offline");

    this.version(1).stores({
      products:
        "id, local_id, server_id, [tenant_id+store_id], name, category, barcode, sku, updated_at, sync_status, deleted_at",
      customers:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, type, updated_at, sync_status, deleted_at",
      bills:
        "id, local_id, server_id, [tenant_id+store_id], billNo, billNumber, billType, status, customerId, customer_id, createdAt, created_at, updated_at, sync_status",
      bill_items:
        "id, bill_id, billId, product_id, productId, [tenant_id+store_id], created_at, sync_status",
      payments:
        "id, bill_id, billId, customer_id, customerId, mode, paid_at, created_at, sync_status",
      customer_ledger:
        "id, customer_id, customerId, [tenant_id+store_id], type, source_type, entry_at, created_at, sync_status",
      inventory_movements:
        "id, product_id, productId, type, reference_id, created_at, sync_status",
      suppliers:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, updated_at, sync_status, deleted_at",
      settings: "key, [tenant_id+store_id], updated_at, expires_at",
      sync_outbox:
        "clientEventId, type, createdAt, attempts, [tenant_id+store_id], sync_status, next_retry_at",
      sync_cursor: "id, entity_type, [tenant_id+store_id], updated_at",
      sync_conflicts:
        "id, entity_type, entity_id, [tenant_id+store_id], resolution, created_at, sync_status",
      id_mappings:
        "local_id, server_id, entity_type, [tenant_id+store_id], updated_at",
      local_audit_logs:
        "id, action, entity_type, entity_id, actor_id, created_at, [tenant_id+store_id]",
      subscription_cache:
        "id, plan_code, [tenant_id+store_id], updated_at, sync_status",
      device_license_cache:
        "id, device_fingerprint, status, [tenant_id+store_id], updated_at, sync_status",
      staff_users:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, role, isActive, active, updated_at, sync_status, deleted_at",
    });

    this.version(2)
      .stores({
        products:
          "id, local_id, server_id, [tenant_id+store_id], name, category, barcode, sku, updated_at, sync_status, deleted_at",
        customers:
          "id, local_id, server_id, [tenant_id+store_id], name, mobile, type, updated_at, sync_status, deleted_at",
        bills:
          "id, local_id, server_id, [tenant_id+store_id], billNo, billNumber, billType, status, customerId, customer_id, createdAt, created_at, updated_at, sync_status",
        bill_items:
          "id, bill_id, billId, product_id, productId, [tenant_id+store_id], created_at, sync_status",
        payments:
          "id, bill_id, billId, customer_id, customerId, mode, paid_at, created_at, sync_status",
        customer_ledger:
          "id, customer_id, customerId, [tenant_id+store_id], type, source_type, entry_at, created_at, sync_status",
        inventory_movements:
          "id, product_id, productId, type, reference_id, created_at, sync_status",
        suppliers:
          "id, local_id, server_id, [tenant_id+store_id], name, mobile, updated_at, sync_status, deleted_at",
        settings: "key, [tenant_id+store_id], updated_at, expires_at",
        sync_outbox:
          "clientEventId, op_id, type, operation_type, entity_type, entity_id, client_created_at, createdAt, attempts, retry_count, [tenant_id+store_id], status, sync_status, next_retry_at, last_attempt_at",
        sync_cursor: "id, entity_type, [tenant_id+store_id], updated_at",
        sync_conflicts:
          "id, entity_type, entity_id, [tenant_id+store_id], resolution, created_at, sync_status",
        id_mappings:
          "local_id, server_id, entity_type, [tenant_id+store_id], updated_at",
        local_audit_logs:
          "id, action, entity_type, entity_id, actor_id, created_at, [tenant_id+store_id]",
        subscription_cache:
          "id, plan_code, [tenant_id+store_id], updated_at, sync_status",
        device_license_cache:
          "id, device_fingerprint, status, [tenant_id+store_id], updated_at, sync_status",
        staff_users:
          "id, local_id, server_id, [tenant_id+store_id], name, mobile, role, isActive, active, updated_at, sync_status, deleted_at",
      })
      .upgrade(async (tx) => {
        const table = tx.table("sync_outbox") as Table<
          Record<string, unknown>,
          string
        >;
        await table.toCollection().modify((row) => {
          const scope = getOfflineScope();
          const now = nowIso();
          const clientEventId =
            typeof row.clientEventId === "string"
              ? row.clientEventId
              : getRowId(row);
          row.op_id = typeof row.op_id === "string" ? row.op_id : clientEventId;
          row.clientEventId = clientEventId;
          row.operation_type =
            typeof row.operation_type === "string"
              ? row.operation_type
              : String(row.type ?? "UNKNOWN");
          row.type =
            typeof row.type === "string"
              ? row.type
              : String(row.operation_type);
          row.entity_type =
            typeof row.entity_type === "string" ? row.entity_type : "unknown";
          row.entity_id =
            typeof row.entity_id === "string" ? row.entity_id : clientEventId;
          row.client_created_at =
            typeof row.client_created_at === "string"
              ? row.client_created_at
              : now;
          row.status = typeof row.status === "string" ? row.status : "PENDING";
          row.retry_count =
            typeof row.retry_count === "number"
              ? row.retry_count
              : Number(row.attempts ?? 0);
          row.idempotency_key =
            typeof row.idempotency_key === "string"
              ? row.idempotency_key
              : clientEventId;
          row.error_message =
            typeof row.error_message === "string" || row.error_message === null
              ? row.error_message
              : null;
          row.last_attempt_at =
            typeof row.last_attempt_at === "string" ||
            row.last_attempt_at === null
              ? row.last_attempt_at
              : null;
          row.tenant_id =
            typeof row.tenant_id === "string" ? row.tenant_id : scope.tenant_id;
          row.store_id =
            typeof row.store_id === "string" ? row.store_id : scope.store_id;
          row.device_id =
            typeof row.device_id === "string" ? row.device_id : scope.device_id;
          row.sync_status =
            typeof row.sync_status === "string"
              ? row.sync_status
              : "pending_sync";
        });
      });

    this.version(3).stores({
      products:
        "id, local_id, server_id, [tenant_id+store_id], name, category, barcode, sku, updated_at, sync_status, deleted_at",
      customers:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, type, updated_at, sync_status, deleted_at",
      bills:
        "id, local_id, server_id, [tenant_id+store_id], billNo, billNumber, billType, status, customerId, customer_id, createdAt, created_at, updated_at, sync_status",
      bill_items:
        "id, bill_id, billId, product_id, productId, [tenant_id+store_id], created_at, sync_status",
      payments:
        "id, bill_id, billId, customer_id, customerId, mode, paid_at, created_at, sync_status",
      customer_ledger:
        "id, customer_id, customerId, [tenant_id+store_id], type, source_type, entry_at, created_at, sync_status",
      inventory_movements:
        "id, product_id, productId, type, reference_id, created_at, sync_status",
      suppliers:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, updated_at, sync_status, deleted_at",
      settings: "key, [tenant_id+store_id], updated_at, expires_at",
      sync_outbox:
        "clientEventId, op_id, type, operation_type, entity_type, entity_id, client_created_at, createdAt, attempts, retry_count, [tenant_id+store_id], status, sync_status, next_retry_at, last_attempt_at",
      sync_cursor: "id, entity_type, [tenant_id+store_id], updated_at",
      sync_conflicts:
        "id, entity_type, entity_id, [tenant_id+store_id], resolution, created_at, sync_status",
      id_mappings:
        "local_id, server_id, entity_type, [tenant_id+store_id], updated_at",
      local_audit_logs:
        "id, action, entity_type, entity_id, actor_id, created_at, [tenant_id+store_id]",
      subscription_cache:
        "id, plan_code, [tenant_id+store_id], updated_at, sync_status",
      device_license_cache:
        "id, device_fingerprint, status, [tenant_id+store_id], updated_at, sync_status",
      staff_users:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, role, isActive, active, updated_at, sync_status, deleted_at",
    });

    this.version(4).stores({
      products:
        "id, local_id, server_id, [tenant_id+store_id], name, category, barcode, sku, updated_at, sync_status, deleted_at",
      customers:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, type, updated_at, sync_status, deleted_at",
      bills:
        "id, local_id, server_id, [tenant_id+store_id], billNo, billNumber, billType, status, customerId, customer_id, createdAt, created_at, updated_at, sync_status",
      bill_items:
        "id, bill_id, billId, product_id, productId, [tenant_id+store_id], created_at, sync_status",
      payments:
        "id, bill_id, billId, customer_id, customerId, mode, paid_at, created_at, [tenant_id+store_id], sync_status",
      customer_ledger:
        "id, customer_id, customerId, [tenant_id+store_id], type, source_type, entry_at, created_at, sync_status",
      inventory_movements:
        "id, product_id, productId, type, reference_id, [tenant_id+store_id], created_at, sync_status",
      suppliers:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, updated_at, sync_status, deleted_at",
      settings: "key, [tenant_id+store_id], updated_at, expires_at",
      sync_outbox:
        "clientEventId, op_id, type, operation_type, entity_type, entity_id, client_created_at, createdAt, attempts, retry_count, [tenant_id+store_id], status, sync_status, next_retry_at, last_attempt_at",
      sync_cursor: "id, entity_type, [tenant_id+store_id], updated_at",
      sync_conflicts:
        "id, entity_type, entity_id, [tenant_id+store_id], resolution, created_at, sync_status",
      id_mappings:
        "local_id, server_id, entity_type, [tenant_id+store_id], updated_at",
      local_audit_logs:
        "id, action, entity_type, entity_id, actor_id, created_at, [tenant_id+store_id]",
      subscription_cache:
        "id, plan_code, [tenant_id+store_id], updated_at, sync_status",
      device_license_cache:
        "id, device_fingerprint, status, [tenant_id+store_id], updated_at, sync_status",
      staff_users:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, role, isActive, active, updated_at, sync_status, deleted_at",
    });

    this.version(5).stores({
      products:
        "id, local_id, server_id, [tenant_id+store_id], name, category, barcode, sku, updated_at, sync_status, deleted_at",
      customers:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, type, updated_at, sync_status, deleted_at",
      bills:
        "id, local_id, server_id, [tenant_id+store_id], billNo, billNumber, billType, status, customerId, customer_id, createdAt, created_at, updated_at, sync_status",
      bill_items:
        "id, bill_id, billId, product_id, productId, [tenant_id+store_id], created_at, sync_status",
      payments:
        "id, bill_id, billId, customer_id, customerId, mode, paid_at, created_at, [tenant_id+store_id], sync_status",
      customer_ledger:
        "id, customer_id, customerId, [tenant_id+store_id], type, source_type, entry_at, created_at, sync_status",
      inventory_movements:
        "id, product_id, productId, type, reference_id, [tenant_id+store_id], created_at, sync_status",
      suppliers:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, updated_at, sync_status, deleted_at",
      purchase_bills:
        "id, local_id, server_id, [tenant_id+store_id], supplierId, supplier_id, invoiceNumber, invoice_number, status, dueDate, due_date, created_at, sync_status, deleted_at",
      settings: "key, [tenant_id+store_id], updated_at, expires_at",
      sync_outbox:
        "clientEventId, op_id, type, operation_type, entity_type, entity_id, client_created_at, createdAt, attempts, retry_count, [tenant_id+store_id], status, sync_status, next_retry_at, last_attempt_at",
      sync_cursor: "id, entity_type, [tenant_id+store_id], updated_at",
      sync_conflicts:
        "id, entity_type, entity_id, [tenant_id+store_id], resolution, created_at, sync_status",
      id_mappings:
        "local_id, server_id, entity_type, [tenant_id+store_id], updated_at",
      local_audit_logs:
        "id, action, entity_type, entity_id, actor_id, created_at, [tenant_id+store_id]",
      subscription_cache:
        "id, plan_code, [tenant_id+store_id], updated_at, sync_status",
      device_license_cache:
        "id, device_fingerprint, status, [tenant_id+store_id], updated_at, sync_status",
      staff_users:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, role, isActive, active, updated_at, sync_status, deleted_at",
    });

    this.version(6).stores({
      products:
        "id, local_id, server_id, [tenant_id+store_id], name, category, barcode, sku, updated_at, sync_status, deleted_at",
      customers:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, type, updated_at, sync_status, deleted_at",
      bills:
        "id, local_id, server_id, [tenant_id+store_id], billNo, billNumber, billType, status, customerId, customer_id, createdAt, created_at, updated_at, sync_status",
      bill_items:
        "id, bill_id, billId, product_id, productId, [tenant_id+store_id], created_at, sync_status",
      payments:
        "id, bill_id, billId, customer_id, customerId, mode, paid_at, created_at, [tenant_id+store_id], sync_status",
      customer_ledger:
        "id, customer_id, customerId, [tenant_id+store_id], type, source_type, entry_at, created_at, sync_status",
      inventory_movements:
        "id, product_id, productId, type, reference_id, [tenant_id+store_id], created_at, sync_status",
      suppliers:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, updated_at, sync_status, deleted_at",
      purchase_bills:
        "id, local_id, server_id, [tenant_id+store_id], supplierId, supplier_id, invoiceNumber, invoice_number, status, dueDate, due_date, created_at, sync_status, deleted_at",
      expenses:
        "id, local_id, server_id, [tenant_id+store_id], category, paymentMode, status, spentAt, created_at, updated_at, sync_status, deleted_at",
      settings: "key, [tenant_id+store_id], updated_at, expires_at",
      sync_outbox:
        "clientEventId, op_id, type, operation_type, entity_type, entity_id, client_created_at, createdAt, attempts, retry_count, [tenant_id+store_id], status, sync_status, next_retry_at, last_attempt_at",
      sync_cursor: "id, entity_type, [tenant_id+store_id], updated_at",
      sync_conflicts:
        "id, entity_type, entity_id, [tenant_id+store_id], resolution, created_at, sync_status",
      id_mappings:
        "local_id, server_id, entity_type, [tenant_id+store_id], updated_at",
      local_audit_logs:
        "id, action, entity_type, entity_id, actor_id, created_at, [tenant_id+store_id]",
      subscription_cache:
        "id, plan_code, [tenant_id+store_id], updated_at, sync_status",
      device_license_cache:
        "id, device_fingerprint, status, [tenant_id+store_id], updated_at, sync_status",
      staff_users:
        "id, local_id, server_id, [tenant_id+store_id], name, mobile, role, isActive, active, updated_at, sync_status, deleted_at",
    });
  }
}

export const dexieDB = new KiranaDexieDB();

const BUSINESS_TABLES = new Set([
  "products",
  "customers",
  "bills",
  "bill_items",
  "payments",
  "customer_ledger",
  "inventory_movements",
  "suppliers",
  "purchase_bills",
  "expenses",
  "sync_conflicts",
  "local_audit_logs",
  "subscription_cache",
  "device_license_cache",
  "staff_users",
]);

const SCOPED_TABLES = new Set([
  ...BUSINESS_TABLES,
  "settings",
  "sync_outbox",
  "sync_cursor",
  "sync_conflicts",
  "id_mappings",
]);

export function isScopedTableName(storeName: string): boolean {
  return SCOPED_TABLES.has(storeName);
}

export function rowMatchesCurrentScope(row: unknown): boolean {
  if (!isRecord(row)) return false;
  const scope = getOfflineScope();
  return row.tenant_id === scope.tenant_id && row.store_id === scope.store_id;
}

export function filterRowsForCurrentScope<T>(rows: T[]): T[] {
  return rows.filter((row) => rowMatchesCurrentScope(row));
}

function isScopedRecord<T>(row: T): boolean {
  return rowMatchesCurrentScope(row);
}

function isOutboxPendingOrRetryable(event: PendingSyncEvent): boolean {
  return (
    event.status === "PENDING" ||
    event.status === "FAILED" ||
    event.status === "CONFLICT" ||
    event.sync_status === "pending_sync" ||
    event.sync_status === "failed" ||
    event.sync_status === "conflict"
  );
}

export const MAX_AUTOMATIC_RETRY_ATTEMPTS = 12;

function isOutboxPendingNow(
  event: PendingSyncEvent,
  now = Date.now(),
): boolean {
  const isPending =
    event.status === "PENDING" || event.sync_status === "pending_sync";
  const isRetryableFailed =
    event.status === "FAILED" || event.sync_status === "failed";
  if (isPending) return true;
  if (!isRetryableFailed) return false;
  if ((event.retry_count ?? event.attempts ?? 0) >= MAX_AUTOMATIC_RETRY_ATTEMPTS) return false;
  if (!event.next_retry_at) return true;
  const retryAt = new Date(event.next_retry_at).getTime();
  return !Number.isFinite(retryAt) || retryAt <= now;
}


function emitSyncQueueUpdated(detail?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated", { detail }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Credentials that authorise one action and must not outlive it on the device.
 *
 * The owner PIN gates every catalogue and stock change, so it travels in the outbox
 * payload — it has to, because an op queued offline still needs it whenever the push
 * finally happens. What it must NOT do is stay there afterwards: a settled op keeps no
 * secret worth holding, and the PIN was sitting in IndexedDB in the clear for every
 * gated action a shop had ever performed, readable by anything that reaches the store.
 */
const OWNER_SECRET_PAYLOAD_KEYS = new Set(["ownerPin", "ownerPassword", "password", "pin"]);

/**
 * How long a CONFLICT keeps its credentials before they are cleared too.
 *
 * A conflict is not finished the way a SYNCED op is: `sync-status-repair` rescues some
 * of them by putting the event back to PENDING, and the re-push is built from THIS
 * stored payload — so stripping the PIN the moment a conflict appears would re-send a
 * bill cancellation with no owner approval on it. Those repairs run at boot and are
 * capped at MAX_REPAIR_REQUEUES, so a conflict still sitting here days later is one no
 * repair will ever collect.
 *
 * Time rather than a list of "repairable" op types on purpose: that list lives in the
 * sync feature, which imports this module, and duplicating it here would leave the copy
 * to rot silently — the day someone taught repair a new trick, the credential it needed
 * would already have been deleted. Waiting costs a few days of exposure on a rare row
 * and cannot break a legitimate retry.
 */
const CONFLICT_SECRET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function isStaleConflict(row: PendingSyncEvent, before: number): boolean {
  const stamp = row.last_attempt_at ?? row.client_created_at ?? row.createdAt;
  const at = stamp ? new Date(stamp).getTime() : Number.NaN;
  // An unreadable or missing timestamp is treated as old: the row cannot be shown to be
  // within the retention window, and keeping a credential on that basis is the worse bet.
  return !Number.isFinite(at) || at <= before;
}

/**
 * Strip those keys, returning `null` when there was nothing to strip so callers can
 * skip a pointless write. Recursive because a payload nests the entity it carries.
 */
export function withoutOwnerSecrets(value: unknown): unknown | null {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const scrubbed = withoutOwnerSecrets(item);
      if (scrubbed === null) return item;
      changed = true;
      return scrubbed;
    });
    return changed ? next : null;
  }
  if (!isRecord(value)) return null;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (OWNER_SECRET_PAYLOAD_KEYS.has(key)) {
      changed = true;
      continue;
    }
    const scrubbed = withoutOwnerSecrets(child);
    if (scrubbed === null) {
      next[key] = child;
      continue;
    }
    changed = true;
    next[key] = scrubbed;
  }
  return changed ? next : null;
}

function getRowId(value: unknown): string {
  if (!isRecord(value))
    return `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const id = value.id ?? value.local_id ?? value.localId ?? value.clientEventId;
  return typeof id === "string" && id.length > 0
    ? id
    : `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function isSyncedBusinessRow(row: Record<string, unknown>): boolean {
  if (typeof row.isSynced === "boolean") return row.isSynced;
  if (typeof row.is_synced === "boolean") return row.is_synced;
  const syncStatus = String(row.sync_status ?? "").toLowerCase();
  const status = String(row.status ?? "").toLowerCase();
  return !["local_only", "pending_sync", "syncing", "failed", "conflict", "draft"].includes(syncStatus || status);
}

function withBillSyncFlagForStore<T>(storeName: string, row: T): T {
  if (storeName !== "bills" || !isRecord(row)) return row;
  const isSynced = isSyncedBusinessRow(row);
  return {
    ...row,
    isSynced,
    is_synced: isSynced,
  } as T;
}

function withBusinessMetadata<T>(
  value: T,
  syncStatus: SyncStatus = "synced",
): T & OfflineRow {
  const scope = getOfflineScope();
  const now = nowIso();
  const raw: Record<string, unknown> = isRecord(value) ? value : {};
  const id = getRowId(raw);
  const created = raw.created_at ?? raw.createdAt ?? now;
  const updated = raw.updated_at ?? raw.updatedAt ?? now;

  return {
    ...raw,
    id,
    tenant_id:
      typeof raw.tenant_id === "string" ? raw.tenant_id : scope.tenant_id,
    store_id: typeof raw.store_id === "string" ? raw.store_id : scope.store_id,
    created_at: typeof created === "string" ? created : now,
    updated_at: typeof updated === "string" ? updated : now,
    deleted_at:
      typeof raw.deleted_at === "string" || raw.deleted_at === null
        ? (raw.deleted_at as string | null)
        : null,
    version: typeof raw.version === "number" ? raw.version : 1,
    sync_status:
      typeof raw.sync_status === "string"
        ? (raw.sync_status as SyncStatus)
        : syncStatus,
    last_modified_by:
      typeof raw.last_modified_by === "string" || raw.last_modified_by === null
        ? (raw.last_modified_by as string | null)
        : null,
    device_id:
      typeof raw.device_id === "string" ? raw.device_id : scope.device_id,
  } as T & OfflineRow;
}

class OfflineDBFacade {
  async init(): Promise<void> {
    await dexieDB.open();
  }

  private table<T>(name: string): Table<T, string> {
    return dexieDB.table(name) as Table<T, string>;
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    await this.init();
    const table = this.table<T>(storeName);
    if (!isScopedTableName(storeName)) return table.toArray();
    const scope = getOfflineScope();
    return table
      .where("[tenant_id+store_id]")
      .equals([scope.tenant_id, scope.store_id])
      .toArray()
      .catch(() => table.filter(isScopedRecord).toArray());
  }

  async put<T>(storeName: string, value: T): Promise<void> {
    await this.init();
    if (storeName === "settings") {
      await this.table<LocalSettingRow>(storeName).put(
        value as LocalSettingRow,
      );
      return;
    }
    const row = BUSINESS_TABLES.has(storeName)
      ? withBillSyncFlagForStore(storeName, withBusinessMetadata(value))
      : value;
    await this.table<T>(storeName).put(row as T);
  }

  async putMany<T>(storeName: string, values: T[]): Promise<void> {
    await this.init();
    if (values.length === 0) return;
    const rows = BUSINESS_TABLES.has(storeName)
      ? values.map((value) => withBillSyncFlagForStore(storeName, withBusinessMetadata(value)))
      : values;
    await this.table<T>(storeName).bulkPut(rows as T[]);
  }

  async transaction<T>(
    storeNames: string[],
    callback: (tx: OfflineWriteTransaction) => Promise<T>,
  ): Promise<T> {
    await this.init();
    const tables = Array.from(new Set(storeNames)).map((name) =>
      this.table(name),
    );
    const outboxEvents: PendingSyncEvent[] = [];
    const runTransaction = () => dexieDB.transaction("rw", tables, async () => {
      const tx: OfflineWriteTransaction = {
        put: async <Row>(storeName: string, value: Row) => {
          if (storeName === "settings") {
            await this.table<LocalSettingRow>(storeName).put(
              value as LocalSettingRow,
            );
            return;
          }
          const row = BUSINESS_TABLES.has(storeName)
            ? withBillSyncFlagForStore(storeName, withBusinessMetadata(value))
            : value;
          await this.table<Row>(storeName).put(row as Row);
        },
        putMany: async <Row>(storeName: string, values: Row[]) => {
          if (values.length === 0) return;
          const rows = BUSINESS_TABLES.has(storeName)
            ? values.map((value) => withBillSyncFlagForStore(storeName, withBusinessMetadata(value)))
            : values;
          await this.table<Row>(storeName).bulkPut(rows as Row[]);
        },
        enqueueOutboxOperation: async (event: PendingSyncEvent) => {
          await this.table<PendingSyncEvent>("sync_outbox").put(event);
          outboxEvents.push(event);
        },
        setSetting: async <Value>(
          key: string,
          value: Value,
          expiresAt?: number | null,
        ) => {
          const scope = getOfflineScope();
          await this.table<LocalSettingRow>("settings").put({
            key,
            value,
            tenant_id: scope.tenant_id,
            store_id: scope.store_id,
            updated_at: nowIso(),
            expires_at: expiresAt ?? null,
          });
        },
      };
      return callback(tx);
    });

    let result: T;
    try {
      result = await runTransaction();
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error;
      // Storage is full: free the safely-prunable history (terminal-success sync rows,
      // expired caches) and retry ONCE — a busy shop usually has megabytes of it. If the
      // retry still can't fit, tell the user what actually happened instead of a generic
      // "could not save".
      outboxEvents.length = 0;
      await this.pruneSyncedHistory().catch(() => undefined);
      await this.pruneExpiredRecentCache().catch(() => undefined);
      try {
        result = await runTransaction();
      } catch (retryError) {
        if (isQuotaExceededError(retryError)) throw new StorageFullError();
        throw retryError;
      }
    }

    for (const event of outboxEvents) {
      emitSyncQueueUpdated({
        clientEventId: event.clientEventId,
        op_id: event.op_id,
        type: event.type,
        action: "enqueued",
      });
    }
    return result;
  }

  async delete(storeName: string, key: string): Promise<void> {
    await this.init();
    await this.table(storeName).delete(key);
  }

  /**
   * Delete every current-scope row from each of the given stores. Resolves each
   * store's real primary key from the Dexie schema (`schema.primKey.keyPath`)
   * instead of guessing a field, so a SYNCED row — whose `id` is the server id but
   * whose `local_id` is the original local id — is actually removed. A guessed
   * `local_id` key never matched the `id` keyPath, which is why "Delete local
   * offline data" left synced customers/bills/ledger rows behind.
   */
  async clearScopedData(storeNames: string[], scopeOverride?: Pick<OfflineScope, "tenant_id" | "store_id">): Promise<void> {
    await this.init();
    const scope = scopeOverride ?? getOfflineScope();
    for (const storeName of storeNames) {
      const table = this.table<Record<string, unknown>>(storeName);
      const keyPath = table.schema.primKey.keyPath;
      if (typeof keyPath !== "string") continue;
      const rows = isScopedTableName(storeName)
        ? await table.where("[tenant_id+store_id]").equals([scope.tenant_id, scope.store_id]).toArray()
          .catch(() => table.filter((row) => row.tenant_id === scope.tenant_id && row.store_id === scope.store_id).toArray())
        : await table.toArray();
      const keys = rows
        .map((row) => row[keyPath])
        .filter((key): key is string => typeof key === "string" && key.length > 0);
      if (keys.length > 0) await table.bulkDelete(keys);
    }
  }

  async clearAllData(): Promise<void> {
    await this.init();
    await dexieDB.transaction("rw", dexieDB.tables, async () => {
      await Promise.all(dexieDB.tables.map((table) => table.clear()));
    });
  }

  async enqueueSyncEvent(
    event: Pick<PendingSyncEvent, "clientEventId" | "type" | "payload"> &
      Partial<PendingSyncEvent>,
  ): Promise<void> {
    const scope = getOfflineScope();
    const now = nowIso();
    const row: PendingSyncEvent = {
      op_id: event.op_id ?? event.clientEventId,
      clientEventId: event.clientEventId,
      type: event.type,
      tenant_id: event.tenant_id ?? scope.tenant_id,
      store_id: event.store_id ?? scope.store_id,
      device_id: event.device_id ?? scope.device_id,
      entity_type: event.entity_type ?? "unknown",
      entity_id: event.entity_id ?? event.clientEventId,
      operation_type: event.operation_type ?? event.type,
      payload: event.payload,
      client_created_at: event.client_created_at ?? now,
      status: event.status ?? "PENDING",
      retry_count: event.retry_count ?? event.attempts ?? 0,
      idempotency_key: event.idempotency_key ?? event.clientEventId,
      error_message: event.error_message ?? event.last_error ?? null,
      last_attempt_at: event.last_attempt_at ?? null,
      createdAt: event.createdAt ?? Date.now(),
      attempts: event.attempts ?? event.retry_count ?? 0,
      sync_status: event.sync_status ?? "pending_sync",
      next_retry_at: event.next_retry_at ?? null,
      last_error: event.last_error ?? event.error_message ?? null,
    };
    await this.enqueueOutboxOperation(row);
  }

  async enqueueOutboxOperation(event: PendingSyncEvent): Promise<void> {
    await this.init();
    await this.table<PendingSyncEvent>("sync_outbox").put(event);
    emitSyncQueueUpdated({
      clientEventId: event.clientEventId,
      op_id: event.op_id,
      type: event.type,
      action: "enqueued",
    });
  }

  async getPendingEvents(): Promise<PendingSyncEvent[]> {
    await this.init();
    const now = Date.now();
    const scope = getOfflineScope();
    return dexieDB.sync_outbox
      .where("[tenant_id+store_id]")
      .equals([scope.tenant_id, scope.store_id])
      .filter((event) => isOutboxPendingNow(event, now))
      .sortBy("createdAt");
  }

  async getPendingCount(): Promise<number> {
    await this.init();
    const scope = getOfflineScope();
    return dexieDB.sync_outbox
      .where("[tenant_id+store_id]")
      .equals([scope.tenant_id, scope.store_id])
      .filter(isOutboxPendingOrRetryable)
      .count();
  }

  async updatePendingEventStatus(
    clientEventIds: string[],
    status: SyncOutboxStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.init();
    if (clientEventIds.length === 0) return;
    const now = nowIso();
    let changed = 0;
    await dexieDB.transaction("rw", dexieDB.sync_outbox, async () => {
      for (const id of clientEventIds) {
        const row = await dexieDB.sync_outbox.get(id);
        if (!row || !rowMatchesCurrentScope(row)) continue;
        const retryCount =
          status === "FAILED" ? row.retry_count + 1 : row.retry_count;
        const retryDelayMs =
          status === "FAILED"
            ? retryDelayForFailedEvent(row, retryCount)
            : 0;
        // Only on SYNCED. A FAILED op is retried from this very payload, so the PIN has
        // to survive until the push actually lands; a CONFLICT may still be re-pushed by
        // resolution. Once it is synced the authorisation is spent.
        const scrubbedPayload = status === "SYNCED" ? withoutOwnerSecrets(row.payload) : null;
        await dexieDB.sync_outbox.put({
          ...row,
          ...(isRecord(scrubbedPayload) ? { payload: scrubbedPayload } : {}),
          status,
          sync_status:
            status === "SYNCING"
              ? "syncing"
              : status === "SYNCED"
                ? "synced"
                : status === "FAILED"
                  ? "failed"
                  : status === "CONFLICT"
                    ? "conflict"
                    : row.sync_status,
          retry_count: retryCount,
          attempts: retryCount,
          error_message: status === "SYNCED" ? null : (errorMessage ?? null),
          last_error: status === "SYNCED" ? null : (errorMessage ?? null),
          last_attempt_at: now,
          next_retry_at:
            status === "FAILED"
              ? new Date(Date.now() + retryDelayMs).toISOString()
              : null,
        });
        changed += 1;
      }
    });
    if (changed > 0) emitSyncQueueUpdated({ action: "status_changed", status, count: changed });
  }

  /**
   * Clear owner credentials out of ops that already settled before we started scrubbing.
   *
   * Scrubbing on SYNCED only helps ops that settle from now on. Every device already
   * carries the PIN in the clear for every gated action in its history, and those rows
   * are never written again, so nothing would ever clean them. Runs on boot; touches
   * only settled rows, so an op still waiting to push keeps what it needs to push with.
   */
  async scrubSettledOutboxSecrets(): Promise<number> {
    await this.init();
    const staleConflictBefore = Date.now() - CONFLICT_SECRET_RETENTION_MS;
    let scrubbed = 0;
    await dexieDB.transaction("rw", dexieDB.sync_outbox, async () => {
      const rows = await dexieDB.sync_outbox
        .where("status")
        .anyOf(["SYNCED", "CONFLICT"])
        .toArray();
      for (const row of rows) {
        if (!rowMatchesCurrentScope(row)) continue;
        if (row.status === "CONFLICT" && !isStaleConflict(row, staleConflictBefore)) continue;
        const payload = withoutOwnerSecrets(row.payload);
        if (!isRecord(payload)) continue;
        await dexieDB.sync_outbox.put({ ...row, payload });
        scrubbed += 1;
      }
    });
    return scrubbed;
  }

  async removePendingEvent(clientEventId: string): Promise<void> {
    await this.init();
    const existing = await dexieDB.sync_outbox.get(clientEventId);
    let removed = 0;
    if (existing && rowMatchesCurrentScope(existing)) {
      await dexieDB.sync_outbox.delete(clientEventId);
      removed += 1;
    }
    const matchingRows = await dexieDB.sync_outbox
      .where("op_id")
      .equals(clientEventId)
      .filter(rowMatchesCurrentScope)
      .toArray();
    if (matchingRows.length > 0) {
      await dexieDB.sync_outbox.bulkDelete(
        matchingRows.map((row) => row.clientEventId),
      );
      removed += matchingRows.length;
    }
    if (removed > 0) emitSyncQueueUpdated({ action: "removed", clientEventId, count: removed });
  }

  async getSetting<T = string>(key: string): Promise<T | null> {
    await this.init();
    const row = await dexieDB.settings.get(key);
    if (
      !row ||
      !rowMatchesCurrentScope(row) ||
      (row.expires_at && row.expires_at < Date.now())
    )
      return null;
    return row.value as T;
  }

  async setSetting<T>(
    key: string,
    value: T,
    expiresAt?: number | null,
  ): Promise<void> {
    const scope = getOfflineScope();
    await this.init();
    await dexieDB.settings.put({
      key,
      value,
      tenant_id: scope.tenant_id,
      store_id: scope.store_id,
      updated_at: nowIso(),
      expires_at: expiresAt ?? null,
    });
  }

  async getRecentCache<T>(key: string, fallback: T): Promise<T> {
    const value = await this.getSetting<T>(`cache:${key}`);
    return value ?? fallback;
  }

  async putRecentCache<T>(key: string, value: T, days = 30): Promise<void> {
    await this.setSetting(
      `cache:${key}`,
      value,
      Date.now() + days * 24 * 60 * 60 * 1000,
    );
  }

  async pruneExpiredRecentCache(): Promise<void> {
    await this.init();
    const now = Date.now();
    const expiredRows = await dexieDB.settings
      .where("expires_at")
      .below(now)
      .filter(rowMatchesCurrentScope)
      .toArray();
    if (expiredRows.length > 0)
      await dexieDB.settings.bulkDelete(expiredRows.map((row) => row.key));
  }

  async pruneStoreOlderThan(
    storeName: string,
    days = 30,
    dateField = "createdAt",
  ): Promise<void> {
    await this.init();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const table = dexieDB.table(storeName) as Table<
      Record<string, unknown>,
      string
    >;
    const keys: string[] = [];
    await table
      .filter(
        (row) => !isScopedTableName(storeName) || rowMatchesCurrentScope(row),
      )
      .each((row, cursor) => {
        const rawDate = row[dateField] ?? row.created_at ?? row.updated_at;
        const time = rawDate ? new Date(String(rawDate)).getTime() : NaN;
        if (Number.isFinite(time) && time < cutoff)
          keys.push(String(cursor.primaryKey));
      });
    if (keys.length > 0) await table.bulkDelete(keys);
  }

  /**
   * Terminal-success sync history and old local audit copies grow without bound on a
   * busy shop (every bill enqueues several outbox ops + audit rows that are kept after
   * syncing). Prune SYNCED outbox rows past `outboxDays`; PENDING/SYNCING/FAILED/
   * CONFLICT rows are retryable state and are never touched. Local audit rows are
   * capped at `auditDays` — they push to the server through their own outbox ops, so
   * the authoritative trail lives there.
   */
  async pruneSyncedHistory(outboxDays = 30, auditDays = 90): Promise<void> {
    await this.init();
    const cutoff = Date.now() - outboxDays * 24 * 60 * 60 * 1000;
    const doneKeys: string[] = [];
    await dexieDB.sync_outbox
      .filter(rowMatchesCurrentScope)
      .each((row, cursor) => {
        const record = row as unknown as Record<string, unknown>;
        const done = record.status === "SYNCED" || record.sync_status === "synced";
        const raw = record.createdAt ?? record.client_created_at ?? record.created_at;
        const time = typeof raw === "number" ? raw : new Date(String(raw ?? "")).getTime();
        if (done && Number.isFinite(time) && time < cutoff)
          doneKeys.push(String(cursor.primaryKey));
      });
    if (doneKeys.length > 0) await dexieDB.sync_outbox.bulkDelete(doneKeys);
    await this.pruneStoreOlderThan("local_audit_logs", auditDays);
  }

  async getIdMap(): Promise<Record<string, string>> {
    await this.init();
    const scope = getOfflineScope();
    const rows = await dexieDB.id_mappings
      .where("[tenant_id+store_id]")
      .equals([scope.tenant_id, scope.store_id])
      .toArray();
    return Object.fromEntries(rows.map((row) => [row.local_id, row.server_id]));
  }

  async putIdMappings(
    map: Record<string, string>,
    entityType = "unknown",
  ): Promise<void> {
    await this.init();
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
  }
}

export const offlineDB = new OfflineDBFacade();
