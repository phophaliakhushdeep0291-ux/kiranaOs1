import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban, CalendarDays, CheckCircle2, Clock3, CloudOff, Download, Eye, FileText, IndianRupee, MoreVertical,
  Printer, ReceiptText, RotateCcw, Search, Share2, ShieldCheck, ShoppingCart, Trash2, User, Wallet, Wifi, WifiOff, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { CHIP_TONES } from "@/lib/chip-tones";
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
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Reference labels: udhar bills read "Unpaid" on the status chip. */
function statusLabel(status: string) {
  return status === "Udhar" ? "Unpaid" : status;
}

const STATUS_CLS: Record<string, string> = {
  Paid: CHIP_TONES.green,
  Partial: CHIP_TONES.orange,
  Udhar: CHIP_TONES.red, // shown as "Unpaid"
  Pending: CHIP_TONES.gray,
  Cancelled: CHIP_TONES.red,
  "Rough/Estimate": CHIP_TONES.violet,
};
const MODE_CLS: Record<string, string> = {
  cash: CHIP_TONES.green,
  upi: CHIP_TONES.violet,
  udhar: CHIP_TONES.amber,
  card: CHIP_TONES.blue,
  bank: CHIP_TONES.blue,
};

function modeLabel(mode: string) {
  if (mode === "upi") return "UPI";
  if (mode === "bank") return "Bank Transfer";
  return mode.charAt(0).toUpperCase() + mode.slice(1);
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
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelClosed, setPanelClosed] = useState(false);
  const [pinAction, setPinAction] = useState<{ action: PinAction; bill: BillRecord } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills.filter((bill) => {
      const status = paymentStatusOf(bill).toLowerCase();
      const sync = syncStatusOf(bill);
      const deleted = isDeleted(bill);
      const day = billDate(bill).slice(0, 10);
      const matchesSearch = !q || billNo(bill).toLowerCase().includes(q) || String(bill.customerName ?? "walk-in").toLowerCase().includes(q) || String(bill.customerMobile ?? "").includes(q);
      const matchesDate = (!fromDate || day >= fromDate) && (!toDate || day <= toDate);
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
  }, [bills, fromDate, toDate, filter, modeFilter, search]);

  useEffect(() => { setPage(1); }, [search, filter, modeFilter, fromDate, toDate, perPage]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * perPage, safePage * perPage);

  const counts = useMemo(() => ({
    pending: bills.filter((bill) => ["pending_sync", "syncing", "failed", "conflict"].includes(syncStatusOf(bill)) && !isDeleted(bill)).length,
    deleted: bills.filter(isDeleted).length,
  }), [bills]);

  const stats = useMemo(() => {
    const active = bills.filter((bill) => !isDeleted(bill));
    const todayKey = new Date().toDateString();
    const yesterdayKey = new Date(Date.now() - 86_400_000).toDateString();
    const onDay = (key: string) => active.filter((bill) => billDate(bill) && new Date(billDate(bill)).toDateString() === key);
    const realSales = (rows: BillRecord[]) => rows.filter((bill) => bill.status !== "cancelled" && bill.billType !== "estimate");
    const todayRows = onDay(todayKey);
    const yesterdayRows = onDay(yesterdayKey);
    const todaySales = realSales(todayRows).reduce((sum, bill) => sum + billTotal(bill), 0);
    const yesterdaySales = realSales(yesterdayRows).reduce((sum, bill) => sum + billTotal(bill), 0);
    const real = realSales(active);
    const avg = real.length ? real.reduce((sum, bill) => sum + billTotal(bill), 0) / real.length : 0;
    const yReal = realSales(yesterdayRows);
    const yAvg = yReal.length ? yesterdaySales / yReal.length : 0;
    const paidCount = active.filter((bill) => paymentStatusOf(bill) === "Paid").length;
    const udharCount = active.filter((bill) => ["Udhar", "Partial"].includes(paymentStatusOf(bill))).length;
    const cancelledCount = active.filter((bill) => bill.status === "cancelled").length;
    const pct = (n: number) => (active.length ? Math.round((n / active.length) * 1000) / 10 : 0);
    const delta = (now: number, prev: number) => (prev > 0 ? Math.round(((now - prev) / prev) * 1000) / 10 : null);
    return {
      todayCount: todayRows.length, todayCountDelta: delta(todayRows.length, yesterdayRows.length),
      todaySales, todaySalesDelta: delta(todaySales, yesterdaySales),
      paidCount, paidPct: pct(paidCount),
      udharCount, udharPct: pct(udharCount),
      cancelledCount, cancelledPct: pct(cancelledCount),
      avg, avgDelta: delta(avg, yAvg),
    };
  }, [bills]);

  // Sales summary follows the filtered range, like the reference side card.
  const summary = useMemo(() => {
    const rows = filtered.filter((bill) => !isDeleted(bill));
    const real = rows.filter((bill) => bill.status !== "cancelled" && bill.billType !== "estimate");
    const totalSales = real.reduce((sum, bill) => sum + billTotal(bill), 0);
    return {
      totalBills: rows.length,
      totalSales,
      paidAmount: real.reduce((sum, bill) => sum + billPaid(bill), 0),
      dueAmount: real.reduce((sum, bill) => sum + billCredit(bill), 0),
      cancelled: rows.filter((bill) => bill.status === "cancelled").length,
      avg: real.length ? totalSales / real.length : 0,
    };
  }, [filtered]);

  const selectedBill = useMemo(() => {
    if (panelClosed) return null;
    return pageRows.find((bill) => bill.id === selectedId) ?? filtered.find((bill) => bill.id === selectedId) ?? pageRows[0] ?? null;
  }, [panelClosed, selectedId, pageRows, filtered]);

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

  function refundReverse() {
    toast({ title: "Refund / reverse coming soon", description: "Returns and refunds arrive with the Returns module. Use Cancel Bill (owner PIN) to void this bill." });
  }

  function exportCsv() {
    const rows = checked.size > 0 ? filtered.filter((bill) => checked.has(bill.id)) : filtered;
    const header = ["Bill No", "Date", "Customer", "Mobile", "Items", "Total", "Paid", "Due", "Mode", "Status", "Sync"];
    const lines = rows.map((bill) => [
      billNo(bill), billDate(bill) ? new Date(billDate(bill)).toLocaleString("en-IN") : "", String(bill.customerName ?? "Walk-in"),
      String(bill.customerMobile ?? ""), itemsCount(bill) ?? "", billTotal(bill), billPaid(bill), billCredit(bill),
      paymentModeOf(bill), statusLabel(paymentStatusOf(bill)), syncStatusOf(bill),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "kirana-bills.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function toggleAllOnPage() {
    setChecked((prev) => {
      const next = new Set(prev);
      const allChecked = pageRows.length > 0 && pageRows.every((bill) => next.has(bill.id));
      for (const bill of pageRows) { if (allChecked) next.delete(bill.id); else next.add(bill.id); }
      return next;
    });
  }

  function toggleOne(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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

  const rangeLabel = fromDate && toDate
    ? `${new Date(fromDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${new Date(toDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
    : "All time";

  return (
    <div className="min-h-full bg-white px-4 py-4">
      <div className="space-y-4">
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi icon={<ReceiptText size={15} />} iconBg="bg-[#eef5ff] text-[#0057ff]" label="Today's Bills" value={String(stats.todayCount)} delta={stats.todayCountDelta} loading={isLoading} />
          <Kpi icon={<IndianRupee size={15} />} iconBg="bg-emerald-50 text-emerald-600" label="Total Sales (Today)" value={money(stats.todaySales)} delta={stats.todaySalesDelta} loading={isLoading} />
          <Kpi icon={<ShoppingCart size={15} />} iconBg="bg-amber-50 text-amber-600" label="Paid Bills" value={String(stats.paidCount)} sub={`${stats.paidPct}% of total bills`} loading={isLoading} />
          <Kpi icon={<Wallet size={15} />} iconBg="bg-orange-50 text-orange-600" label="Udhar Bills" value={String(stats.udharCount)} sub={`${stats.udharPct}% of total bills`} loading={isLoading} />
          <Kpi icon={<Ban size={15} />} iconBg="bg-rose-50 text-rose-600" label="Cancelled Bills" value={String(stats.cancelledCount)} sub={`${stats.cancelledPct}% of total bills`} loading={isLoading} />
          <Kpi icon={<Clock3 size={15} />} iconBg="bg-[#eef5ff] text-[#0057ff]" label="Avg. Bill Value" value={money(stats.avg)} delta={stats.avgDelta} loading={isLoading} />
        </div>

        {/* Filter toolbar — reference order: date range, modes, status, search, clear, export */}
        <div className="flex flex-col gap-3 rounded-[14px] border border-[#e6ecf4] bg-white p-3 shadow-[0_8px_24px_rgba(15,35,80,0.04)] xl:flex-row xl:items-center">
          <div className="flex items-center gap-1.5 rounded-[10px] border border-[#e2e8f0] px-2">
            <CalendarDays size={14} className="shrink-0 text-[#94a3b8]" />
            <Input type="date" className="h-9 w-[128px] border-0 px-1 text-[12px] shadow-none focus-visible:ring-0" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="From date" />
            <span className="text-[12px] text-[#94a3b8]">–</span>
            <Input type="date" className="h-9 w-[128px] border-0 px-1 text-[12px] shadow-none focus-visible:ring-0" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="To date" />
          </div>
          <Select value={modeFilter} onValueChange={(value) => setModeFilter(value as ModeFilter)}>
            <SelectTrigger className="h-10 w-full xl:w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Payment Modes</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="upi">UPI</SelectItem>
              <SelectItem value="udhar">Udhar</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filter} onValueChange={(value) => setFilter(value as BillFilter)}>
            <SelectTrigger className="h-10 w-full xl:w-[140px]"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="udhar">Unpaid (udhar)</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="rough">Rough / estimate</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="pending_sync">Pending sync</SelectItem>
              <SelectItem value="deleted">Recycle bin</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
            <Input className="h-10 pl-9" placeholder="Search by customer name or mobile…" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <Button variant="outline" className="h-10 rounded-[10px] font-bold" onClick={() => { setSearch(""); setFilter("all"); setModeFilter("all"); setFromDate(""); setToDate(""); void refetch(); }}>
            Clear
          </Button>
          <Button onClick={exportCsv} disabled={filtered.length === 0} style={{ background: "linear-gradient(180deg,#0057ff 0%,#0047e8 100%)" }} className="h-10 gap-1.5 rounded-[10px] font-bold text-white hover:opacity-95">
            <Download size={14} /> Export{checked.size > 0 ? ` (${checked.size})` : ""}
          </Button>
          <span className={cn("hidden items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11px] font-bold xl:flex", backupStatus.cls)}><BackupStatusIcon size={12} /> {backupStatus.label}</span>
        </div>

        {/* Table + details rail */}
        <div className="grid items-start gap-4 xl:grid-cols-[1fr_290px]">
          {/* Bills table */}
          <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
            {(counts.pending > 0 || counts.deleted > 0) && (
              <div className="flex items-center gap-2 border-b border-[#eef2f8] px-4 py-2">
                {counts.pending > 0 && <span className="rounded-[8px] bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">{counts.pending} unsynced</span>}
                {counts.deleted > 0 && <span className="rounded-[8px] bg-[#eef2f8] px-2.5 py-1 text-[11px] font-bold text-[#64748b]">{counts.deleted} in recycle bin</span>}
              </div>
            )}
            {isLoading ? (
              <div className="py-12 text-center text-[13px] text-[#64748b]">Loading bills…</div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-[#eef5ff] text-[#0057ff]"><ReceiptText size={22} /></span>
                <p className="text-[13px] font-bold text-[#102347]">No bills found</p>
                <p className="text-[12px] text-[#64748b]">Billing still works offline. Try clearing filters or create a new bill.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-[12.5px]">
                    <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                      <tr>
                        <th className="w-9 px-3 py-2.5">
                          <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer rounded border-[#cbd5e1] accent-[#0057ff]" aria-label="Select all bills on page"
                            checked={pageRows.length > 0 && pageRows.every((bill) => checked.has(bill.id))} onChange={toggleAllOnPage} />
                        </th>
                        <th className="px-3 py-2.5 text-left font-bold">Bill No.</th>
                        <th className="px-3 py-2.5 text-left font-bold">Date / Time</th>
                        <th className="px-3 py-2.5 text-left font-bold">Customer</th>
                        <th className="px-3 py-2.5 text-right font-bold">Items</th>
                        <th className="px-3 py-2.5 text-right font-bold">Total (₹)</th>
                        <th className="px-3 py-2.5 text-right font-bold">Paid (₹)</th>
                        <th className="px-3 py-2.5 text-right font-bold">Due (₹)</th>
                        <th className="px-3 py-2.5 text-left font-bold">Payment Mode</th>
                        <th className="px-3 py-2.5 text-left font-bold">Status</th>
                        <th className="px-3 py-2.5 text-left font-bold">Sync Status</th>
                        <th className="px-3 py-2.5 text-right font-bold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((bill, i) => {
                        const deleted = isDeleted(bill);
                        const status = paymentStatusOf(bill);
                        const mode = paymentModeOf(bill);
                        const due = billCredit(bill);
                        const sync = syncStatusOf(bill);
                        const items = itemsCount(bill);
                        const isSelected = selectedBill?.id === bill.id;
                        const dateStr = billDate(bill);
                        return (
                          <tr key={bill.id}
                            onClick={() => { setSelectedId(bill.id); setPanelClosed(false); }}
                            className={cn("cursor-pointer transition-colors", i < pageRows.length - 1 && "border-b border-[#eef2f8]", deleted && "bg-[#f7f9fd] opacity-70", isSelected ? "bg-[#f3f8ff]" : "hover:bg-[#fafcff]")}>
                            <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                              <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer rounded border-[#cbd5e1] accent-[#0057ff]" aria-label={`Select bill ${billNo(bill)}`}
                                checked={checked.has(bill.id)} onChange={() => toggleOne(bill.id)} />
                            </td>
                            <td className="px-3 py-3 font-bold text-[#102347]">{billNo(bill)}</td>
                            <td className="whitespace-nowrap px-3 py-3">
                              <p className="text-[#344668]">{dateStr ? new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</p>
                              <p className="text-[10.5px] text-[#94a3b8]">{dateStr ? new Date(dateStr).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""}</p>
                            </td>
                            <td className="px-3 py-3">
                              <p className="font-semibold text-[#344668]">{bill.customerName || "Walk-in Customer"}</p>
                              <p className="text-[10.5px] text-[#94a3b8]">{bill.customerMobile ? `+91 ${bill.customerMobile}` : "-"}</p>
                            </td>
                            <td className="px-3 py-3 text-right text-[#52627e]">{items ?? "—"}</td>
                            <td className="whitespace-nowrap px-3 py-3 text-right font-bold text-[#102347]">{money(billTotal(bill))}</td>
                            <td className="whitespace-nowrap px-3 py-3 text-right text-[#344668]">{money(billPaid(bill))}</td>
                            <td className={cn("whitespace-nowrap px-3 py-3 text-right font-bold", due > 0 ? "text-[#ef4444]" : "text-[#344668]")}>{money(due)}</td>
                            <td className="px-3 py-3"><span className={cn("whitespace-nowrap rounded-[7px] px-2 py-[3px] text-[11px] font-bold", MODE_CLS[mode] ?? "bg-[#eef2f8] text-[#64748b]")}>{modeLabel(mode)}</span></td>
                            <td className="px-3 py-3"><span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", STATUS_CLS[status] ?? STATUS_CLS.Pending)}>{statusLabel(status)}</span></td>
                            <td className="px-3 py-3">
                              <span className={cn("flex w-fit items-center gap-1 whitespace-nowrap rounded-[7px] px-2 py-[3px] text-[11px] font-bold", sync === "synced" ? CHIP_TONES.green : sync === "failed" || sync === "conflict" ? CHIP_TONES.red : CHIP_TONES.amber)}>
                                {sync === "synced" ? <CheckCircle2 size={11} /> : <Clock3 size={11} />}{sync === "synced" ? "Synced" : sync.replaceAll("_", " ")}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button className="grid h-7 w-7 place-items-center rounded-[7px] text-[#536583] hover:bg-[#eef2f8]" aria-label={`Actions for ${billNo(bill)}`}><MoreVertical size={15} /></button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuItem onClick={() => { setSelectedId(bill.id); setPanelClosed(false); }}><Eye size={14} className="mr-2" /> View details</DropdownMenuItem>
                                  <DropdownMenuItem asChild><Link href={`/bills/${bill.id}`}><span className="flex items-center"><FileText size={14} className="mr-2" /> Open bill page</span></Link></DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => printBill(bill)}><Printer size={14} className="mr-2" /> Print bill</DropdownMenuItem>
                                  <DropdownMenuItem onClick={sharePdfArchitecture}><Share2 size={14} className="mr-2" /> Share PDF</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  {deleted ? (
                                    <DropdownMenuItem onClick={() => requestPinAction("restore", bill)}><RotateCcw size={14} className="mr-2" /> Restore bill</DropdownMenuItem>
                                  ) : (
                                    <>
                                      {bill.status !== "cancelled" && <DropdownMenuItem className="text-amber-600 focus:text-amber-700" onClick={() => requestPinAction("cancel", bill)}><ShieldCheck size={14} className="mr-2" /> Cancel bill</DropdownMenuItem>}
                                      <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={() => requestPinAction("delete", bill)}><Trash2 size={14} className="mr-2" /> Move to recycle bin</DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Pagination footer */}
                <div className="flex flex-col items-center justify-between gap-2 border-t border-[#eef2f8] px-4 py-2.5 sm:flex-row">
                  <span className="text-[11.5px] text-[#64748b]">Showing {(safePage - 1) * perPage + 1} to {Math.min(safePage * perPage, filtered.length)} of {filtered.length} bills</span>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <PageBtn disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹</PageBtn>
                      {Array.from({ length: pageCount }, (_, idx) => idx + 1)
                        .filter((p) => p === 1 || p === pageCount || Math.abs(p - safePage) <= 1)
                        .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                          if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…");
                          acc.push(p);
                          return acc;
                        }, [])
                        .map((p, idx) => p === "…"
                          ? <span key={`gap-${idx}`} className="px-1 text-[12px] text-[#94a3b8]">…</span>
                          : <PageBtn key={p} active={p === safePage} onClick={() => setPage(p as number)}>{p}</PageBtn>)}
                      <PageBtn disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>›</PageBtn>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#64748b]">
                      <Select value={String(perPage)} onValueChange={(value) => setPerPage(Number(value))}>
                        <SelectTrigger className="h-7 w-[60px] text-[12px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{[10, 20, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                      </Select>
                      per page
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right rail: bill details + sales summary */}
          <div className="space-y-4">
            {selectedBill ? (
              <div className="rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
                <div className="flex items-center justify-between border-b border-[#eef2f8] px-4 py-3">
                  <h3 className="font-display text-[13.5px] font-black tracking-tight text-[#102347]">Bill Details</h3>
                  <button onClick={() => setPanelClosed(true)} className="flex items-center gap-1 text-[11.5px] font-bold text-[#64748b] hover:text-[#102347]">Close <X size={13} /></button>
                </div>
                <div className="px-4 py-3.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-display text-[18px] font-black tracking-tight text-[#102347]">{billNo(selectedBill)}</p>
                      <p className="mt-0.5 text-[11px] text-[#94a3b8]">{billDate(selectedBill) ? new Date(billDate(selectedBill)).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</p>
                    </div>
                    <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", STATUS_CLS[paymentStatusOf(selectedBill)] ?? STATUS_CLS.Pending)}>{statusLabel(paymentStatusOf(selectedBill))}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2.5 border-b border-[#eef2f8] pb-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eef5ff] text-[#0057ff]"><User size={15} /></span>
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-bold text-[#102347]">{selectedBill.customerName || "Walk-in Customer"}</p>
                      <p className="text-[10.5px] text-[#94a3b8]">{selectedBill.customerMobile || "-"}</p>
                    </div>
                  </div>
                  <dl className="space-y-2 py-3 text-[12px]">
                    <DetailRow label="Items" value={`${itemsCount(selectedBill) ?? "—"} items`} />
                    <DetailRow label="Total Amount" value={money(billTotal(selectedBill))} bold />
                    <DetailRow label="Paid Amount" value={money(billPaid(selectedBill))} />
                    <DetailRow label="Due Amount" value={money(billCredit(selectedBill))} valueClass={billCredit(selectedBill) > 0 ? "text-[#ef4444]" : "text-[#16a34a]"} />
                    <DetailRow label="Payment Mode" value={modeLabel(paymentModeOf(selectedBill))} />
                    <DetailRow label="Status" value={<span className={cn("rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-bold", STATUS_CLS[paymentStatusOf(selectedBill)] ?? STATUS_CLS.Pending)}>{statusLabel(paymentStatusOf(selectedBill))}</span>} />
                    <DetailRow label="Sync Status" value={<span className="flex items-center gap-1 text-[11px] font-bold text-[#16a34a]"><CheckCircle2 size={11} /> {syncStatusOf(selectedBill) === "synced" ? "Synced" : syncStatusOf(selectedBill).replaceAll("_", " ")}</span>} />
                  </dl>
                  <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-[#9aa6bb]">Bill Actions</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    <PanelAction icon={<Eye size={14} />} label="View Bill" href={`/bills/${selectedBill.id}`} />
                    <PanelAction icon={<Printer size={14} />} label="Print Bill" onClick={() => printBill(selectedBill)} />
                    <PanelAction icon={<Share2 size={14} />} label="Share PDF" onClick={sharePdfArchitecture} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {isDeleted(selectedBill) ? (
                      <button onClick={() => requestPinAction("restore", selectedBill)} className="col-span-2 flex items-center justify-center gap-1.5 rounded-[9px] border border-emerald-200 px-2 py-2 text-[11.5px] font-bold text-emerald-700 hover:bg-emerald-50"><RotateCcw size={13} /> Restore Bill</button>
                    ) : (
                      <>
                        <button onClick={() => selectedBill.status !== "cancelled" && requestPinAction("cancel", selectedBill)} disabled={selectedBill.status === "cancelled"}
                          className="flex items-center justify-center gap-1.5 rounded-[9px] border border-rose-200 px-2 py-2 text-[11.5px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40"><X size={13} /> Cancel Bill</button>
                        <button onClick={refundReverse} className="flex items-center justify-center gap-1.5 rounded-[9px] border border-amber-300 px-2 py-2 text-[11.5px] font-bold text-amber-700 hover:bg-amber-50"><RotateCcw size={13} /> Refund / Reverse</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[14px] border border-dashed border-[#d8e2f1] bg-white px-4 py-8 text-center shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
                <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#eef5ff] text-[#0057ff]"><ReceiptText size={18} /></span>
                <p className="mt-2 text-[12.5px] font-bold text-[#102347]">Select a bill</p>
                <p className="text-[11px] text-[#64748b]">Click any row to see its details here.</p>
              </div>
            )}

            {/* Sales summary */}
            <div className="rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
              <div className="border-b border-[#eef2f8] px-4 py-3">
                <h3 className="font-display text-[13.5px] font-black tracking-tight text-[#102347]">Sales Summary <span className="text-[10.5px] font-bold text-[#94a3b8]">({rangeLabel})</span></h3>
              </div>
              <dl className="space-y-2 px-4 py-3.5 text-[12px]">
                <DetailRow label="Total Bills" value={String(summary.totalBills)} />
                <DetailRow label="Total Sales" value={money(summary.totalSales)} bold />
                <DetailRow label="Paid Amount" value={money(summary.paidAmount)} />
                <DetailRow label="Due Amount" value={money(summary.dueAmount)} valueClass={summary.dueAmount > 0 ? "text-[#ef4444]" : undefined} />
                <DetailRow label="Cancelled Bills" value={String(summary.cancelled)} />
                <DetailRow label="Avg. Bill Value" value={money(summary.avg)} />
              </dl>
              <div className="px-4 pb-4">
                <Link href="/reports" className="flex h-9 items-center justify-center rounded-[9px] border border-[#dbe6f7] text-[12px] font-bold text-[#0057ff] hover:bg-[#f3f8ff]">View Sales Overview</Link>
              </div>
            </div>
          </div>
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

function Kpi({ icon, iconBg, label, value, sub, delta, loading }: { icon: React.ReactNode; iconBg: string; label: string; value: string; sub?: string; delta?: number | null; loading?: boolean }) {
  return (
    <div className="rounded-[14px] border border-[#e6ecf4] bg-white px-4 py-3.5 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="flex items-center gap-2">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[9px]", iconBg)}>{icon}</span>
        <p className="text-[11px] font-semibold leading-tight text-[#64748b]">{label}</p>
      </div>
      <p className="mt-2 truncate font-display text-[19px] font-black leading-none text-[#102347]">{loading ? "…" : value}</p>
      {delta != null ? (
        <p className={cn("mt-1 text-[10.5px] font-bold", delta >= 0 ? "text-emerald-600" : "text-rose-500")}>{delta >= 0 ? "↑" : "↓"} {Math.abs(delta)}% vs yesterday</p>
      ) : (
        <p className="mt-1 text-[10.5px] font-semibold text-[#94a3b8]">{sub ?? "vs yesterday —"}</p>
      )}
    </div>
  );
}

function PageBtn({ children, active, disabled, onClick }: { children: React.ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn("grid h-7 min-w-7 place-items-center rounded-[7px] px-1.5 text-[12px] font-bold transition-colors",
        active ? "bg-[#0057ff] text-white" : "text-[#52627e] hover:bg-[#eef2f8] disabled:opacity-40 disabled:hover:bg-transparent")}>
      {children}
    </button>
  );
}

function DetailRow({ label, value, bold, valueClass }: { label: string; value: React.ReactNode; bold?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[#64748b]">{label}</dt>
      <dd className={cn("text-right font-semibold text-[#102347]", bold && "font-black", valueClass)}>{value}</dd>
    </div>
  );
}

function PanelAction({ icon, label, href, onClick }: { icon: React.ReactNode; label: string; href?: string; onClick?: () => void }) {
  const inner = (
    <span className="flex flex-col items-center gap-1 rounded-[9px] border border-[#e7edf7] px-1 py-2 text-[10.5px] font-bold text-[#344668] transition-colors hover:border-[#cfe0ff] hover:bg-[#f7faff]">
      <span className="text-[#536583]">{icon}</span>{label}
    </span>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return <button type="button" onClick={onClick}>{inner}</button>;
}
