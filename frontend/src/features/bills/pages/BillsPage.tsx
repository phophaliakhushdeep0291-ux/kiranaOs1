import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CloudOff, Eye, FileText, Printer, RefreshCcw, RotateCcw, ShieldCheck, Trash2, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { offlineDB } from "@/lib/offline/db";
import { readInstantCache } from "@/lib/offline/instant-cache";
import { dedupeBillsForDisplay } from "@/features/sync/bill-reconciliation";
import { annotateBillSyncStatuses, repairStaleSyncedBillOutboxFailures } from "@/features/sync/sync-status-repair";
import type { PendingSyncEvent } from "@/lib/offline/db";
import { openPrintableBill, buildPrintableBillSnapshot } from "@/features/bills/print";
import { cancelBillWithOwnerPinLocalFirst, restoreBillWithOwnerPinLocalFirst, softDeleteBillWithOwnerPinLocalFirst } from "@/features/bills/local-actions";
import type { Bill } from "@/types/api";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { usePermission } from "@/features/staff/permissions";
import { useOfflineStatus } from "@/features/sync";
import { DataTableCard, EmptyState, FilterBar, PageHeader, PageShell, SearchInputWithIcon, SyncBadge } from "@/components/shared";

interface BillRecord extends Bill, Record<string, unknown> {}

type BillFilter = "all" | "paid" | "udhar" | "partial" | "rough" | "cancelled" | "pending_sync" | "deleted";
type PinAction = "cancel" | "delete" | "restore";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readNumber(value: unknown, fallback = 0) {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}

function billNo(bill: BillRecord) {
  return String(bill.billNumber ?? bill.billNo ?? bill.id);
}

function billDate(bill: BillRecord) {
  return String(bill.createdAt ?? bill.created_at ?? "");
}

function billTotal(bill: BillRecord) {
  return readNumber(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount, 0);
}

function billPaid(bill: BillRecord) {
  const embedded = Array.isArray(bill.payments) ? bill.payments : [];
  const embeddedPaid = embedded.reduce<number>((sum, raw) => {
    const payment = asRecord(raw);
    return String(payment.mode ?? "") === "credit" ? sum : sum + readNumber(payment.amount, 0);
  }, 0);
  return Math.max(readNumber(bill.paidAmount ?? bill.buyerPaidAmount, 0), embeddedPaid);
}

function billCredit(bill: BillRecord) {
  return readNumber(bill.creditAmount, Math.max(0, billTotal(bill) - billPaid(bill)));
}

function isDeleted(bill: BillRecord) {
  return typeof bill.deleted_at === "string" || typeof bill.deletedAt === "string";
}

function syncStatusOf(bill: BillRecord) {
  return String(bill.sync_status ?? bill.status ?? "synced");
}

function paymentStatusOf(bill: BillRecord) {
  if (bill.status === "cancelled") return "Cancelled";
  if (bill.billType === "estimate") return "Rough/Estimate";
  const paid = billPaid(bill);
  const credit = billCredit(bill);
  const total = billTotal(bill);
  if (credit > 0 && paid > 0) return "Partial";
  if (credit > 0) return "Udhar";
  if (paid >= total && total > 0) return "Paid";
  return "Pending";
}

function money(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

async function loadBills(): Promise<BillRecord[]> {
  await repairStaleSyncedBillOutboxFailures().catch(() => 0);
  const [dbRows, outboxRows] = await Promise.all([
    offlineDB.getAll<BillRecord>("bills").catch(() => []),
    offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
  ]);
  const cached = readInstantCache<BillRecord[]>("bills", []);
  const merged = new Map<string, BillRecord>();
  for (const row of cached) merged.set(row.id, row);
  for (const row of dbRows) merged.set(row.id, row);
  const rows = Array.from(merged.values());
  const displayRows = dedupeBillsForDisplay(rows.filter((row) => !isDeleted(row))) as unknown as BillRecord[];
  const annotatedDisplayRows = annotateBillSyncStatuses(displayRows, outboxRows) as BillRecord[];
  const deletedRows = annotateBillSyncStatuses(rows.filter(isDeleted), outboxRows) as BillRecord[];
  return [...annotatedDisplayRows, ...deletedRows].sort((a, b) => billDate(b).localeCompare(billDate(a)));
}

function useLocalBills() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["local-bills-history"] });
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [queryClient]);
  return useQuery({ queryKey: ["local-bills-history"], queryFn: loadBills, staleTime: 2_000 });
}

export default function BillsPage() {
  const { toast } = useToast();
  const cancelPermission = usePermission("cancel_bill");
  const { isOnline, isBrowserOnline, isSyncing } = useOfflineStatus();
  const { data: bills = [], isLoading, refetch } = useLocalBills();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<BillFilter>("all");
  const [date, setDate] = useState("");
  const [pinAction, setPinAction] = useState<{ action: PinAction; bill: BillRecord } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills.filter((bill) => {
      const status = paymentStatusOf(bill).toLowerCase();
      const sync = syncStatusOf(bill);
      const deleted = isDeleted(bill);
      const matchesSearch = !q || billNo(bill).toLowerCase().includes(q) || String(bill.customerName ?? "walk-in").toLowerCase().includes(q) || String(bill.customerMobile ?? "").includes(q);
      const matchesDate = !date || billDate(bill).slice(0, 10) === date;
      const matchesFilter =
        filter === "all" ? !deleted :
        filter === "paid" ? status === "paid" && !deleted :
        filter === "udhar" ? status === "udhar" && !deleted :
        filter === "partial" ? status === "partial" && !deleted :
        filter === "rough" ? bill.billType === "estimate" && !deleted :
        filter === "cancelled" ? bill.status === "cancelled" && !deleted :
        filter === "pending_sync" ? ["pending_sync", "syncing", "failed", "conflict"].includes(sync) && !deleted :
        filter === "deleted" ? deleted : true;
      return matchesSearch && matchesDate && matchesFilter;
    });
  }, [bills, date, filter, search]);

  const counts = useMemo(() => ({
    pending: bills.filter((bill) => ["pending_sync", "syncing", "failed", "conflict"].includes(syncStatusOf(bill)) && !isDeleted(bill)).length,
    udhar: bills.filter((bill) => paymentStatusOf(bill) === "Udhar" && !isDeleted(bill)).length,
    deleted: bills.filter(isDeleted).length,
  }), [bills]);
  const backupStatus = isOnline
    ? {
        icon: Wifi,
        label: isSyncing ? "Backing up" : "Online backup",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      }
    : isBrowserOnline
      ? {
          icon: CloudOff,
          label: "Backup reconnecting",
          className: "border-amber-200 bg-amber-50 text-amber-700",
        }
      : {
          icon: WifiOff,
          label: "Offline ready",
          className: "border-slate-200 bg-slate-50 text-slate-700",
        };
  const BackupStatusIcon = backupStatus.icon;

  function printBill(bill: BillRecord) {
    const ok = openPrintableBill(buildPrintableBillSnapshot(bill));
    if (!ok) toast({ title: "Print blocked", description: "Allow pop-ups to print or save PDF.", variant: "destructive" });
  }

  function sharePdfArchitecture() {
    toast({ title: "PDF/share architecture ready", description: "This bill snapshot can be rendered to PDF and shared by WhatsApp/email after adding a PDF blob service." });
  }

  function requestPinAction(action: PinAction, bill: BillRecord) {
    if (action === "cancel" && !cancelPermission.allowed) {
      toast({ title: "Permission denied", description: cancelPermission.reason, variant: "destructive" });
      return;
    }
    setPinAction({ action, bill });
  }

  async function runPinAction(ownerPin: string, reason: string) {
    if (!pinAction) return;
    setIsSaving(true);
    try {
      if (pinAction.action === "cancel") await cancelBillWithOwnerPinLocalFirst(pinAction.bill.id, ownerPin, reason);
      if (pinAction.action === "delete") await softDeleteBillWithOwnerPinLocalFirst(pinAction.bill.id, ownerPin, reason);
      if (pinAction.action === "restore") await restoreBillWithOwnerPinLocalFirst(pinAction.bill.id, ownerPin, reason);
      toast({ title: "Saved locally", description: "Data safe locally. Cloud backup will happen automatically when sync is available." });
      setPinAction(null);
      await refetch();
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : "Please check owner PIN and try again.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Bill History"
        description="Search bills, print duplicate copies, cancel with owner PIN, and restore soft-deleted records."
        actions={(
          <>
            <Badge variant="outline" className={backupStatus.className}>
              <BackupStatusIcon size={13} className="mr-1" />
              {backupStatus.label}
            </Badge>
            <SyncBadge status={counts.pending > 0 ? "pending" : "synced"} label={`${counts.pending} unsynced`} />
            <Badge variant="outline">{counts.udhar} udhar bills</Badge>
            <Badge variant="outline">{counts.deleted} in recycle bin</Badge>
          </>
        )}
      />

      <FilterBar actions={<Button className="h-11" variant="outline" onClick={() => { setSearch(""); setFilter("all"); setDate(""); void refetch(); }}><RefreshCcw size={15} className="mr-1" />Reset</Button>}>
        <SearchInputWithIcon id="bill-history-search" label="Search bills" className="h-11" placeholder="Bill number, customer, mobile..." value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select value={filter} onValueChange={(value) => setFilter(value as BillFilter)}>
          <SelectTrigger className="h-11 w-full sm:w-52"><SelectValue placeholder="Filter" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Active bills</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="udhar">Udhar</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="rough">Rough / estimate</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="pending_sync">Pending sync</SelectItem>
            <SelectItem value="deleted">Recycle bin</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative w-full sm:w-48">
          <label htmlFor="bill-date-filter" className="sr-only">Filter bills by date</label>
          <CalendarDays size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="bill-date-filter" type="date" className="h-11 pl-9" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
      </FilterBar>

      <DataTableCard title={`${filtered.length} bills found`} loading={isLoading} empty={!isLoading && filtered.length === 0} emptyState={<EmptyState title="No bills found" description="Billing still works offline. Try clearing filters or create a new bill." />}>
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Bill</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Payment</th>
                  <th className="px-4 py-3 text-left">Sync</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((bill) => {
                  const deleted = isDeleted(bill);
                  return (
                    <tr key={bill.id} className={`border-t ${deleted ? "bg-muted/40 opacity-80" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{billNo(bill)}</div>
                        <div className="text-xs text-muted-foreground">{billDate(bill) ? new Date(billDate(bill)).toLocaleString("en-IN") : "No date"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{bill.customerName || "Walk-in"}</div>
                        <div className="text-xs text-muted-foreground">{bill.customerMobile || "No mobile"}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{money(billTotal(bill))}</td>
                      <td className="px-4 py-3">
                        <Badge variant={paymentStatusOf(bill) === "Paid" ? "default" : paymentStatusOf(bill) === "Cancelled" ? "destructive" : "secondary"}>{paymentStatusOf(bill)}</Badge>
                        <div className="text-xs text-muted-foreground mt-1">Paid {money(billPaid(bill))} • Udhar {money(billCredit(bill))}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={syncStatusOf(bill) === "synced" ? "outline" : "secondary"}>{syncStatusOf(bill).replaceAll("_", " ")}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Link href={`/bills/${bill.id}`}><Button size="sm" variant="outline"><Eye size={14} /></Button></Link>
                          <Button size="sm" variant="outline" onClick={() => printBill(bill)}><Printer size={14} /></Button>
                          <Button size="sm" variant="outline" onClick={sharePdfArchitecture}><FileText size={14} /></Button>
                          {deleted ? (
                            <Button size="sm" variant="outline" onClick={() => requestPinAction("restore", bill)}><RotateCcw size={14} /></Button>
                          ) : (
                            <>
                              {bill.status !== "cancelled" && <Button size="sm" variant="outline" onClick={() => requestPinAction("cancel", bill)}><ShieldCheck size={14} /></Button>}
                              <Button size="sm" variant="outline" onClick={() => requestPinAction("delete", bill)}><Trash2 size={14} /></Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        </DataTableCard>

      <OwnerPinModal
        open={!!pinAction}
        onCancel={() => setPinAction(null)}
        title={pinAction?.action === "restore" ? "Restore bill" : pinAction?.action === "cancel" ? "Cancel bill" : "Move bill to recycle bin"}
        description="Owner PIN is required. Financial records are never hard deleted and this action is saved locally first."
        confirmLabel={pinAction?.action === "restore" ? "Restore" : pinAction?.action === "cancel" ? "Cancel bill" : "Move to recycle bin"}
        reasonRequired={pinAction?.action === "cancel" || pinAction?.action === "delete"}
        loading={isSaving}
        onConfirm={({ ownerPin, reason }) => runPinAction(ownerPin, reason)}
      />
    </PageShell>
  );
}
