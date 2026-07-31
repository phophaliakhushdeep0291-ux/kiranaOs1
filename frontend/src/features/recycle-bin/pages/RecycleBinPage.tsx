import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArchiveRestore, RefreshCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { offlineDB } from "@/lib/offline/db";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { restoreBillWithOwnerPinLocalFirst } from "@/features/bills/local-actions";
import { isMergedBillTwin } from "@/features/sync/bill-reconciliation";
import { permanentDeleteDisabledMessage, restoreEntityFromRecycleBinLocalFirst, type RecyclableEntityType } from "@/features/recycle-bin/local-actions";
import { DataTableCard, EmptyState, FilterBar, PageHeader, PageShell, SearchInputWithIcon, SyncBadge } from "@/components/shared";

interface RecycleRow extends Record<string, unknown> {
  id: string;
  entityType: "bill" | "customer" | "product" | "supplier";
  label: string;
  deletedAt: string;
  amount?: number;
  syncStatus: string;
  reason?: string;
}

type EntityFilter = "all" | "bill" | "customer" | "product" | "supplier" | "pending_sync";

function isDeleted(row: Record<string, unknown>) {
  return typeof row.deleted_at === "string" || typeof row.deletedAt === "string";
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function deletedDate(row: Record<string, unknown>) {
  return asString(row.deleted_at, asString(row.deletedAt, asString(row.updated_at, asString(row.updatedAt))));
}

function toRecycleRow(entityType: RecycleRow["entityType"], row: Record<string, unknown>): RecycleRow {
  const id = asString(row.id, asString(row.local_id, asString(row.server_id)));
  const label = entityType === "bill"
    ? asString(row.billNumber, asString(row.billNo, id))
    : asString(row.name, id);
  return {
    ...row,
    id,
    entityType,
    label,
    deletedAt: deletedDate(row),
    amount: entityType === "bill" ? asNumber(row.grandTotal ?? row.totalAmount ?? row.netAmount, 0) : undefined,
    syncStatus: asString(row.sync_status, "synced"),
    reason: asString(row.deleteReason ?? row.reason ?? row.note),
  };
}

async function loadRecycleRows(): Promise<RecycleRow[]> {
  const [bills, customers, products, suppliers] = await Promise.all([
    offlineDB.getAll<Record<string, unknown>>("bills").catch(() => []),
    offlineDB.getAll<Record<string, unknown>>("customers").catch(() => []),
    offlineDB.getAll<Record<string, unknown>>("products").catch(() => []),
    offlineDB.getAll<Record<string, unknown>>("suppliers").catch(() => []),
  ]);
  return [
    // A merge twin is the local optimistic row tombstoned once its server copy synced
    // back — a sync artifact, never something the user deleted. Without this filter the
    // bin lists one phantom per synced bill, under its pre-sync PENDING-/LOCAL- number.
    ...bills.filter((row) => isDeleted(row) && !isMergedBillTwin(row)).map((row) => toRecycleRow("bill", row)),
    ...customers.filter(isDeleted).map((row) => toRecycleRow("customer", row)),
    ...products.filter(isDeleted).map((row) => toRecycleRow("product", row)),
    ...suppliers.filter(isDeleted).map((row) => toRecycleRow("supplier", row)),
  ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

function useRecycleRows() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["recycle-bin"] });
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [queryClient]);
  return useQuery({ queryKey: ["recycle-bin"], queryFn: loadRecycleRows, staleTime: 2_000 });
}

function money(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function dateText(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString("en-IN");
}

export default function RecycleBinPage() {
  const { toast } = useToast();
  const { data: rows = [], isLoading, refetch } = useRecycleRows();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<EntityFilter>("all");
  const [pinTarget, setPinTarget] = useState<RecycleRow | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch = !q || row.label.toLowerCase().includes(q) || row.id.toLowerCase().includes(q) || row.entityType.includes(q);
      const matchesFilter = filter === "all" ? true : filter === "pending_sync" ? ["pending_sync", "syncing", "failed", "conflict"].includes(row.syncStatus) : row.entityType === filter;
      return matchesSearch && matchesFilter;
    });
  }, [filter, rows, search]);

  const financialCount = rows.filter((row) => row.entityType === "bill").length;
  const pendingCount = rows.filter((row) => ["pending_sync", "syncing", "failed", "conflict"].includes(row.syncStatus)).length;

  async function restoreWithPin(ownerPin: string, reason: string) {
    if (!pinTarget) return;
    setSaving(true);
    try {
      if (pinTarget.entityType === "bill") await restoreBillWithOwnerPinLocalFirst(pinTarget.id, ownerPin, reason);
      else await restoreEntityFromRecycleBinLocalFirst(pinTarget.entityType as RecyclableEntityType, pinTarget.id, ownerPin, reason);
      toast({ title: "Restored locally", description: "Data safe locally. Restore will be backed up during sync." });
      setPinTarget(null);
      await refetch();
    } catch (error) {
      toast({ title: "Restore failed", description: error instanceof Error ? error.message : "Please check owner PIN and try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Recycle Bin"
        description="Deleted shop records stay safe locally. Restore needs owner approval."
        actions={(
          <>
            <Badge variant="outline"><Trash2 size={13} className="mr-1" />{rows.length} deleted records</Badge>
            <Badge variant={financialCount > 0 ? "secondary" : "outline"}>{financialCount} financial records</Badge>
            <SyncBadge status={pendingCount > 0 ? "pending" : "synced"} label={`${pendingCount} pending sync`} />
          </>
        )}
      />

      <Card className="border-amber-200 bg-amber-50/60">
        <CardContent className="pt-5 text-sm text-amber-900">
          <div className="flex gap-2"><AlertTriangle size={18} className="mt-0.5" /><div><b>Safety rule:</b> financial records are soft-deleted only. Permanent delete is disabled for normal staff and should be enforced by backend retention policy.</div></div>
        </CardContent>
      </Card>

      <FilterBar actions={<Button variant="outline" onClick={() => void refetch()}><RefreshCcw size={15} className="mr-1" />Refresh</Button>}>
        <SearchInputWithIcon label="Search recycle bin" placeholder="Search deleted bill, customer, product, supplier..." value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select value={filter} onValueChange={(value) => setFilter(value as EntityFilter)}>
          <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All deleted records</SelectItem>
            <SelectItem value="bill">Bills</SelectItem>
            <SelectItem value="customer">Customers</SelectItem>
            <SelectItem value="product">Products</SelectItem>
            <SelectItem value="supplier">Suppliers</SelectItem>
            <SelectItem value="pending_sync">Pending sync</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTableCard title={`${filtered.length} deleted records`} loading={isLoading} empty={!isLoading && filtered.length === 0} emptyState={<EmptyState title="Recycle bin is empty" description="Soft-deleted shop records will appear here." />}>
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Record</th>
                  <th className="px-4 py-3 text-left">Deleted time</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                  <th className="px-4 py-3 text-left">Sync</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={`${row.entityType}:${row.id}`} className="border-t">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2"><Badge variant="outline" className="capitalize">{row.entityType}</Badge><span className="font-medium">{row.label}</span></div>
                      <div className="text-xs text-muted-foreground break-all">{row.id}</div>
                      {typeof row.amount === "number" && <div className="text-xs text-muted-foreground">Amount {money(row.amount)}</div>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{dateText(row.deletedAt)}</td>
                    <td className="px-4 py-3 max-w-[320px]">{row.reason || "No reason added"}</td>
                    <td className="px-4 py-3"><Badge variant={row.syncStatus === "synced" ? "outline" : row.syncStatus === "failed" || row.syncStatus === "conflict" ? "destructive" : "secondary"}>{row.syncStatus.replaceAll("_", " ")}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => setPinTarget(row)}><ArchiveRestore size={14} className="mr-1" />Restore</Button>
                        <Button size="sm" variant="outline" disabled title={permanentDeleteDisabledMessage(row.entityType)}><ShieldCheck size={14} className="mr-1" />Permanent delete disabled</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </DataTableCard>

      <OwnerPinModal
        open={Boolean(pinTarget)}
        title="Owner approval required"
        description="Restoring deleted shop records needs owner PIN. This action is saved in audit logs."
        confirmLabel="Restore"
        reasonRequired
        loading={saving}
        onCancel={() => setPinTarget(null)}
        onConfirm={({ ownerPin, reason }) => restoreWithPin(ownerPin, reason)}
      />
    </PageShell>
  );
}
