import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
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
import { getApiBaseUrl, setApiBaseUrl } from "@/lib/api/http";
import { probeBackendConnection, readBackendConnectionSnapshot } from "@/features/sync/backend-health";
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
  retryFailedSyncOperations,
  runSyncCycle,
} from "@/features/sync";
import { getCurrentSubscriptionSnapshot } from "@/features/subscription/access";
import type { SyncStatusResponse } from "@/types/api";
import { repairResolvedSyncStatusNoise } from "@/features/sync/sync-status-repair";
import { PageHeader, PageShell, StatCard, StatsGrid, SyncBadge } from "@/components/shared";

interface ConflictRow extends OfflineRow {
  entity_type?: string;
  entity_id?: string;
  resolution?: string;
  error_message?: string;
  local_snapshot?: unknown;
  server_snapshot?: unknown;
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
  localBusinessRowsCount: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSimpleOperationName(operationType: string) {
  const normalized = operationType.replace(/_/g, " ").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getFriendlyFailureMessage(operation: PendingSyncEvent) {
  if (!operation.error_message && !operation.last_error)
    return "Cloud backup could not finish. Retry is needed.";
  if (!navigator.onLine)
    return "Internet is offline. This change will retry when internet returns.";
  return "Cloud backup failed for this change. Retry is needed.";
}

function formatTimeAgo(value: string | null) {
  if (!value) return "No cloud backup yet";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Backup time unavailable";
  return `${formatDistanceToNow(new Date(time), { addSuffix: true })}`;
}

function safeString(value: unknown, fallback = "-") {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function compactJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
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

function operationSubject(operation: PendingSyncEvent) {
  const payload = payloadFromOperation(operation);
  const nestedPayment = isRecord(payload.payment) ? payload.payment : {};
  const nestedBill = isRecord(payload.bill) ? payload.bill : {};
  const name =
    readStringFromRecord(payload, ["customerName", "customer_name", "name", "productName", "product_name"]) ??
    readStringFromRecord(nestedBill, ["customerName", "customer_name", "name"]) ??
    readStringFromRecord(nestedPayment, ["customerName", "customer_name", "name"]);
  const billNo =
    readStringFromRecord(payload, ["billNo", "billNumber", "bill_no"]) ??
    readStringFromRecord(nestedBill, ["billNo", "billNumber", "bill_no"]);
  const amount =
    readNumberFromRecord(payload, ["grandTotal", "grand_total", "totalAmount", "amount", "creditAmount", "credit_amount"]) ??
    readNumberFromRecord(nestedPayment, ["amount"]) ??
    readNumberFromRecord(nestedBill, ["grandTotal", "grand_total", "totalAmount", "amount"]);
  const mode =
    readStringFromRecord(payload, ["mode", "paymentMode", "payment_mode"]) ??
    readStringFromRecord(nestedPayment, ["mode", "paymentMode", "payment_mode"]);
  const reason =
    readStringFromRecord(operation, ["error_message", "last_error"]) ??
    readStringFromRecord(payload, ["reason", "note", "message"]);
  const entityId = readStringFromRecord(operation, ["entity_id"]) ?? operation.entity_id;
  const parts = [name, billNo, mode?.toUpperCase(), moneyLabel(amount)].filter(Boolean);
  const pendingUpload =
    operation.status === "PENDING" || operation.sync_status === "pending_sync";
  return {
    title: parts.length ? parts.join(" - ") : `${operation.entity_type} - ${entityId}`,
    reason:
      reason ??
      (pendingUpload
        ? "Waiting for cloud backup. Press Force sync when backend is online."
        : "No detailed reason received from backend yet."),
    amount,
    mode,
    entityId,
  };
}

function conflictSubject(conflict: ConflictRow) {
  const local = isRecord(conflict.local_snapshot) ? conflict.local_snapshot : {};
  const server = isRecord(conflict.server_snapshot) ? conflict.server_snapshot : {};
  const name =
    readStringFromRecord(local, ["customerName", "customer_name", "name", "productName", "product_name"]) ??
    readStringFromRecord(server, ["customerName", "customer_name", "name", "productName", "product_name"]);
  const billNo =
    readStringFromRecord(local, ["billNo", "billNumber", "bill_no"]) ??
    readStringFromRecord(server, ["billNo", "billNumber", "bill_no"]);
  const amount =
    readNumberFromRecord(local, ["grandTotal", "grand_total", "totalAmount", "amount", "creditAmount", "credit_amount"]) ??
    readNumberFromRecord(server, ["grandTotal", "grand_total", "totalAmount", "amount", "creditAmount", "credit_amount"]);
  const parts = [name, billNo, moneyLabel(amount)].filter(Boolean);
  return {
    title: parts.length ? parts.join(" - ") : `${safeString(conflict.entity_type)} - ${safeString(conflict.entity_id)}`,
    reason: conflict.error_message ?? "Backend and local data did not match.",
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
  let subscriptionSyncAllowed = localSubscriptionAllowed;
  if (isOnline) {
    try {
      serverStatus = await getSyncStatus();
      if (serverStatus.allowed !== undefined)
        subscriptionSyncAllowed = serverStatus.allowed;
    } catch {
      // The page must still work offline or when the sync-status endpoint is unavailable.
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
    conflicts: conflictRows as ConflictRow[],
    lastSuccessfulSyncAt,
    deviceId: getOfflineScope().device_id,
    apiBaseUrl: getApiBaseUrl(),
    subscriptionSyncAllowed,
    serverStatus,
    localBusinessRowsCount,
  };
}

function StatusCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  description: string;
  icon: typeof CheckCircle2;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          <div className="rounded-full bg-primary/10 p-2 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
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
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>
          {operations.length === 0
            ? emptyText
            : `${operations.length} change${operations.length === 1 ? "" : "s"} listed here.`}
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
                    {getSimpleOperationName(operation.operation_type)}
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {operationSubject(operation).title}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {kind === "failed"
                      ? getFriendlyFailureMessage(operation)
                      : "Waiting for cloud backup."}
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
                      Retry this
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <a href={recordPath(operation.entity_type, operationSubject(operation).entityId)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </a>
                  </Button>
                  {onIgnoreOperation ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isSyncing}
                      onClick={() => onIgnoreOperation(operation.clientEventId)}
                    >
                      Ignore
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                <div>Entity: {operation.entity_type}</div>
                <div>Operation: {operation.operation_type}</div>
                <div>Item: {operationSubject(operation).entityId}</div>
                <div>Amount: {moneyLabel(operationSubject(operation).amount) ?? "-"}</div>
                <div>Retries: {operation.retry_count}</div>
                <div>Created: {formatTimeAgo(operation.client_created_at)}</div>
                <div>Reason: {operationSubject(operation).reason}</div>
              </div>
              {(operation.error_message || operation.last_error) && (
                <details className="mt-3 rounded-md bg-muted/60 p-3 text-xs">
                  <summary className="cursor-pointer font-medium text-muted-foreground">
                    Show technical details
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

function ConflictList({
  conflicts,
  onMarkResolved,
}: {
  conflicts: ConflictRow[];
  onMarkResolved?: (conflictId: string, resolution: "resolved_by_owner" | "ignored_by_owner") => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Conflicts</CardTitle>
        <CardDescription>
          {conflicts.length === 0
            ? "No cloud/local mismatch found."
            : "These items need owner review before backup can finish."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {conflicts.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No conflicts. Data is clean for sync.
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
                    Same data changed in shop and cloud
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {conflictSubject(conflict).title}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {safeString(conflict.entity_type)} -{" "}
                    {safeString(conflict.entity_id)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Needs review</Badge>
                  <Button asChild size="sm" variant="outline">
                    <a href={recordPath(conflict.entity_type, conflict.entity_id)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </a>
                  </Button>
                  {onMarkResolved ? (
                    <>
                      <Button size="sm" onClick={() => onMarkResolved(conflict.id, "resolved_by_owner")}>
                        Mark resolved
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onMarkResolved(conflict.id, "ignored_by_owner")}>
                        Ignore
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {conflictSubject(conflict).reason} Keep billing running; resolve this from Sync Status when you are ready.
              </p>
              <details className="mt-3 rounded-md bg-background/70 p-3 text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground">
                  Show technical details
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

  function save() {
    const trimmed = value.trim().replace(/\/$/, "");
    if (!trimmed) return;
    setApiBaseUrl(trimmed);
    onSaved();
    setEditing(false);
    toast({ title: "Server URL saved", description: "Reload the page for changes to take full effect." });
  }

  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Cloud className="h-4 w-4" /> Server URL
        </div>
        {!editing && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setValue(currentUrl); setEditing(true); }}>
            Edit
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
          <Button size="sm" className="h-9 text-xs" onClick={save}>Save</Button>
          <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
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
        title: "Internet offline, billing still works",
        tone: "offline" as const,
        icon: WifiOff,
      };
    if (!snapshot.isBackendReachable)
      return {
        title: "Backend offline, billing still works locally",
        tone: "offline" as const,
        icon: CloudOff,
      };
    if (failedCount > 0)
      return {
        title: "Sync failed, retry needed",
        tone: "failed" as const,
        icon: AlertCircle,
      };
    if (conflictCount > 0)
      return {
        title: "Backup paused: conflict needs review",
        tone: "conflict" as const,
        icon: AlertCircle,
      };
    if (pendingCount > 0)
      return {
        title: `${pendingCount} changes pending cloud backup`,
        tone: "pending" as const,
        icon: Cloud,
      };
    if (neverBackedUp)
      return {
        title: "Data safe locally, cloud backup not done yet",
        tone: "pending" as const,
        icon: Database,
      };
    return {
      title: "Data safe locally and backed up",
      tone: "ok" as const,
      icon: ShieldCheck,
    };
  }, [
    conflictCount,
    failedCount,
    neverBackedUp,
    pendingCount,
    snapshot.isOnline,
    snapshot.isBrowserOnline,
    snapshot.isBackendReachable,
  ]);

  const HeroIcon = hero.icon;

  const handleForceSync = async () => {
    if (!snapshot.isBrowserOnline) {
      toast({
        title: "Internet offline",
        description:
          "Billing still works. Cloud backup will start when internet returns.",
      });
      return;
    }
    if (!snapshot.isBackendReachable) {
      toast({
        title: "Backend offline",
        description:
          "Billing still works locally. Start backend server, then press Force sync.",
      });
      return;
    }
    setSnapshot((current) => ({ ...current, isSyncing: true }));
    try {
      const result = await runSyncCycle();
      toast({
        title: "Sync checked",
        description: `${result.pushed} backed up, ${result.pulled} downloaded, ${result.failed} failed.`,
      });
    } catch {
      toast({
        title: "Sync failed",
        description:
          "Could not complete cloud backup. Your data is still safe locally.",
      });
    } finally {
      setSnapshot((current) => ({ ...current, isSyncing: false }));
      await refresh();
    }
  };

  const handleRetryOne = async (clientEventId: string) => {
    if (!snapshot.isBrowserOnline) {
      toast({ title: "Internet offline", description: "This failed change will retry when internet returns." });
      return;
    }
    if (!snapshot.isBackendReachable) {
      toast({ title: "Backend offline", description: "Start backend server, then retry this change." });
      return;
    }
    setSnapshot((current) => ({ ...current, isSyncing: true }));
    try {
      const result = await retryFailedSyncOperations([clientEventId]);
      toast({
        title: "Retry checked",
        description: `${result.pushed} backed up, ${result.failed} still failed.`,
      });
    } catch {
      toast({
        title: "Retry failed",
        description: "Could not retry this change. Your local data was not removed.",
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
        title: "Queue item ignored",
        description: "The local business record was kept; only the stale backup queue item was removed.",
      });
    } catch {
      toast({
        title: "Could not ignore queue item",
        description: "Please retry after the local database is available.",
        variant: "destructive",
      });
    } finally {
      setSnapshot((current) => ({ ...current, isSyncing: false }));
      await refresh();
    }
  };

  const handleMarkConflictResolved = async (
    conflictId: string,
    resolution: "resolved_by_owner" | "ignored_by_owner",
  ) => {
    setSnapshot((current) => ({ ...current, isSyncing: true }));
    try {
      await offlineDB.init();
      const row = await dexieDB.sync_conflicts.get(conflictId);
      const scope = getOfflineScope();
      if (!row || row.tenant_id !== scope.tenant_id || row.store_id !== scope.store_id) throw new Error("Conflict not found");
      const now = new Date().toISOString();
      await dexieDB.sync_conflicts.put({
        ...row,
        resolution,
        sync_status: "synced",
        resolved_at: now,
        updated_at: now,
      });
      window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated"));
      toast({
        title: resolution === "resolved_by_owner" ? "Conflict marked resolved" : "Conflict ignored",
        description: "Sync Status will no longer block on this conflict row.",
      });
    } catch {
      toast({
        title: "Could not update conflict",
        description: "The conflict row is still unchanged.",
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
        title: "No blocked changes",
        description: "There is nothing to retry right now.",
      });
      return;
    }
    if (!snapshot.isBrowserOnline) {
      toast({
        title: "Internet offline",
        description: "Failed changes will retry after internet returns.",
      });
      return;
    }
    if (!snapshot.isBackendReachable) {
      toast({
        title: "Backend offline",
        description: "Start backend server, then retry failed cloud backup.",
      });
      return;
    }
    setSnapshot((current) => ({ ...current, isSyncing: true }));
    try {
      const result = await retryFailedSyncOperations();
      toast({
        title: "Retry started",
        description: `${result.pushed} backed up, ${result.failed} still need retry.`,
      });
    } catch {
      toast({
        title: "Retry failed",
        description:
          "Could not retry cloud backup. Your local data was not removed.",
      });
    } finally {
      setSnapshot((current) => ({ ...current, isSyncing: false }));
      await refresh();
    }
  };

  return (
    <PageShell className="space-y-6">
      <PageHeader
        title={<span className="flex items-center gap-3"><span className="rounded-full bg-primary/10 p-3 text-primary"><HeroIcon className="h-6 w-6" /></span>Sync Status</span>}
        description={hero.title}
        eyebrow={<SyncBadge status={snapshot.isOnline ? (failedCount > 0 ? "failed" : pendingCount > 0 ? "pending" : "synced") : "offline"} label={snapshot.isOnline ? (failedCount > 0 ? `${failedCount} failed cloud backup` : `${pendingCount} pending cloud backup`) : "Offline"} />}
        actions={(
          <>
            <Button variant="outline" onClick={() => void handleRetryFailed()} disabled={snapshot.isSyncing || retryableCount === 0}>
              {snapshot.isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              Retry blocked
            </Button>
            <Button onClick={() => void handleForceSync()} disabled={snapshot.isSyncing}>
              {snapshot.isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
              Force sync
            </Button>
          </>
        )}
      />

      {neverBackedUp && (
        <Alert>
          <Database className="h-4 w-4" />
          <AlertTitle>Local data has never been backed up</AlertTitle>
          <AlertDescription>
            Data safe locally. Connect internet and press Force sync to create
            the first cloud backup.
          </AlertDescription>
        </Alert>
      )}

      {!snapshot.isBrowserOnline && (
        <Alert>
          <WifiOff className="h-4 w-4" />
          <AlertTitle>Internet offline, billing still works</AlertTitle>
          <AlertDescription>
            You can keep making bills. Changes will stay on this device until
            internet returns.
          </AlertDescription>
        </Alert>
      )}

      {snapshot.isBrowserOnline && !snapshot.isBackendReachable && (
        <Alert>
          <CloudOff className="h-4 w-4" />
          <AlertTitle>Backend offline, billing still works locally</AlertTitle>
          <AlertDescription>
            Your internet is available, but the KiranaOS backend is not reachable at {snapshot.apiBaseUrl}. Start backend, then press Force sync.
          </AlertDescription>
        </Alert>
      )}

      {failedCount > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Sync failed, retry needed</AlertTitle>
          <AlertDescription>
            Your data was not deleted. Tap Retry failed after internet/backend
            is working.
          </AlertDescription>
        </Alert>
      )}

      {(failedCount > 0 || conflictCount > 0 || pendingCount > 0) && (
        <Card className="border-amber-200 bg-amber-50/60 dark:bg-amber-950/10">
          <CardHeader>
            <CardTitle className="text-lg">Needs attention</CardTitle>
            <CardDescription>
              Local changes waiting for backup, retry, or owner review.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {groupOperationsByType([...snapshot.pendingOperations, ...snapshot.failedOperations]).map(([group, count]) => (
                <Badge key={group} variant="outline">{group.replace(":", " - ")} x {count}</Badge>
              ))}
              {conflictCount > 0 && <Badge variant="destructive">conflicts x {conflictCount}</Badge>}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {[...snapshot.failedOperations, ...snapshot.pendingOperations].slice(0, 6).map((operation) => (
                <div key={operation.clientEventId} className="rounded-lg border bg-background p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{getSimpleOperationName(operation.operation_type)}</span>
                    <Badge variant={operation.status === "FAILED" ? "destructive" : "secondary"}>{operation.status}</Badge>
                  </div>
                  <div className="mt-1 text-muted-foreground">{operationSubject(operation).title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatTimeAgo(operation.client_created_at)} - {operationSubject(operation).reason}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {operation.status === "FAILED" ? (
                      <Button size="sm" variant="outline" disabled={snapshot.isSyncing} onClick={() => void handleRetryOne(operation.clientEventId)}>
                        Retry
                      </Button>
                    ) : null}
                    <Button asChild size="sm" variant="outline">
                      <a href={recordPath(operation.entity_type, operationSubject(operation).entityId)}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open record
                      </a>
                    </Button>
                    <Button size="sm" variant="ghost" disabled={snapshot.isSyncing} onClick={() => void handleIgnoreOperation(operation.clientEventId)}>
                      Ignore
                    </Button>
                  </div>
                </div>
              ))}
              {snapshot.conflicts.slice(0, 4).map((conflict) => (
                <div key={conflict.id} className="rounded-lg border border-amber-300/70 bg-background p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">Conflict</span>
                    <Badge variant="outline">Needs review</Badge>
                  </div>
                  <div className="mt-1 text-muted-foreground">{conflictSubject(conflict).title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{conflictSubject(conflict).reason}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <a href={recordPath(conflict.entity_type, conflict.entity_id)}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open record
                      </a>
                    </Button>
                    <Button size="sm" onClick={() => void handleMarkConflictResolved(conflict.id, "resolved_by_owner")}>
                      Mark resolved
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void handleMarkConflictResolved(conflict.id, "ignored_by_owner")}>
                      Ignore
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <StatsGrid>
        <StatCard label="Internet" value={snapshot.isBrowserOnline ? "Online" : "Offline"} description={snapshot.isBrowserOnline ? "Internet available." : "Billing still works locally."} icon={snapshot.isBrowserOnline ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />} tone={snapshot.isBrowserOnline ? "green" : "amber"} />
        <StatCard label="Backend" value={snapshot.isBackendReachable ? "Online" : "Offline"} description={snapshot.isBackendReachable ? "Cloud backup can run." : "Cloud backup paused; local billing works."} icon={snapshot.isBackendReachable ? <Cloud className="h-5 w-5" /> : <CloudOff className="h-5 w-5" />} tone={snapshot.isBackendReachable ? "green" : "amber"} />
        <StatCard label="Last backup" value={formatTimeAgo(snapshot.lastSuccessfulSyncAt)} description={snapshot.lastSuccessfulSyncAt ? "Last successful cloud backup." : "No successful backup found."} icon={<Cloud className="h-5 w-5" />} />
        <StatCard label="Pending" value={pendingCount} description={pendingCount === 1 ? "1 change pending cloud backup." : `${pendingCount} changes pending cloud backup.`} icon={<Database className="h-5 w-5" />} tone={pendingCount > 0 ? "amber" : "green"} />
        <StatCard label="Failed / conflicts" value={`${failedCount} / ${conflictCount}`} description="Retry failed changes. Review conflicts later." icon={<AlertCircle className="h-5 w-5" />} tone={failedCount || conflictCount ? "red" : "green"} />
      </StatsGrid>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Device and cloud settings</CardTitle>
          <CardDescription>
            Useful for checking which shop device is backing up data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Smartphone className="h-4 w-4" /> Device ID
              </div>
              <div className="mt-3 min-h-11 rounded-xl bg-muted/70 p-3 font-mono text-xs leading-relaxed break-all">
                {snapshot.deviceId}
              </div>
            </div>
            <ServerUrlEditor currentUrl={snapshot.apiBaseUrl} onSaved={() => setSnapshot((prev) => ({ ...prev, apiBaseUrl: getApiBaseUrl() }))} />
            <div className="rounded-xl border bg-background p-4 lg:col-span-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShieldCheck className="h-4 w-4" /> Subscription sync
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
                    ? "Sync not allowed"
                    : snapshot.subscriptionSyncAllowed === true
                      ? "Sync allowed"
                      : "Checking"}
                </Badge>
              </div>
            </div>
          </div>
          {snapshot.serverStatus && (
            <details className="mt-4 rounded-xl border bg-muted/50 p-4 text-xs">
              <summary className="cursor-pointer font-medium text-muted-foreground">
                Show server status details
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
          title="Pending operations"
          emptyText="No pending changes. Cloud backup queue is clear."
          operations={snapshot.pendingOperations}
          kind="pending"
          isSyncing={snapshot.isSyncing}
          onIgnoreOperation={(clientEventId) => void handleIgnoreOperation(clientEventId)}
        />
        <OperationList
          title="Failed operations"
          emptyText="No failed changes right now."
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
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Checking sync
          status...
        </div>
      )}
    </PageShell>
  );
}
