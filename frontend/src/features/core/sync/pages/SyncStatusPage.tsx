import { useCallback, useEffect, useMemo, useState } from "react";
import { SyncDiagnosticsSection } from "./SyncDiagnosticsSection";
import { formatDistanceToNow } from "date-fns";
import { hi as hiDateLocale } from "date-fns/locale";
import {
  AlertCircle,
  Cloud,
  CloudOff,
  Database,
  Loader2,
  ExternalLink,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { ApiClientError, getApiBaseUrl, setApiBaseUrl } from "@/lib/api/http";
import { displayDeviceName } from "@/lib/device-identity";
import { probeBackendConnection, readBackendConnectionSnapshot } from "@/features/core/sync/backend-health";
import {
  dexieDB,
  offlineDB,
  type OfflineRow,
  type PendingSyncEvent,
  type SyncCursorRow,
} from "@/lib/offline/db";
import { getOfflineScope } from "@/lib/offline/context";
import {
  getSyncStatus,
  getSyncFleet,
  listSyncConflicts,
  reportSyncConflict,
  resolveSyncConflict,
  retryFailedSyncOperations,
  runSyncCycle,
} from "@/features/core/sync";
import { getCurrentSubscriptionSnapshot } from "@/features/core/subscription/access";
import type { SyncConflictRecord, SyncFleetResponse, SyncStatusResponse } from "@/types/api";
import { repairResolvedSyncStatusNoise, retryableStoredGuestBillConflict } from "@/features/core/sync/sync-status-repair";
import { tableNameForEntity } from "@/features/core/sync/sync-types";
import { isSensitiveSyncKey, sanitizeSyncDiagnostic } from "@/features/core/sync/sensitive-data";
import { PageHeader, PageShell, StatCard, StatsGrid, SyncBadge } from "@/components/shared";
import { useAppLanguage, type Translate, type TranslationKey } from "@/features/core/settings/i18n";

/**
 * What this page's pure helpers need to speak the owner's language. The context
 * object returned by useAppLanguage satisfies it structurally, so a component can
 * pass itself straight through.
 */
type Loc = { t: Translate; language: string };

interface ConflictRow extends OfflineRow {
  entity_type?: string;
  entity_id?: string;
  resolution?: string;
  error_message?: string;
  local_snapshot?: unknown;
  server_snapshot?: unknown;
  server_conflict_id?: string;
  server_record_version?: number;
  server_version?: string | number | null;
}

interface SyncStatusSnapshot {
  isOnline: boolean;
  isBrowserOnline: boolean;
  isBackendReachable: boolean;
  backendError: string | null;
  isLoading: boolean;
  isSyncing: boolean;
  pendingOperations: PendingSyncEvent[];
  failedOperations: PendingSyncEvent[];
  conflicts: ConflictRow[];
  lastSuccessfulSyncAt: string | null;
  deviceId: string;
  apiBaseUrl: string;
  subscriptionSyncAllowed: boolean | null;
  serverStatus: SyncStatusResponse | null;
  fleet: SyncFleetResponse | null;
  localBusinessRowsCount: number;
}

const initialSnapshot: SyncStatusSnapshot = {
  isOnline: readBackendConnectionSnapshot().browserOnline && readBackendConnectionSnapshot().backendReachable,
  isBrowserOnline: readBackendConnectionSnapshot().browserOnline,
  isBackendReachable: readBackendConnectionSnapshot().backendReachable,
  backendError: readBackendConnectionSnapshot().error ?? null,
  isLoading: true,
  isSyncing: false,
  pendingOperations: [],
  failedOperations: [],
  conflicts: [],
  lastSuccessfulSyncAt: null,
  deviceId: getOfflineScope().device_id,
  apiBaseUrl: getApiBaseUrl(),
  subscriptionSyncAllowed: null,
  serverStatus: null,
  fleet: null,
  localBusinessRowsCount: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A queued change is stored under a machine key ("UPDATE_PRODUCT"), so a name the
 * owner can read needs a table rather than a string transform. A type missing from
 * it falls back to the humanised English — a new sync event must never surface as a
 * raw dictionary key on the one screen people open when something is already wrong.
 */
const OPERATION_NAME_KEYS: Record<string, TranslationKey> = {
  CREATE_CUSTOMER: "sync.op.CREATE_CUSTOMER",
  UPDATE_CUSTOMER: "sync.op.UPDATE_CUSTOMER",
  DELETE_CUSTOMER_PENDING: "sync.op.DELETE_CUSTOMER_PENDING",
  CREATE_PRODUCT: "sync.op.CREATE_PRODUCT",
  UPDATE_PRODUCT: "sync.op.UPDATE_PRODUCT",
  BIND_PRODUCT_BARCODE: "sync.op.BIND_PRODUCT_BARCODE",
  DELETE_PRODUCT_PENDING: "sync.op.DELETE_PRODUCT_PENDING",
  CREATE_BILL: "sync.op.CREATE_BILL",
  CREATE_SALE_RETURN: "sync.op.CREATE_SALE_RETURN",
  CANCEL_BILL_PENDING: "sync.op.CANCEL_BILL_PENDING",
  SOFT_DELETE_BILL_PENDING: "sync.op.SOFT_DELETE_BILL_PENDING",
  RESTORE_BILL_PENDING: "sync.op.RESTORE_BILL_PENDING",
  RECORD_PAYMENT: "sync.op.RECORD_PAYMENT",
  REVERSE_PAYMENT: "sync.op.REVERSE_PAYMENT",
  CREATE_LEDGER_ADJUSTMENT: "sync.op.CREATE_LEDGER_ADJUSTMENT",
  STOCK_PURCHASE: "sync.op.STOCK_PURCHASE",
  STOCK_PURCHASE_BATCH: "sync.op.STOCK_PURCHASE_BATCH",
  STOCK_SALE: "sync.op.STOCK_SALE",
  STOCK_DAMAGE: "sync.op.STOCK_DAMAGE",
  STOCK_CORRECTION: "sync.op.STOCK_CORRECTION",
  UPDATE_PURCHASE_BILL: "sync.op.UPDATE_PURCHASE_BILL",
  DELETE_PURCHASE_BILL: "sync.op.DELETE_PURCHASE_BILL",
  RECORD_SUPPLIER_PAYMENT: "sync.op.RECORD_SUPPLIER_PAYMENT",
  REVERSE_SUPPLIER_PAYMENT: "sync.op.REVERSE_SUPPLIER_PAYMENT",
  CREATE_SUPPLIER: "sync.op.CREATE_SUPPLIER",
  UPDATE_SUPPLIER: "sync.op.UPDATE_SUPPLIER",
  DELETE_SUPPLIER_PENDING: "sync.op.DELETE_SUPPLIER_PENDING",
  UPDATE_SETTINGS: "sync.op.UPDATE_SETTINGS",
  STAFF_ACTION: "sync.op.STAFF_ACTION",
  SUBSCRIPTION_REFRESH: "sync.op.SUBSCRIPTION_REFRESH",
  DEVICE_ADD_PENDING: "sync.op.DEVICE_ADD_PENDING",
  DEVICE_REMOVE_PENDING: "sync.op.DEVICE_REMOVE_PENDING",
  AUDIT_LOG_APPEND: "sync.op.AUDIT_LOG_APPEND",
  RESTORE_CUSTOMER_PENDING: "sync.op.RESTORE_CUSTOMER_PENDING",
  RESTORE_PRODUCT_PENDING: "sync.op.RESTORE_PRODUCT_PENDING",
  RESTORE_SUPPLIER_PENDING: "sync.op.RESTORE_SUPPLIER_PENDING",
  CREATE_EXPENSE: "sync.op.CREATE_EXPENSE",
  UPDATE_EXPENSE: "sync.op.UPDATE_EXPENSE",
  DELETE_EXPENSE: "sync.op.DELETE_EXPENSE",
};

function getSimpleOperationName(t: Translate, operationType: string) {
  const key = OPERATION_NAME_KEYS[operationType];
  if (key) return t(key);
  const normalized = operationType.replace(/_/g, " ").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getFriendlyFailureMessage(t: Translate, operation: PendingSyncEvent) {
  if (!operation.error_message && !operation.last_error)
    return t("sync.failure.generic");
  if (!navigator.onLine)
    return t("sync.failure.offline");
  return t("sync.failure.retryNeeded");
}

function formatTimeAgo(loc: Loc, value: string | null) {
  if (!value) return loc.t("sync.time.never");
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return loc.t("sync.time.unavailable");
  // date-fns writes the relative part itself, so without its Hindi locale the one
  // number on the card ("2 hours ago") stays English inside a Hindi sentence.
  return formatDistanceToNow(new Date(time), {
    addSuffix: true,
    ...(loc.language === "hi" ? { locale: hiDateLocale } : {}),
  });
}

function safeString(value: unknown, fallback = "-") {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function compactJson(value: unknown) {
  try {
    return JSON.stringify(sanitizeSyncDiagnostic(value), null, 2);
  } catch {
    return String(value);
  }
}

function readStringFromRecord(record: unknown, keys: string[]): string | null {
  if (!isRecord(record)) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function readNumberFromRecord(record: unknown, keys: string[]): number | null {
  if (!isRecord(record)) return null;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function moneyLabel(value: number | null): string | null {
  if (value == null) return null;
  return `Rs ${Math.abs(value).toLocaleString("en-IN")}`;
}

function mergeServerConflictRows(
  localRows: ConflictRow[],
  serverRows: SyncConflictRecord[],
): ConflictRow[] {
  const scope = getOfflineScope();
  const sourceEventIds = new Set(
    serverRows
      .map((row) => row.source_event_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const serverIdentity = (row: SyncConflictRecord) => {
    const explicitSource = typeof row.source_event_id === "string" && row.source_event_id.length > 0
      ? row.source_event_id
      : null;
    const linkedSource = explicitSource
      ?? (typeof row.server_version === "string" && sourceEventIds.has(row.server_version)
        ? row.server_version
        : null);
    if (linkedSource) return `source:${linkedSource}`;
    if (row.client_conflict_id) return `client:${row.client_conflict_id}`;
    return `server:${row.id}`;
  };
  const canonicalServerRows = new Map<string, SyncConflictRecord>();
  for (const row of serverRows) {
    const identity = serverIdentity(row);
    const current = canonicalServerRows.get(identity);
    const rowIsAuthoritative = typeof row.source_event_id === "string" && row.source_event_id.length > 0;
    const currentIsAuthoritative = typeof current?.source_event_id === "string" && current.source_event_id.length > 0;
    if (!current || (rowIsAuthoritative && !currentIsAuthoritative)) {
      canonicalServerRows.set(identity, row);
    }
  }

  const byIdentity = new Map<string, ConflictRow>();
  for (const row of localRows) {
    const explicitSource = readStringFromRecord(row, ["source_event_id"]);
    const linkedSource = explicitSource
      ?? (typeof row.server_version === "string" && sourceEventIds.has(row.server_version)
        ? row.server_version
        : null);
    const identity = linkedSource ? `source:${linkedSource}` : `client:${String(row.id)}`;
    byIdentity.set(identity, row);
  }

  for (const [identity, server] of canonicalServerRows) {
    const clientId = server.client_conflict_id ?? undefined;
    const local = byIdentity.get(identity) ?? (clientId ? byIdentity.get(`client:${clientId}`) : undefined);
    const id = local?.id ?? clientId ?? server.id;
    const merged: ConflictRow = {
      ...(local ?? {}),
      id,
      entity_type: server.entity_type,
      entity_id: server.entity_id,
      tenant_id: local?.tenant_id ?? scope.tenant_id,
      store_id: local?.store_id ?? scope.store_id,
      device_id: local?.device_id ?? server.device_id ?? scope.device_id,
      created_at: local?.created_at ?? server.created_at,
      updated_at: server.updated_at,
      deleted_at: null,
      version: local?.version ?? 1,
      sync_status: "conflict",
      last_modified_by: local?.last_modified_by ?? null,
      resolution: "unresolved",
      local_snapshot: local?.local_snapshot ?? server.local_snapshot ?? null,
      server_snapshot: server.server_snapshot ?? local?.server_snapshot ?? null,
      error_message: server.message,
      source_event_id: server.source_event_id ?? readStringFromRecord(local, ["source_event_id"]),
      server_conflict_id: server.id,
      server_record_version: server.version,
      server_version: server.server_version,
    };
    byIdentity.set(identity, merged);
  }
  return [...byIdentity.values()].sort((a, b) =>
    String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")),
  );
}

function userSafeSyncReason(t: Translate, rawReason: unknown, fallback?: string): string {
  const fallbackText = fallback ?? t("sync.reason.fallback");
  const text = typeof rawReason === "string" ? rawReason.trim() : "";
  if (!text) return fallbackText;
  const lower = text.toLowerCase();
  if (lower.includes("purchase") || lower.includes("stockledgerid") || lower.includes("purchasehistoryid") || lower.includes("purchasebillid")) {
    return t("sync.reason.purchase");
  }
  if (lower.includes("ledger") || (lower.includes("amount") && (lower.includes("too_small") || lower.includes("greater than or equal")))) {
    return t("sync.reason.ledger");
  }
  if (lower.includes("payment") || lower.includes("udhar")) {
    return t("sync.reason.payment");
  }
  if (lower.includes("server changed") || lower.includes("unsynced local changes")) {
    return t("sync.reason.changedElsewhere");
  }
  if (
    lower.includes("validation") ||
    lower.includes("invalid_string") ||
    lower.includes("too_small") ||
    lower.includes("\"path\"") ||
    lower.includes("\"code\"") ||
    text.startsWith("[") ||
    text.startsWith("{")
  ) {
    return fallbackText;
  }
  // Anything that survives to here is the server's own sentence, which arrives in
  // English whatever the app language is. Showing it beats hiding the only clue the
  // owner has; the classified cases above are what keep that rare.
  return text.length > 160 ? fallbackText : text;
}

function recordPath(entityType: string | undefined, entityId?: string | null) {
  const entity = String(entityType ?? "").toLowerCase();
  if (entity.includes("bill")) return entityId ? `/bills/${entityId}` : "/bills";
  if (entity.includes("customer")) return entityId ? `/customers/${entityId}` : "/customers";
  if (entity.includes("product")) return "/products";
  if (entity.includes("supplier")) return "/suppliers";
  if (entity.includes("inventory") || entity.includes("stock")) return "/inventory";
  if (entity.includes("payment") || entity.includes("ledger") || entity.includes("udhar")) return "/udhar";
  return "/sync-status";
}

function payloadFromOperation(operation: PendingSyncEvent): Record<string, unknown> {
  return isRecord(operation.payload) ? operation.payload : {};
}

/**
 * The record a sync payload is about, wherever it is carried.
 *
 * An outbox payload is an envelope: UPDATE_PRODUCT sends
 * `{ productId, product: {...} }`, and the conflict row stores that envelope
 * whole. Reading only the top level meant a failed product backup was announced
 * as "product - cmt2k3rk1007fmex9tbsclg8f", which names nothing a shopkeeper can
 * act on — the name was one level down the entire time.
 */
function subjectRecords(payload: Record<string, unknown>): Record<string, unknown>[] {
  const nested = ["product", "bill", "payment", "customer", "supplier", "expense"]
    .map((key) => payload[key])
    .filter(isRecord);
  return [payload, ...nested];
}

function readSubjectString(records: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const record of records) {
    const value = readStringFromRecord(record, keys);
    if (value) return value;
  }
  return undefined;
}

function readSubjectNumber(records: Record<string, unknown>[], keys: string[]): number | null {
  for (const record of records) {
    const value = readNumberFromRecord(record, keys);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

const SUBJECT_NAME_KEYS = ["customerName", "customer_name", "name", "productName", "product_name"];
const SUBJECT_BILL_NO_KEYS = ["billNo", "billNumber", "bill_no"];
const SUBJECT_AMOUNT_KEYS = ["grandTotal", "grand_total", "totalAmount", "amount", "creditAmount", "credit_amount"];

function operationSubject(loc: Loc, operation: PendingSyncEvent) {
  const payload = payloadFromOperation(operation);
  const records = subjectRecords(payload);
  const name = readSubjectString(records, SUBJECT_NAME_KEYS);
  const billNo = readSubjectString(records, SUBJECT_BILL_NO_KEYS);
  const amount = readSubjectNumber(records, SUBJECT_AMOUNT_KEYS);
  const mode = readSubjectString(records, ["mode", "paymentMode", "payment_mode"]);
  const reason =
    readStringFromRecord(operation, ["error_message", "last_error"]) ??
    readStringFromRecord(payload, ["reason", "note", "message"]);
  const entityId = readStringFromRecord(operation, ["entity_id"]) ?? operation.entity_id;
  const parts = [name, billNo, mode?.toUpperCase(), moneyLabel(amount)].filter(Boolean);
  const pendingUpload =
    operation.status === "PENDING" || operation.sync_status === "pending_sync";
  return {
    title: parts.length ? parts.join(" - ") : `${operation.entity_type} - ${entityId}`,
    reason: reason
      ? userSafeSyncReason(loc.t, reason)
      : (pendingUpload
        ? loc.t("sync.reason.waitingForce")
        : loc.t("sync.reason.noDetail")),
    amount,
    mode,
    entityId,
  };
}

function conflictSubject(loc: Loc, conflict: ConflictRow) {
  const local = isRecord(conflict.local_snapshot) ? conflict.local_snapshot : {};
  const server = isRecord(conflict.server_snapshot) ? conflict.server_snapshot : {};
  // A conflict stores the outbox envelope, so the record itself is usually nested.
  const records = [...subjectRecords(local), ...subjectRecords(server)];
  const name = readSubjectString(records, SUBJECT_NAME_KEYS);
  const billNo = readSubjectString(records, SUBJECT_BILL_NO_KEYS);
  const amount = readSubjectNumber(records, SUBJECT_AMOUNT_KEYS);
  const parts = [name, billNo, moneyLabel(amount)].filter(Boolean);
  return {
    title: parts.length ? parts.join(" - ") : `${safeString(conflict.entity_type)} - ${safeString(conflict.entity_id)}`,
    reason: userSafeSyncReason(loc.t, conflict.error_message),
  };
}

function groupOperationsByType(operations: PendingSyncEvent[]) {
  const groups = new Map<string, number>();
  for (const operation of operations) {
    const key = `${operation.entity_type}:${operation.operation_type}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()].sort((a, b) => b[1] - a[1]);
}

async function canSubscriptionSyncLocally(): Promise<boolean | null> {
  const snapshot = await getCurrentSubscriptionSnapshot();
  return snapshot.cloudSyncAllowed;
}

async function countBusinessRows() {
  const tables = [
    "products",
    "customers",
    "bills",
    "payments",
    "inventory_movements",
    "suppliers",
  ];
  const counts = await Promise.all(
    tables.map((table) =>
      offlineDB
        .getAll<OfflineRow>(table)
        .then((rows) => rows.length)
        .catch(() => 0),
    ),
  );
  return counts.reduce((total, count) => total + count, 0);
}

async function getLastSuccessfulSyncAt() {
  const cursors = await offlineDB
    .getAll<SyncCursorRow>("sync_cursor")
    .catch(() => []);
  const cursor = cursors.find((row) => row.id === "global");
  const lastPull = cursor?.last_pulled_at ?? cursor?.updated_at ?? null;
  const syncedOutbox = await offlineDB
    .getAll<PendingSyncEvent>("sync_outbox")
    .then((rows) =>
      rows.filter(
        (operation) =>
          operation.status === "SYNCED" || operation.sync_status === "synced",
      ),
    )
    .catch(() => []);

  const outboxTimes = syncedOutbox
    .map(
      (operation) => operation.last_attempt_at ?? operation.client_created_at,
    )
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );

  const allTimes = [lastPull, ...outboxTimes].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (allTimes.length === 0) return null;
  return allTimes.sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime(),
  )[0];
}

export async function readSyncSnapshot(): Promise<
  Omit<SyncStatusSnapshot, "isLoading" | "isSyncing">
> {
  await offlineDB.init();
  await repairResolvedSyncStatusNoise().catch(() => 0);
  const connection = await probeBackendConnection();
  const isOnline = connection.browserOnline && connection.backendReachable;
  const [
    allOperationsRaw,
    conflictRows,
    lastSuccessfulSyncAt,
    localBusinessRowsCount,
    localSubscriptionAllowed,
  ] = await Promise.all([
    offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
    offlineDB
      .getAll<ConflictRow>("sync_conflicts")
      .then((rows) =>
        rows.filter(
          (row) =>
            row.sync_status === "conflict" || row.resolution === "unresolved",
        ),
      )
      .catch(() => []),
    getLastSuccessfulSyncAt(),
    countBusinessRows(),
    canSubscriptionSyncLocally(),
  ]);

  const allOperations = [...allOperationsRaw].sort(
    (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
  );

  let serverStatus: SyncStatusResponse | null = null;
  let serverConflictRows: SyncConflictRecord[] = [];
  let fleet: SyncFleetResponse | null = null;
  let subscriptionSyncAllowed = localSubscriptionAllowed;
  if (isOnline) {
    try {
      serverStatus = await getSyncStatus();
      if (serverStatus.allowed !== undefined)
        subscriptionSyncAllowed = serverStatus.allowed;
    } catch {
      // The page must still work offline or when the sync-status endpoint is unavailable.
    }
    try {
      const ledger = await listSyncConflicts({ status: "open", limit: 100, background: true });
      serverConflictRows = ledger.conflicts;
    } catch {
      // Cashiers cannot list cross-device snapshots; owners still retain local rows offline.
    }
    try {
      fleet = await getSyncFleet({ background: true });
    } catch {
      // Fleet visibility is intentionally owner/admin only.
    }
  }

  const pendingOperations = allOperations.filter(
    (operation) =>
      operation.status === "PENDING" ||
      operation.status === "SYNCING" ||
      operation.sync_status === "pending_sync" ||
      operation.sync_status === "syncing",
  );
  const failedOperations = allOperations.filter(
    (operation) =>
      operation.status === "FAILED" || operation.sync_status === "failed",
  );

  return {
    isOnline,
    isBrowserOnline: connection.browserOnline,
    isBackendReachable: connection.backendReachable,
    backendError: connection.error ?? null,
    pendingOperations,
    failedOperations,
    conflicts: mergeServerConflictRows(conflictRows as ConflictRow[], serverConflictRows),
    lastSuccessfulSyncAt,
    deviceId: getOfflineScope().device_id,
    apiBaseUrl: getApiBaseUrl(),
    subscriptionSyncAllowed,
    serverStatus,
    fleet,
    localBusinessRowsCount,
  };
}

function FleetHealthCard({
  fleet,
  currentDeviceId,
}: {
  fleet: SyncFleetResponse;
  currentDeviceId: string;
}) {
  const loc = useAppLanguage();
  const { t } = loc;
  const stateMeta = {
    current: { label: t("sync.fleet.state.current"), variant: "secondary" as const, dot: "bg-emerald-500" },
    behind: { label: t("sync.fleet.state.behind"), variant: "outline" as const, dot: "bg-amber-500" },
    stale: { label: t("sync.fleet.state.stale"), variant: "destructive" as const, dot: "bg-red-500" },
    never_acknowledged: { label: t("sync.fleet.state.neverAcknowledged"), variant: "outline" as const, dot: "bg-slate-400" },
  };
  const formatLag = (value: string) => {
    try {
      return BigInt(value).toLocaleString("en-IN");
    } catch {
      return value;
    }
  };

  return (
    <Card className={fleet.summary.attention > 0 ? "border-amber-200/80" : "border-emerald-200/80"}>
      <CardHeader className="gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Smartphone className="h-5 w-5 text-primary" />
            {t("sync.fleet.title")}
          </CardTitle>
          <CardDescription className="mt-1">
            {t("sync.fleet.subtitle")}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{t("sync.fleet.summaryCurrent", { count: fleet.summary.current })}</Badge>
          {fleet.summary.attention > 0 ? (
            <Badge variant="destructive">{t("sync.fleet.summaryAttention", { count: fleet.summary.attention })}</Badge>
          ) : (
            <Badge variant="outline">{t("sync.fleet.healthy")}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {fleet.devices.map((device) => {
            const meta = stateMeta[device.state];
            const isCurrentDevice = device.device_id === currentDeviceId;
            return (
              <div
                key={device.device_id}
                className="rounded-2xl border bg-background p-4 shadow-sm transition-colors hover:border-primary/25"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${device.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                      <p className="truncate font-semibold">
                        {displayDeviceName(device.device_name, isCurrentDevice)}
                      </p>
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {device.device_id}
                    </p>
                  </div>
                  <Badge variant={meta.variant} className="shrink-0">
                    <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-muted/60 p-3">
                    <p className="text-muted-foreground">{t("sync.fleet.lag")}</p>
                    <p className="mt-1 text-base font-bold">{formatLag(device.lag)}</p>
                  </div>
                  <div className="rounded-xl bg-muted/60 p-3">
                    <p className="text-muted-foreground">{t("sync.fleet.presence")}</p>
                    <p className="mt-1 text-base font-bold">{device.online ? t("sync.fleet.online") : t("sync.fleet.offline")}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{device.acknowledged_at ? t("sync.fleet.applied", { time: formatTimeAgo(loc, device.acknowledged_at) }) : t("sync.fleet.noCursor")}</span>
                  {isCurrentDevice && <Badge variant="outline">{t("sync.fleet.thisDevice")}</Badge>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          {t("sync.fleet.footnote", { seq: String(fleet.server_seq) })}
        </p>
      </CardContent>
    </Card>
  );
}

function OperationList({
  title,
  emptyText,
  operations,
  kind,
  isSyncing = false,
  onRetryOperation,
  onIgnoreOperation,
}: {
  title: string;
  emptyText: string;
  operations: PendingSyncEvent[];
  kind: "pending" | "failed";
  isSyncing?: boolean;
  onRetryOperation?: (clientEventId: string) => void;
  onIgnoreOperation?: (clientEventId: string) => void;
}) {
  const loc = useAppLanguage();
  const { t } = loc;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>
          {operations.length === 0
            ? emptyText
            : operations.length === 1
              ? t("sync.ops.listedOne")
              : t("sync.ops.listedMany", { count: operations.length })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {operations.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          operations.slice(0, 25).map((operation) => (
            <div
              key={operation.clientEventId}
              className="rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {getSimpleOperationName(t, operation.operation_type)}
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {operationSubject(loc, operation).title}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {kind === "failed"
                      ? getFriendlyFailureMessage(t, operation)
                      : t("sync.ops.waiting")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={kind === "failed" ? "destructive" : "secondary"}
                  >
                    {operation.status}
                  </Badge>
                  {kind === "failed" && onRetryOperation ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSyncing}
                      onClick={() => onRetryOperation(operation.clientEventId)}
                    >
                      {t("sync.ops.retryThis")}
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <a href={recordPath(operation.entity_type, operationSubject(loc, operation).entityId)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t("sync.ops.open")}
                    </a>
                  </Button>
                  {onIgnoreOperation ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isSyncing}
                      onClick={() => onIgnoreOperation(operation.clientEventId)}
                    >
                      {t("sync.ops.ignore")}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                <div>{t("sync.ops.entity")} {operation.entity_type}</div>
                <div>{t("sync.ops.operation")} {operation.operation_type}</div>
                <div>{t("sync.ops.item")} {operationSubject(loc, operation).entityId}</div>
                <div>{t("sync.ops.amount")} {moneyLabel(operationSubject(loc, operation).amount) ?? "-"}</div>
                <div>{t("sync.ops.retries")} {operation.retry_count}</div>
                <div>{t("sync.ops.created")} {formatTimeAgo(loc, operation.client_created_at)}</div>
                <div>{t("sync.ops.reason")} {operationSubject(loc, operation).reason}</div>
              </div>
              {(operation.error_message || operation.last_error) && (
                <details className="mt-3 rounded-md bg-muted/60 p-3 text-xs">
                  <summary className="cursor-pointer font-medium text-muted-foreground">
                    {t("sync.ops.technical")}
                  </summary>
                  <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-background px-3 py-2 whitespace-pre-wrap text-muted-foreground">
                    {operation.error_message ?? operation.last_error}
                  </pre>
                </details>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

type ConflictResolution = "use_local" | "use_server" | "resolved_by_owner" | "ignored_by_owner";

function allowsDirectConflictChoice(entityType: unknown) {
  return ["product", "products", "customer", "customers", "supplier", "suppliers"]
    .includes(String(entityType ?? "").toLowerCase());
}

// This is a product setup rule, not a competing edit from another device. The
// record must be corrected and saved again; choosing a version cannot make the
// blocked packaging conversion valid.
function requiresPackagingMigration(conflict: ConflictRow) {
  const message = String(conflict.error_message ?? "").toLowerCase();
  return message.includes("count stock to zero") && message.includes("pack-level inventory");
}

async function applyResolvedConflictLocally(conflict: SyncConflictRecord) {
  if (!allowsDirectConflictChoice(conflict.entity_type) || !isRecord(conflict.merged_payload)) return;
  const table = tableNameForEntity(conflict.entity_type);
  if (!table) return;
  const selected = conflict.merged_payload;
  const identities = new Set(
    [conflict.entity_id, selected.id, selected.local_id, selected.localId, selected.server_id, selected.serverId]
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const existing = (await offlineDB.getAll<OfflineRow>(table).catch(() => []))
    .find((row) => [row.id, row.local_id, row.server_id].some((value) => typeof value === "string" && identities.has(value)));
  await offlineDB.put(table, {
    ...(existing ?? {}),
    ...selected,
    id: existing?.id ?? String(selected.id ?? conflict.entity_id),
    sync_status: "synced",
    updated_at: new Date().toISOString(),
  });
}

function conflictFieldDiff(conflict: ConflictRow) {
  const sanitizedLocal = sanitizeSyncDiagnostic(conflict.local_snapshot);
  const sanitizedCloud = sanitizeSyncDiagnostic(conflict.server_snapshot);
  const local = isRecord(sanitizedLocal) ? sanitizedLocal : {};
  const cloud = isRecord(sanitizedCloud) ? sanitizedCloud : {};
  return [...new Set([...Object.keys(local), ...Object.keys(cloud)])]
    .filter((key) => !isSensitiveSyncKey(key))
    .filter((key) => compactJson(local[key]) !== compactJson(cloud[key]))
    .slice(0, 20)
    .map((key) => ({ key, local: local[key], cloud: cloud[key] }));
}
function ConflictList({
  conflicts,
  onMarkResolved,
}: {
  conflicts: ConflictRow[];
  onMarkResolved?: (conflictId: string, resolution: ConflictResolution) => void;
}) {
  const loc = useAppLanguage();
  const { t } = loc;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("sync.conflict.title")}</CardTitle>
        <CardDescription>
          {conflicts.length === 0
            ? t("sync.conflict.empty")
            : t("sync.conflict.some")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {conflicts.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t("sync.conflict.emptyBox")}
          </div>
        ) : (
          conflicts.slice(0, 25).map((conflict) => (
            <div
              key={conflict.id}
              className="rounded-lg border border-amber-300/60 bg-amber-50/50 p-4 dark:bg-amber-950/10"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {t("sync.conflict.needsAttention")}
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {conflictSubject(loc, conflict).title}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {safeString(conflict.entity_type)} -{" "}
                    {safeString(conflict.entity_id)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t("sync.conflict.retryReview")}</Badge>
                  <Button asChild size="sm" variant="outline">
                    <a href={recordPath(conflict.entity_type, conflict.entity_id)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t("sync.conflict.open")}
                    </a>
                  </Button>
                  {onMarkResolved && allowsDirectConflictChoice(conflict.entity_type) && !requiresPackagingMigration(conflict) ? (
                    <>
                      <Button size="sm" onClick={() => onMarkResolved(conflict.id, "use_local")}>
                        {t("sync.conflict.keepLocal")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onMarkResolved(conflict.id, "use_server")}>
                        {t("sync.conflict.keepCloud")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onMarkResolved(conflict.id, "ignored_by_owner")}>
                        {t("sync.conflict.decideLater")}
                      </Button>
                    </>
                  ) : onMarkResolved ? <Badge variant="outline">{t("sync.conflict.useReversal")}</Badge> : null}
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {conflictSubject(loc, conflict).reason} {t("sync.conflict.safeSuffix")}
              </p>
              {!allowsDirectConflictChoice(conflict.entity_type) ? (
                <p className="mt-2 rounded-md border border-amber-300 bg-amber-100/70 p-2 text-xs font-semibold text-amber-950">
                  {t("sync.conflict.immutable")}
                </p>
              ) : null}
              {conflictFieldDiff(conflict).length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-md border bg-background text-xs">
                  <div className="grid min-w-[560px] grid-cols-[140px_1fr_1fr] border-b bg-muted/50 font-semibold">
                    <div className="p-2">{t("sync.conflict.field")}</div><div className="border-l p-2">{t("sync.conflict.thisDevice")}</div><div className="border-l p-2">{t("sync.conflict.cloud")}</div>
                  </div>
                  {conflictFieldDiff(conflict).map((field) => (
                    <div key={field.key} className="grid min-w-[560px] grid-cols-[140px_1fr_1fr] border-b last:border-b-0">
                      <div className="break-words p-2 font-medium">{field.key}</div>
                      <pre className="whitespace-pre-wrap break-words border-l p-2">{compactJson(field.local)}</pre>
                      <pre className="whitespace-pre-wrap break-words border-l p-2">{compactJson(field.cloud)}</pre>
                    </div>
                  ))}
                </div>
              )}              <details className="mt-3 rounded-md bg-background/70 p-3 text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground">
                  {t("sync.conflict.technical")}
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-muted-foreground">
                  {compactJson({
                    error: conflict.error_message,
                    local: conflict.local_snapshot,
                    server: conflict.server_snapshot,
                  })}
                </pre>
              </details>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ServerUrlEditor({ currentUrl, onSaved }: { currentUrl: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentUrl);
  const { toast } = useToast();
  const { t } = useAppLanguage();

  function save() {
    const trimmed = value.trim().replace(/\/$/, "");
    if (!trimmed) return;
    setApiBaseUrl(trimmed);
    onSaved();
    setEditing(false);
    toast({ title: t("sync.toast.serverUrlSaved"), description: t("sync.toast.serverUrlSavedBody") });
  }

  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Cloud className="h-4 w-4" /> {t("sync.settings.serverUrl")}
        </div>
        {!editing && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setValue(currentUrl); setEditing(true); }}>
            {t("sync.settings.edit")}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded-lg border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://your-backend.example.com/api"
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            autoFocus
          />
          <Button size="sm" className="h-9 text-xs" onClick={save}>{t("sync.settings.save")}</Button>
          <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={() => setEditing(false)}>{t("sync.settings.cancel")}</Button>
        </div>
      ) : (
        <div className="mt-3 min-h-11 rounded-xl bg-muted/70 p-3 font-mono text-xs leading-relaxed break-all">
          {currentUrl}
        </div>
      )}
    </div>
  );
}

export default function SyncStatusPage() {
  const { toast } = useToast();
  const loc = useAppLanguage();
  const { t } = loc;
  const [snapshot, setSnapshot] = useState<SyncStatusSnapshot>(initialSnapshot);

  const refresh = useCallback(async () => {
    setSnapshot((current) => ({
      ...current,
      isLoading: true,
      isOnline: readBackendConnectionSnapshot().browserOnline && readBackendConnectionSnapshot().backendReachable,
      isBrowserOnline: readBackendConnectionSnapshot().browserOnline,
      isBackendReachable: readBackendConnectionSnapshot().backendReachable,
      backendError: readBackendConnectionSnapshot().error ?? null,
    }));
    const next = await readSyncSnapshot();
    setSnapshot((current) => ({ ...current, ...next, isLoading: false }));
  }, []);

  useEffect(() => {
    void refresh();
    const onOnlineChange = () => void refresh();
    const onDataChange = () => void refresh();
    window.addEventListener("online", onOnlineChange);
    window.addEventListener("offline", onOnlineChange);
    window.addEventListener("kirana:sync-queue-updated", onDataChange);
    window.addEventListener("kirana:local-data-changed", onDataChange);
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => {
      window.removeEventListener("online", onOnlineChange);
      window.removeEventListener("offline", onOnlineChange);
      window.removeEventListener("kirana:sync-queue-updated", onDataChange);
      window.removeEventListener("kirana:local-data-changed", onDataChange);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const pendingCount = snapshot.pendingOperations.length;
  const failedCount = snapshot.failedOperations.length;
  const conflictCount = snapshot.conflicts.length;
  const retryableCount = failedCount + conflictCount;
  const neverBackedUp =
    snapshot.localBusinessRowsCount > 0 && !snapshot.lastSuccessfulSyncAt;

  const hero = useMemo(() => {
    if (!snapshot.isBrowserOnline)
      return {
        title: t("sync.hero.internetOffline"),
        tone: "offline" as const,
        icon: WifiOff,
      };
    if (!snapshot.isBackendReachable)
      return {
        title: t("sync.hero.backendOffline"),
        tone: "offline" as const,
        icon: CloudOff,
      };
    if (failedCount > 0)
      return {
        title: t("sync.hero.failed"),
        tone: "failed" as const,
        icon: AlertCircle,
      };
    if (conflictCount > 0)
      return {
        title: t("sync.hero.conflict"),
        tone: "conflict" as const,
        icon: AlertCircle,
      };
    if (pendingCount > 0)
      return {
        title: t("sync.hero.pending", { count: pendingCount }),
        tone: "pending" as const,
        icon: Cloud,
      };
    if (neverBackedUp)
      return {
        title: t("sync.hero.neverBackedUp"),
        tone: "pending" as const,
        icon: Database,
      };
    return {
      title: t("sync.hero.ok"),
      tone: "ok" as const,
      icon: ShieldCheck,
    };
  }, [
    conflictCount,
    failedCount,
    neverBackedUp,
    pendingCount,
    t,
    snapshot.isOnline,
    snapshot.isBrowserOnline,
    snapshot.isBackendReachable,
  ]);

  const HeroIcon = hero.icon;

  const handleForceSync = async () => {
    if (!snapshot.isBrowserOnline) {
      toast({
        title: t("sync.toast.internetOffline"),
        description: t("sync.toast.internetOfflineForce"),
      });
      return;
    }
    if (!snapshot.isBackendReachable) {
      toast({
        title: t("sync.toast.backendOffline"),
        description: t("sync.toast.backendOfflineForce"),
      });
      return;
    }
    setSnapshot((current) => ({ ...current, isSyncing: true }));
    try {
      const result = await runSyncCycle();
      toast({
        title: t("sync.toast.syncChecked"),
        description: t("sync.toast.syncCycleResult", { pushed: result.pushed, pulled: result.pulled, failed: result.failed }),
      });
    } catch {
      toast({
        title: t("sync.toast.syncFailed"),
        description: t("sync.toast.syncFailedBody"),
      });
    } finally {
      setSnapshot((current) => ({ ...current, isSyncing: false }));
      await refresh();
    }
  };

  const handleRetryOne = async (clientEventId: string) => {
    if (!snapshot.isBrowserOnline) {
      toast({ title: t("sync.toast.internetOffline"), description: t("sync.toast.internetOfflineRetryOne") });
      return;
    }
    if (!snapshot.isBackendReachable) {
      toast({ title: t("sync.toast.backendOffline"), description: t("sync.toast.backendOfflineRetryOne") });
      return;
    }
    setSnapshot((current) => ({ ...current, isSyncing: true }));
    try {
      const result = await retryFailedSyncOperations([clientEventId]);
      toast({
        title: t("sync.toast.retryChecked"),
        description: t("sync.toast.retryResult", { pushed: result.pushed, failed: result.failed }),
      });
    } catch {
      toast({
        title: t("sync.toast.retryFailed"),
        description: t("sync.toast.retryFailedOneBody"),
      });
    } finally {
      setSnapshot((current) => ({ ...current, isSyncing: false }));
      await refresh();
    }
  };

  const handleIgnoreOperation = async (clientEventId: string) => {
    setSnapshot((current) => ({ ...current, isSyncing: true }));
    try {
      await offlineDB.removePendingEvent(clientEventId);
      toast({
        title: t("sync.toast.ignored"),
        description: t("sync.toast.ignoredBody"),
      });
    } catch {
      toast({
        title: t("sync.toast.ignoreFailed"),
        description: t("sync.toast.ignoreFailedBody"),
        variant: "destructive",
      });
    } finally {
      setSnapshot((current) => ({ ...current, isSyncing: false }));
      await refresh();
    }
  };

  // A dead-end "could not update" toast leaves the owner with no next step and no way to
  // report what happened. Every outcome the server can return maps to something the owner
  // can act on instead.
  const conflictFailureDescription = (error: unknown) => {
    if (!(error instanceof ApiClientError)) {
      return t("sync.conflictError.notRecorded");
    }
    const code = typeof error.data.code === "string" ? error.data.code : "";
    if (code === "SYNC_CONFLICT_COMPENSATING_ENTRY_REQUIRED") {
      return t("sync.conflictError.compensating");
    }
    if (code === "SYNC_CONFLICT_VERSION_MISMATCH") {
      return t("sync.conflictError.versionMismatch");
    }
    if (code === "SYNC_CONFLICT_SNAPSHOT_MISSING" || code === "SYNC_CONFLICT_ENTITY_ID_MISSING") {
      return t("sync.conflictError.snapshotMissing");
    }
    if (error.status === 404) {
      return t("sync.conflictError.notOnServer");
    }
    const message = typeof error.data.message === "string" ? error.data.message : error.message;
    return message
      ? t("sync.conflictError.serverMessage", { message })
      : t("sync.conflictError.serverGeneric");
  };

  const handleMarkConflictResolved = async (
    conflictId: string,
    resolution: ConflictResolution,
    isVersionRetry = false,
  ) => {
    if (!snapshot.isBrowserOnline || !snapshot.isBackendReachable) {
      toast({
        title: t("sync.toast.connectionRequired"),
        description: t("sync.toast.connectionRequiredBody"),
        variant: "destructive",
      });
      return;
    }
    setSnapshot((current) => ({ ...current, isSyncing: true }));
    try {
      await offlineDB.init();
      const row = await dexieDB.sync_conflicts.get(conflictId);
      const scope = getOfflineScope();
      if (row && (row.tenant_id !== scope.tenant_id || row.store_id !== scope.store_id)) throw new Error("Conflict not found");
      let serverConflictId = typeof row?.server_conflict_id === "string" ? row.server_conflict_id : conflictId;
      if (row && !row.server_conflict_id) {
        const reported = await reportSyncConflict({
          client_conflict_id: conflictId,
          entity_type: String(row.entity_type ?? "unknown"),
          entity_id: String(row.entity_id ?? conflictId),
          reason_code: "OWNER_REVIEW",
          message: String(row.error_message ?? "Owner-reviewed sync conflict"),
          local_snapshot: isRecord(row.local_snapshot) ? row.local_snapshot : null,
          server_snapshot: isRecord(row.server_snapshot) ? row.server_snapshot : null,
        });
        serverConflictId = reported.conflict.id;
      }
      const resolved = await resolveSyncConflict({
        conflict_id: serverConflictId,
        resolution,
        ...(typeof row?.server_record_version === "number"
          ? { expected_version: row.server_record_version }
          : {}),
      });
      await applyResolvedConflictLocally(resolved.conflict);
      const now = new Date().toISOString();
      if (row) {
        await dexieDB.sync_conflicts.put({
          ...row,
          server_conflict_id: serverConflictId,
          resolution,
          sync_status: "synced",
          resolved_at: now,
          updated_at: now,
        });
      }
      // The queue event that produced this conflict is still sitting there as CONFLICT,
      // and it is what the "N changes need review" banner counts. Leaving it made the
      // owner clear the same failure twice, in two different places, with the red
      // banner still up after they had already decided. Postponing keeps it, since the
      // decision is explicitly "not now".
      if (resolution !== "ignored_by_owner") {
        const sourceEventId = typeof row?.source_event_id === "string" ? row.source_event_id : null;
        if (sourceEventId) await offlineDB.removePendingEvent(sourceEventId).catch(() => undefined);
      }
      window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated"));
      toast({
        title: resolution === "use_local" ? t("sync.toast.keptLocal") : resolution === "use_server" ? t("sync.toast.keptCloud") : resolution === "resolved_by_owner" ? t("sync.toast.markedResolved") : t("sync.toast.postponed"),
        description: resolution === "ignored_by_owner" ? t("sync.toast.postponedBody") : t("sync.toast.decisionRecorded"),
      });
    } catch (error) {
      // Another device getting there first is a finished review, not a failure: clear it
      // locally so the owner is not left re-clicking an item that no longer needs them.
      if (
        error instanceof ApiClientError &&
        error.data.code === "SYNC_CONFLICT_ALREADY_RESOLVED"
      ) {
        const row = await dexieDB.sync_conflicts.get(conflictId).catch(() => undefined);
        const now = new Date().toISOString();
        if (row) {
          await dexieDB.sync_conflicts
            .put({ ...row, resolution: "resolved_elsewhere", sync_status: "synced", resolved_at: now, updated_at: now })
            .catch(() => undefined);
        }
        window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated"));
        toast({
          title: t("sync.toast.alreadyReviewed"),
          description: t("sync.toast.alreadyReviewedBody"),
        });
        return;
      }
      // A stale expected_version is not something the owner can fix by looking at the
      // screen: the device keeps sending the number it was handed, so every retry
      // fails the same way and the review can never be cleared — Ignore included,
      // since it claims the conflict too. Drop the stored version so the next press
      // goes in without one and the server uses its own current value.
      if (
        error instanceof ApiClientError &&
        error.data.code === "SYNC_CONFLICT_VERSION_MISMATCH" &&
        !isVersionRetry
      ) {
        const row = await dexieDB.sync_conflicts.get(conflictId).catch(() => undefined);
        if (row && row.server_record_version != null) {
          await dexieDB.sync_conflicts
            .put({ ...row, server_record_version: null, updated_at: new Date().toISOString() })
            .catch(() => undefined);
          // Healed, so carry out the decision the owner actually pressed rather than
          // making them press it a second time. Guarded so a genuine race — another
          // device resolving this right now — still surfaces instead of looping.
          setSnapshot((current) => ({ ...current, isSyncing: false }));
          await handleMarkConflictResolved(conflictId, resolution, true);
          return;
        }
      }
      toast({
        title: t("sync.toast.conflictFailed"),
        description: conflictFailureDescription(error),
        variant: "destructive",
      });
    } finally {
      setSnapshot((current) => ({ ...current, isSyncing: false }));
      await refresh();
    }
  };

  const handleRetryFailed = async () => {
    if (retryableCount === 0) {
      toast({
        title: t("sync.toast.noBlocked"),
        description: t("sync.toast.noBlockedBody"),
      });
      return;
    }
    if (!snapshot.isBrowserOnline) {
      toast({
        title: t("sync.toast.internetOffline"),
        description: t("sync.toast.internetOfflineRetryAll"),
      });
      return;
    }
    if (!snapshot.isBackendReachable) {
      toast({
        title: t("sync.toast.backendOffline"),
        description: t("sync.toast.backendOfflineRetryAll"),
      });
      return;
    }
    setSnapshot((current) => ({ ...current, isSyncing: true }));
    try {
      const storedConflictOpIds = snapshot.conflicts
        .filter((conflict) => retryableStoredGuestBillConflict(conflict))
        .map((conflict) => readStringFromRecord(conflict, ["source_event_id", "sourceEventId"]))
        .filter((value): value is string => Boolean(value));
      const result = await retryFailedSyncOperations(undefined, storedConflictOpIds);
      toast({
        title: t("sync.toast.retryStarted"),
        description: t("sync.toast.syncResult", { pushed: result.pushed, failed: result.failed }),
      });
    } catch {
      toast({
        title: t("sync.toast.retryFailed"),
        description: t("sync.toast.retryFailedAllBody"),
      });
    } finally {
      setSnapshot((current) => ({ ...current, isSyncing: false }));
      await refresh();
    }
  };

  return (
    <PageShell className="space-y-4 sm:space-y-6">
      <PageHeader
        className="sync-status-header"
        headingLevel={2}
        title={<span className="flex items-center gap-3"><span className="rounded-full bg-primary/10 p-3 text-primary"><HeroIcon className="h-6 w-6" /></span>{t("sync.title")}</span>}
        description={hero.title}
        eyebrow={<SyncBadge status={snapshot.isOnline ? (failedCount > 0 ? "failed" : pendingCount > 0 ? "pending" : "synced") : "offline"} label={snapshot.isOnline ? (failedCount > 0 ? t("sync.badge.failed", { count: failedCount }) : t("sync.badge.pending", { count: pendingCount })) : t("sync.badge.offline")} />}
        actions={(
          <>
            <Button variant="outline" onClick={() => void handleRetryFailed()} disabled={snapshot.isSyncing || retryableCount === 0}>
              {snapshot.isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              {t("sync.action.retryFailed")}
            </Button>
            <Button onClick={() => void handleForceSync()} disabled={snapshot.isSyncing}>
              {snapshot.isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
              {t("sync.action.forceSync")}
            </Button>
          </>
        )}
      />

      {neverBackedUp && (
        <Alert>
          <Database className="h-4 w-4" />
          <AlertTitle>{t("sync.alert.neverBackedUp.title")}</AlertTitle>
          <AlertDescription>{t("sync.alert.neverBackedUp.body")}</AlertDescription>
        </Alert>
      )}

      {!snapshot.isBrowserOnline && (
        <Alert>
          <WifiOff className="h-4 w-4" />
          <AlertTitle>{t("sync.alert.internetOffline.title")}</AlertTitle>
          <AlertDescription>{t("sync.alert.internetOffline.body")}</AlertDescription>
        </Alert>
      )}

      {snapshot.isBrowserOnline && !snapshot.isBackendReachable && (
        <Alert>
          <CloudOff className="h-4 w-4" />
          <AlertTitle>{t("sync.alert.backendOffline.title")}</AlertTitle>
          <AlertDescription>{t("sync.alert.backendOffline.body", { url: snapshot.apiBaseUrl })}</AlertDescription>
        </Alert>
      )}

      {failedCount > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t("sync.alert.failed.title")}</AlertTitle>
          <AlertDescription>
            {snapshot.isOnline ? t("sync.alert.failed.online") : t("sync.alert.failed.offline")}
          </AlertDescription>
        </Alert>
      )}

      {(failedCount > 0 || conflictCount > 0 || pendingCount > 0) && (
        <Card className="border-amber-200 bg-amber-50/60 dark:bg-amber-950/10">
          <CardHeader>
            <CardTitle className="text-lg">{t("sync.attention.title")}</CardTitle>
            <CardDescription>{t("sync.attention.body")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {groupOperationsByType([...snapshot.pendingOperations, ...snapshot.failedOperations]).map(([group, count]) => (
                // The group key is `entity:OPERATION`, and both halves were printed raw
                // ("product - UPDATE_PRODUCT"). The operation name already carries the
                // entity, so the readable half alone says more, in either language.
                <Badge key={group} variant="outline">{getSimpleOperationName(t, group.split(":")[1] ?? group)} x {count}</Badge>
              ))}
              {conflictCount > 0 && <Badge variant="destructive">{t("sync.attention.reviewBadge", { count: conflictCount })}</Badge>}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {[...snapshot.failedOperations, ...snapshot.pendingOperations].slice(0, 6).map((operation) => (
                <div key={operation.clientEventId} className="rounded-lg border bg-background p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{getSimpleOperationName(t, operation.operation_type)}</span>
                    <Badge variant={operation.status === "FAILED" ? "destructive" : "secondary"}>{operation.status}</Badge>
                  </div>
                  <div className="mt-1 text-muted-foreground">{operationSubject(loc, operation).title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatTimeAgo(loc, operation.client_created_at)} - {operationSubject(loc, operation).reason}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {operation.status === "FAILED" ? (
                      <Button size="sm" variant="outline" disabled={snapshot.isSyncing} onClick={() => void handleRetryOne(operation.clientEventId)}>
                        {t("sync.attention.retry")}
                      </Button>
                    ) : null}
                    <Button asChild size="sm" variant="outline">
                      <a href={recordPath(operation.entity_type, operationSubject(loc, operation).entityId)}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        {t("sync.attention.openRecord")}
                      </a>
                    </Button>
                    <Button size="sm" variant="ghost" disabled={snapshot.isSyncing} onClick={() => void handleIgnoreOperation(operation.clientEventId)}>
                      {t("sync.attention.ignore")}
                    </Button>
                  </div>
                </div>
              ))}
              {snapshot.conflicts.slice(0, 4).map((conflict) => (
                <div key={conflict.id} className="rounded-lg border border-amber-300/70 bg-background p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{t("sync.conflict.title")}</span>
                    <Badge variant="outline">{t("sync.stat.retryReview")}</Badge>
                  </div>
                  <div className="mt-1 text-muted-foreground">{conflictSubject(loc, conflict).title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{conflictSubject(loc, conflict).reason}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <a href={recordPath(conflict.entity_type, conflict.entity_id)}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        {t("sync.attention.openRecord")}
                      </a>
                    </Button>
                    {allowsDirectConflictChoice(conflict.entity_type) && !requiresPackagingMigration(conflict) ? <>
                      <Button size="sm" onClick={() => void handleMarkConflictResolved(conflict.id, "use_local")}>{t("sync.conflict.keepLocal")}</Button>
                      <Button size="sm" variant="outline" onClick={() => void handleMarkConflictResolved(conflict.id, "use_server")}>{t("sync.conflict.keepCloud")}</Button>
                    </> : <Badge variant="outline">{t("sync.conflict.correctionRequired")}</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => void handleMarkConflictResolved(conflict.id, "ignored_by_owner")}>
                      {t("sync.attention.ignore")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <StatsGrid>
        <StatCard label={t("sync.stat.internet")} value={snapshot.isBrowserOnline ? t("sync.stat.online") : t("sync.stat.offline")} description={snapshot.isBrowserOnline ? t("sync.stat.internetAvailable") : t("sync.stat.billingStillWorks")} icon={snapshot.isBrowserOnline ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />} tone={snapshot.isBrowserOnline ? "green" : "amber"} />
        <StatCard label={t("sync.stat.backend")} value={snapshot.isBackendReachable ? t("sync.stat.online") : t("sync.stat.offline")} description={snapshot.isBackendReachable ? t("sync.stat.backupCanRun") : t("sync.stat.backupPaused")} icon={snapshot.isBackendReachable ? <Cloud className="h-5 w-5" /> : <CloudOff className="h-5 w-5" />} tone={snapshot.isBackendReachable ? "green" : "amber"} />
        <StatCard label={t("sync.stat.lastBackup")} value={formatTimeAgo(loc, snapshot.lastSuccessfulSyncAt)} description={snapshot.lastSuccessfulSyncAt ? t("sync.stat.lastBackupYes") : t("sync.stat.lastBackupNo")} icon={<Cloud className="h-5 w-5" />} />
        <StatCard label={t("sync.stat.pending")} value={pendingCount} description={pendingCount === 1 ? t("sync.stat.pendingOne") : t("sync.stat.pendingMany", { count: pendingCount })} icon={<Database className="h-5 w-5" />} tone={pendingCount > 0 ? "amber" : "green"} />
        <StatCard label={t("sync.stat.retryReview")} value={`${failedCount} / ${conflictCount}`} description={t("sync.stat.retryReviewHint")} icon={<AlertCircle className="h-5 w-5" />} tone={failedCount || conflictCount ? "red" : "green"} />
      </StatsGrid>

      {snapshot.fleet && (
        <FleetHealthCard fleet={snapshot.fleet} currentDeviceId={snapshot.deviceId} />
      )}

      <SyncDiagnosticsSection />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("sync.settings.title")}</CardTitle>
          <CardDescription>{t("sync.settings.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Smartphone className="h-4 w-4" /> {t("sync.settings.deviceId")}
              </div>
              <div className="mt-3 min-h-11 rounded-xl bg-muted/70 p-3 font-mono text-xs leading-relaxed break-all">
                {snapshot.deviceId}
              </div>
            </div>
            <ServerUrlEditor currentUrl={snapshot.apiBaseUrl} onSaved={() => setSnapshot((prev) => ({ ...prev, apiBaseUrl: getApiBaseUrl() }))} />
            <div className="rounded-xl border bg-background p-4 lg:col-span-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShieldCheck className="h-4 w-4" /> {t("sync.settings.subscription")}
              </div>
              <div className="mt-3 rounded-xl bg-muted/70 p-3">
                <Badge
                  variant={
                    snapshot.subscriptionSyncAllowed === false
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {snapshot.subscriptionSyncAllowed === false
                    ? t("sync.settings.subscriptionNotAllowed")
                    : snapshot.subscriptionSyncAllowed === true
                      ? t("sync.settings.subscriptionAllowed")
                      : t("sync.settings.subscriptionChecking")}
                </Badge>
              </div>
            </div>
          </div>
          {snapshot.serverStatus && (
            <details className="mt-4 rounded-xl border bg-muted/50 p-4 text-xs">
              <summary className="cursor-pointer font-medium text-muted-foreground">
                {t("sync.settings.serverDetails")}
              </summary>
              <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-background p-4 whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {compactJson(snapshot.serverStatus)}
              </pre>
            </details>
          )}
        </CardContent>
      </Card>

      <Separator />

      <div className="grid gap-6 xl:grid-cols-2">
        <OperationList
          title={t("sync.ops.pendingTitle")}
          emptyText={t("sync.ops.pendingEmpty")}
          operations={snapshot.pendingOperations}
          kind="pending"
          isSyncing={snapshot.isSyncing}
          onIgnoreOperation={(clientEventId) => void handleIgnoreOperation(clientEventId)}
        />
        <OperationList
          title={t("sync.ops.failedTitle")}
          emptyText={t("sync.ops.failedEmpty")}
          operations={snapshot.failedOperations}
          kind="failed"
          isSyncing={snapshot.isSyncing}
          onRetryOperation={(clientEventId) => void handleRetryOne(clientEventId)}
          onIgnoreOperation={(clientEventId) => void handleIgnoreOperation(clientEventId)}
        />
      </div>

      <ConflictList
        conflicts={snapshot.conflicts}
        onMarkResolved={(conflictId, resolution) => void handleMarkConflictResolved(conflictId, resolution)}
      />

      {snapshot.isLoading && (
        <div className="fixed bottom-4 right-4 rounded-full border bg-background px-4 py-2 text-sm shadow">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> {t("sync.loading")}
        </div>
      )}
    </PageShell>
  );
}
