import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban, CalendarDays, CheckCircle2, Clock3, CloudOff, Download, Eye, FileText, IndianRupee,
  Printer, ReceiptText, RefreshCcw, RotateCcw, Search, ShieldCheck, Trash2, Wallet, Wifi, WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";

interface BillRecord extends Bill, Record<string, unknown> {}

type BillFilter = "all" | "paid" | "udhar" | "partial" | "rough" | "cancelled" | "pending_sync" | "deleted";
type ModeFilter = "all" | "cash" | "upi" | "udhar";
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

function paymentModeOf(bill: BillRecord) {
  const payments = Array.isArray(bill.payments) ? bill.payments.map(asRecord) : [];
  const nonCredit = payments.find((p) => String(p.mode ?? "") !== "credit" && readNumber(p.amount) > 0);
  if (nonCredit) return String(nonCredit.mode);
  if (payments.some((p) => String(p.mode ?? "") === "credit") || (billCredit(bill) > 0 && billPaid(bill) === 0)) return "udhar";
  return String(bill.paymentMode ?? "cash");
}

function itemsCount(bill: BillRecord) {
  return Array.isArray(bill.items) ? bill.items.length : null;
}

function money(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

const STATUS_CLS: Record<string, string> = {
  Paid: "bg-emerald-100 text-emerald-700",
  Partial: "bg-amber-100 text-amber-700",
  Udhar: "bg-orange-100 text-orange-700",
  Pending: "bg-[#eef2f8] text-[#64748b]",
  Cancelled: "bg-rose-100 text-rose-700",
  "Rough/Estimate": "bg-violet-100 text-violet-700",
};
const MODE_CLS: Record<string, string> = {
  cash: "bg-emerald-50 text-emerald-700",
  upi: "bg-violet-50 text-violet-700",
  udhar: "bg-amber-50 text-amber-700",
  card: "bg-[#eef5ff] text-[#0057ff]",
  bank: "bg-[#eef5ff] text-[#0057ff]",
};

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
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
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
      const matchesMode = modeFilter === "all" || paymentModeOf(bill) === modeFilter;
      const matchesFilter =
        filter === "all" ? !deleted :
        filter === "paid" ? status === "paid" && !deleted :
        filter === "udhar" ? status === "udhar" && !deleted :
        filter === "partial" ? status === "partial" && !deleted :
        filter === "rough" ? bill.billType === "estimate" && !deleted :
        filter === "cancelled" ? bill.status === "cancelled" && !deleted :
        filter === "pending_sync" ? ["pending_sync", "syncing", "failed", "conflict"].includes(sync) && !deleted :
        filter === "deleted" ? deleted : true;
      return matchesSearch && matchesDate && matchesMode && matchesFilter;
    });
  }, [bills, date, filter, modeFilter, search]);

  const counts = useMemo(() => ({
    pending: bills.filter((bill) => ["pending_sync", "syncing", "failed", "conflict"].includes(syncStatusOf(bill)) && !isDeleted(bill)).length,
    deleted: bills.filter(isDeleted).length,
  }), [bills]);

  const stats = useMemo(() => {
    const active = bills.filter((bill) => !isDeleted(bill));
    const todayKey = new Date().toDateString();
    const todayRows = active.filter((bill) => billDate(bill) && new Date(billDate(bill)).toDateString() === todayKey);
    const todaySales = todayRows.filter((bill) => bill.status !== "cancelled" && bill.billType !== "estimate").reduce((sum, bill) => sum + billTotal(bill), 0);
    const real = active.filter((bill) => bill.status !== "cancelled" && bill.billType !== "estimate");
    const paidCount = active.filter((bill) => paymentStatusOf(bill) === "Paid").length;
    const udharCount = active.filter((bill) => paymentStatusOf(bill) === "Udhar" || paymentStatusOf(bill) === "Partial").length;
    const cancelledCount = active.filter((bill) => bill.status === "cancelled").length;
    const pct = (n: number) => (active.length ? Math.round((n / active.length) * 1000) / 10 : 0);
    return {
      todayCount: todayRows.length,
      todaySales,
      paidCount, paidPct: pct(paidCount),
      udharCount, udharPct: pct(udharCount),
      cancelledCount, cancelledPct: pct(cancelledCount),
      avg: real.length ? real.reduce((sum, bill) => sum + billTotal(bill), 0) / real.length : 0,
    };
  }, [bills]);

  const backupStatus = isOnline
    ? { icon: Wifi, label: isSyncing ? "Backing up…" : "Synced", cls: "bg-emerald-50 text-emerald-700" }
    : isBrowserOnline
      ? { icon: CloudOff, label: "Reconnecting", cls: "bg-amber-50 text-amber-700" }
      : { icon: WifiOff, label: "Offline ready", cls: "bg-[#eef2f8] text-[#64748b]" };
  const BackupStatusIcon = backupStatus.icon;

  function printBill(bill: BillRecord) {
    const ok = openPrintableBill(buildPrintableBillSnapshot(bill));
    if (!ok) toast({ title: "Print blocked", description: "Allow pop-ups to print or save PDF.", variant: "destructive" });
  }

  function sharePdfArchitecture() {
    toast({ title: "PDF/share architecture ready", description: "This bill snapshot can be rendered to PDF and shared by WhatsApp/email after adding a PDF blob service." });
  }

  function exportCsv() {
    const header = ["Bill No", "Date", "Customer", "Mobile", "Items", "Total", "Paid", "Due", "Mode", "Status", "Sync"];
    const lines = filtered.map((bill) => [
      billNo(bill), billDate(bill) ? new Date(billDate(bill)).toLocaleString("en-IN") : "", String(bill.customerName ?? "Walk-in"),
      String(bill.customerMobile ?? ""), itemsCount(bill) ?? "", billTotal(bill), billPaid(bill), billCredit(bill),
      paymentModeOf(bill), paymentStatusOf(bill), syncStatusOf(bill),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "kirana-bills.csv"; a.click();
    URL.revokeObjectURL(url);
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
    <div className="min-h-full bg-[#f7f9fd] px-4 py-4">
      <div className="space-y-4">
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi icon={<ReceiptText size={15} />} iconBg="bg-[#eef5ff] text-[#0057ff]" label="Today's Bills" value={String(stats.todayCount)} sub="created today" loading={isLoading} />
          <Kpi icon={<IndianRupee size={15} />} iconBg="bg-emerald-50 text-emerald-600" label="Total Sales (Today)" value={money(stats.todaySales)} sub="excl. estimates" loading={isLoading} />
          <Kpi icon={<CheckCircle2 size={15} />} iconBg="bg-emerald-50 text-emerald-600" label="Paid Bills" value={String(stats.paidCount)} sub={`${stats.paidPct}% of total bills`} loading={isLoading} />
          <Kpi icon={<Wallet size={15} />} iconBg="bg-amber-50 text-amber-600" label="Udhar Bills" value={String(stats.udharCount)} sub={`${stats.udharPct}% of total bills`} loading={isLoading} />
          <Kpi icon={<Ban size={15} />} iconBg="bg-rose-50 text-rose-600" label="Cancelled Bills" value={String(stats.cancelledCount)} sub={`${stats.cancelledPct}% of total bills`} loading={isLoading} />
          <Kpi icon={<Clock3 size={15} />} iconBg="bg-violet-50 text-violet-600" label="Avg. Bill Value" value={money(stats.avg)} sub="active sale bills" loading={isLoading} />
        </div>

        {/* Filter toolbar */}
        <div className="flex flex-col gap-3 rounded-[14px] border border-[#e6ecf4] bg-white p-3 shadow-[0_8px_24px_rgba(15,35,80,0.04)] xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
            <Input className="h-10 pl-9" placeholder="Search by bill number, customer or mobile…" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <div className="relative w-full xl:w-[150px]">
            <CalendarDays size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
            <Input type="date" className="h-10 pl-9 text-[12.5px]" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Filter bills by date" />
          </div>
          <Select value={modeFilter} onValueChange={(value) => setModeFilter(value as ModeFilter)}>
            <SelectTrigger className="h-10 w-full xl:w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Payment Modes</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="upi">UPI</SelectItem>
              <SelectItem value="udhar">Udhar</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filter} onValueChange={(value) => setFilter(value as BillFilter)}>
            <SelectTrigger className="h-10 w-full xl:w-[150px]"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="udhar">Udhar</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="rough">Rough / estimate</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="pending_sync">Pending sync</SelectItem>
              <SelectItem value="deleted">Recycle bin</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="h-10 gap-1.5 rounded-[10px] font-bold" onClick={() => { setSearch(""); setFilter("all"); setModeFilter("all"); setDate(""); void refetch(); }}>
            <RefreshCcw size={14} /> Clear
          </Button>
          <Button onClick={exportCsv} disabled={filtered.length === 0} style={{ background: "linear-gradient(180deg,#0057ff 0%,#0047e8 100%)" }} className="h-10 gap-1.5 rounded-[10px] font-bold text-white hover:opacity-95">
            <Download size={14} /> Export
          </Button>
        </div>

        {/* Bills table */}
        <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef2f8] px-5 py-3.5">
            <h3 className="font-display text-[14px] font-black tracking-tight text-[#102347]">{filtered.length} bill{filtered.length === 1 ? "" : "s"} found</h3>
            <div className="flex items-center gap-2">
              <span className={cn("flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[11px] font-bold", backupStatus.cls)}><BackupStatusIcon size={12} /> {backupStatus.label}</span>
              {counts.pending > 0 && <span className="rounded-[8px] bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">{counts.pending} unsynced</span>}
              {counts.deleted > 0 && <span className="rounded-[8px] bg-[#eef2f8] px-2.5 py-1 text-[11px] font-bold text-[#64748b]">{counts.deleted} in recycle bin</span>}
            </div>
          </div>
          {isLoading ? (
            <div className="py-12 text-center text-[13px] text-[#64748b]">Loading bills…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[#eef5ff] text-[#0057ff]"><ReceiptText size={22} /></span>
              <p className="text-[13px] font-bold text-[#102347]">No bills found</p>
              <p className="text-[12px] text-[#64748b]">Billing still works offline. Try clearing filters or create a new bill.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-[12.5px]">
                <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-bold">Bill No.</th>
                    <th className="px-4 py-2.5 text-left font-bold">Customer</th>
                    <th className="px-4 py-2.5 text-right font-bold">Items</th>
                    <th className="px-4 py-2.5 text-right font-bold">Total (₹)</th>
                    <th className="px-4 py-2.5 text-right font-bold">Paid (₹)</th>
                    <th className="px-4 py-2.5 text-right font-bold">Due (₹)</th>
                    <th className="px-4 py-2.5 text-left font-bold">Payment Mode</th>
                    <th className="px-4 py-2.5 text-left font-bold">Status</th>
                    <th className="px-4 py-2.5 text-left font-bold">Sync</th>
                    <th className="px-4 py-2.5 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((bill, i) => {
                    const deleted = isDeleted(bill);
                    const status = paymentStatusOf(bill);
                    const mode = paymentModeOf(bill);
                    const due = billCredit(bill);
                    const sync = syncStatusOf(bill);
                    const items = itemsCount(bill);
                    return (
                      <tr key={bill.id} className={cn(i < filtered.length - 1 && "border-b border-[#eef2f8]", deleted && "bg-[#f7f9fd] opacity-70")}>
                        <td className="px-4 py-3">
                          <p className="font-bold text-[#102347]">{billNo(bill)}</p>
                          <p className="text-[10.5px] text-[#94a3b8]">{billDate(bill) ? new Date(billDate(bill)).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "No date"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-[#344668]">{bill.customerName || "Walk-in Customer"}</p>
                          <p className="text-[10.5px] text-[#94a3b8]">{bill.customerMobile || "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-right text-[#52627e]">{items ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-black text-[#102347]">{money(billTotal(bill))}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-[#344668]">{money(billPaid(bill))}</td>
                        <td className={cn("whitespace-nowrap px-4 py-3 text-right font-bold", due > 0 ? "text-rose-600" : "text-emerald-600")}>{money(due)}</td>
                        <td className="px-4 py-3"><span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold capitalize", MODE_CLS[mode] ?? "bg-[#eef2f8] text-[#64748b]")}>{mode === "upi" ? "UPI" : mode}</span></td>
                        <td className="px-4 py-3"><span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", STATUS_CLS[status] ?? STATUS_CLS.Pending)}>{status}</span></td>
                        <td className="px-4 py-3">
                          <span className={cn("flex w-fit items-center gap-1 rounded-[7px] px-2 py-[3px] text-[11px] font-bold", sync === "synced" ? "bg-emerald-50 text-emerald-700" : sync === "failed" || sync === "conflict" ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-700")}>
                            {sync === "synced" ? <CheckCircle2 size={11} /> : <Clock3 size={11} />}{sync.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <Link href={`/bills/${bill.id}`}><button title="View bill" className="grid h-7 w-7 place-items-center rounded-[7px] text-[#536583] hover:bg-[#eef2f8]"><Eye size={14} /></button></Link>
                            <button title="Print bill" onClick={() => printBill(bill)} className="grid h-7 w-7 place-items-center rounded-[7px] text-[#536583] hover:bg-[#eef2f8]"><Printer size={14} /></button>
                            <button title="Share PDF" onClick={sharePdfArchitecture} className="grid h-7 w-7 place-items-center rounded-[7px] text-[#536583] hover:bg-[#eef2f8]"><FileText size={14} /></button>
                            {deleted ? (
                              <button title="Restore bill" onClick={() => requestPinAction("restore", bill)} className="grid h-7 w-7 place-items-center rounded-[7px] text-emerald-600 hover:bg-emerald-50"><RotateCcw size={14} /></button>
                            ) : (
                              <>
                                {bill.status !== "cancelled" && <button title="Cancel bill (owner PIN)" onClick={() => requestPinAction("cancel", bill)} className="grid h-7 w-7 place-items-center rounded-[7px] text-amber-600 hover:bg-amber-50"><ShieldCheck size={14} /></button>}
                                <button title="Move to recycle bin" onClick={() => requestPinAction("delete", bill)} className="grid h-7 w-7 place-items-center rounded-[7px] text-rose-500 hover:bg-rose-50"><Trash2 size={14} /></button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

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
    </div>
  );
}

function Kpi({ icon, iconBg, label, value, sub, loading }: { icon: React.ReactNode; iconBg: string; label: string; value: string; sub: string; loading?: boolean }) {
  return (
    <div className="rounded-[14px] border border-[#e6ecf4] bg-white px-4 py-3.5 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="flex items-center gap-2">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[9px]", iconBg)}>{icon}</span>
        <p className="text-[11px] font-semibold leading-tight text-[#64748b]">{label}</p>
      </div>
      <p className="mt-2 truncate font-display text-[19px] font-black leading-none text-[#102347]">{loading ? "…" : value}</p>
      <p className="mt-1 text-[10.5px] font-semibold text-[#94a3b8]">{sub}</p>
    </div>
  );
}
