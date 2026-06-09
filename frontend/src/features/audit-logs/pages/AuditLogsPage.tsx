import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Filter, RefreshCcw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";


import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { offlineDB } from "@/lib/offline/db";
import type { AuditLogRow } from "@/features/audit-logs/local-actions";
import { DataTableCard, EmptyState, FilterBar, PageHeader, PageShell, SearchInputWithIcon, SyncBadge } from "@/components/shared";

type AuditFilter = "all" | "bills" | "payments" | "customers" | "products" | "inventory" | "staff" | "owner_pin" | "subscription" | "device" | "conflicts" | "pending_sync";

interface ConflictRow extends Record<string, unknown> {
  id: string;
  entity_type?: string;
  entity_id?: string;
  created_at?: string;
  sync_status?: string;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function formatAction(value: unknown) {
  return asString(value, "audit_action").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value: unknown) {
  const raw = asString(value);
  if (!raw) return "No time";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString("en-IN");
}

function syncBadgeVariant(status: string) {
  if (["synced", "SYNCED"].includes(status)) return "outline" as const;
  if (["failed", "FAILED", "conflict", "CONFLICT"].includes(status)) return "destructive" as const;
  return "secondary" as const;
}

function compactJson(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not available";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function loadAuditRows(): Promise<AuditLogRow[]> {
  const auditRows = await offlineDB.getAll<AuditLogRow>("local_audit_logs").catch(() => []);
  const conflictRows = await offlineDB.getAll<ConflictRow>("sync_conflicts").catch(() => []);
  const conflictAuditRows: AuditLogRow[] = conflictRows.map((conflict) => ({
    id: `audit_${conflict.id}`,
    action: "sync_conflict",
    entity_type: asString(conflict.entity_type, "sync_conflict"),
    entity_id: asString(conflict.entity_id, conflict.id),
    entity_label: asString(conflict.entity_type, "Entity"),
    actor_id: "sync-engine",
    actor_name: "Sync engine",
    device_id: asString(conflict.device_id, "current device"),
    reason: asString(conflict.reason ?? conflict.error_message, "Server and local data need review."),
    old_value: conflict.local_snapshot ?? null,
    new_value: conflict.server_snapshot ?? null,
    summary: `Sync conflict for ${asString(conflict.entity_type, "entity")}`,
    created_at: asString(conflict.created_at, new Date().toISOString()),
    updated_at: asString(conflict.updated_at, asString(conflict.created_at, new Date().toISOString())),
    sync_status: "conflict",
  }));
  return [...auditRows, ...conflictAuditRows].sort((a, b) => asString(b.created_at).localeCompare(asString(a.created_at)));
}

function useAuditRows() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [queryClient]);
  return useQuery({ queryKey: ["audit-logs"], queryFn: loadAuditRows, staleTime: 2_000 });
}

export default function AuditLogsPage() {
  const { data: rows = [], isLoading, refetch } = useAuditRows();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AuditFilter>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const action = row.action.toLowerCase();
      const entityType = asString(row.entity_type).toLowerCase();
      const sync = asString(row.sync_status, "synced").toLowerCase();
      const matchesSearch = !q || [row.action, row.entity_type, row.entity_id, row.entity_label, row.actor_name, row.reason, row.summary]
        .some((value) => asString(value).toLowerCase().includes(q));
      const matchesFilter =
        filter === "all" ? true :
        filter === "bills" ? entityType === "bill" || action.includes("bill") :
        filter === "payments" ? entityType === "payment" || action.includes("payment") :
        filter === "customers" ? entityType === "customer" || action.includes("customer") :
        filter === "products" ? entityType === "product" || action.includes("product") :
        filter === "inventory" ? entityType.includes("inventory") || action.includes("stock") :
        filter === "staff" ? entityType === "staff" || action.includes("staff") :
        filter === "owner_pin" ? Boolean(row.owner_pin_provided) || action.includes("owner_pin") :
        filter === "subscription" ? entityType === "subscription" || action.includes("subscription") :
        filter === "device" ? entityType.includes("device") || action.includes("device") :
        filter === "conflicts" ? action.includes("conflict") || sync === "conflict" :
        filter === "pending_sync" ? ["pending_sync", "syncing", "failed", "conflict"].includes(sync) : true;
      return matchesSearch && matchesFilter;
    });
  }, [filter, rows, search]);

  const pendingCount = rows.filter((row) => ["pending_sync", "syncing", "failed", "conflict"].includes(asString(row.sync_status).toLowerCase())).length;
  const ownerPinCount = rows.filter((row) => Boolean(row.owner_pin_provided)).length;
  const conflictCount = rows.filter((row) => row.action === "sync_conflict" || asString(row.sync_status).toLowerCase() === "conflict").length;

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Audit Logs"
        description="Every sensitive shop action is saved locally first and backed up during sync."
        actions={(
          <>
            <Badge variant="outline"><Activity size={13} className="mr-1" />{rows.length} actions</Badge>
            <SyncBadge status={pendingCount > 0 ? "pending" : "synced"} label={`${pendingCount} pending backup`} />
            <Badge variant="outline"><ShieldCheck size={13} className="mr-1" />{ownerPinCount} PIN actions</Badge>
            <Badge variant={conflictCount > 0 ? "destructive" : "outline"}><AlertTriangle size={13} className="mr-1" />{conflictCount} conflicts</Badge>
          </>
        )}
      />

      <FilterBar actions={<Button variant="outline" onClick={() => void refetch()}><RefreshCcw size={15} className="mr-1" />Refresh</Button>}>
        <SearchInputWithIcon label="Search audit logs" placeholder="Search action, user, entity, reason..." value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select value={filter} onValueChange={(value) => setFilter(value as AuditFilter)}>
          <SelectTrigger className="w-full sm:w-60"><SelectValue placeholder="Filter logs" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="bills">Bills</SelectItem>
            <SelectItem value="payments">Payments</SelectItem>
            <SelectItem value="customers">Customers</SelectItem>
            <SelectItem value="products">Products</SelectItem>
            <SelectItem value="inventory">Inventory</SelectItem>
            <SelectItem value="staff">Staff</SelectItem>
            <SelectItem value="owner_pin">Owner PIN actions</SelectItem>
            <SelectItem value="subscription">Subscription</SelectItem>
            <SelectItem value="device">Devices</SelectItem>
            <SelectItem value="conflicts">Sync conflicts</SelectItem>
            <SelectItem value="pending_sync">Pending backup</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTableCard title={<span className="flex items-center gap-2"><Filter size={17} />{filtered.length} audit entries</span>} loading={isLoading} empty={!isLoading && filtered.length === 0} emptyState={<EmptyState title="No audit logs found" description="Sensitive actions will appear here after they are recorded." />}>
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">User / Device</th>
                  <th className="px-4 py-3 text-left">Entity</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                  <th className="px-4 py-3 text-left">Time</th>
                  <th className="px-4 py-3 text-left">Sync</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const sync = asString(row.sync_status, "synced");
                  return (
                    <tr key={row.id} className="border-t align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium">{formatAction(row.action)}</div>
                        {row.owner_pin_provided && <Badge variant="secondary" className="mt-1">Owner PIN</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <div>{asString(row.actor_name, asString(row.actor_id, "Local user"))}</div>
                        <div className="text-xs text-muted-foreground break-all">{asString(row.device_id, "Unknown device")}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium capitalize">{asString(row.entity_type, "entity").replaceAll("_", " ")}</div>
                        <div className="text-xs text-muted-foreground break-all">{asString(row.entity_label, asString(row.entity_id))}</div>
                      </td>
                      <td className="px-4 py-3 max-w-[320px]">
                        <div>{asString(row.reason, asString(row.summary, "No reason added"))}</div>
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-muted-foreground">Old/new values</summary>
                          <div className="mt-2 grid gap-2 lg:grid-cols-2">
                            <pre className="max-h-52 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap">{compactJson(row.old_value)}</pre>
                            <pre className="max-h-52 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap">{compactJson(row.new_value)}</pre>
                          </div>
                        </details>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatDate(row.created_at)}</td>
                      <td className="px-4 py-3"><Badge variant={syncBadgeVariant(sync)}>{sync.replaceAll("_", " ")}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        </DataTableCard>
    </PageShell>
  );
}
