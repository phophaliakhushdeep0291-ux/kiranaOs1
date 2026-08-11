import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CloudOff,
  CreditCard,
  Download,
  Eye,
  FileText,
  Filter,
  IndianRupee,
  MoreVertical,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Search,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  User,
  Wallet,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { offlineDB } from "@/lib/offline/db";
import { readInstantCache } from "@/lib/offline/instant-cache";
import { dedupeBillsForDisplay, isMergedBillTwin } from "@/features/core/sync/bill-reconciliation";
import { annotateBillSyncStatuses, repairStaleSyncedBillOutboxFailures } from "@/features/core/sync/sync-status-repair";
import type { PendingSyncEvent } from "@/lib/offline/db";
import { openPrintableBill, buildPrintableBillSnapshot } from "@/features/core/bills/print";
import { cancelBillWithOwnerPinLocalFirst, restoreBillWithOwnerPinLocalFirst, softDeleteBillWithOwnerPinLocalFirst } from "@/features/core/bills/local-actions";
import type { Bill } from "@/types/api";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { usePermission } from "@/features/core/staff/permissions";
import { useOfflineStatus } from "@/features/core/sync";
import { useAuth } from "@/features/core/auth/useAuth";
import { billRecordToShareInput, resolveBillCustomerMobile, shareBillOnWhatsapp } from "@/features/core/bills/share";
import { CHIP_TONES } from "@/lib/chip-tones";
import { cn } from "@/lib/utils";

interface BillRecord extends Bill, Record<string, unknown> {}

type BillFilter = "all" | "pakka" | "estimate" | "paid" | "udhar" | "partial" | "rough" | "cancelled" | "pending_sync" | "deleted";
type ModeFilter = "all" | "cash" | "upi" | "udhar" | "card" | "bank" | "split";
type BillPeriod = "today" | "week" | "month" | "all";
type PinAction = "cancel" | "delete" | "restore" | "clear_estimates";
type PinActionState =
  | { action: Exclude<PinAction, "clear_estimates">; bill: BillRecord }
  | { action: "clear_estimates"; bills: BillRecord[] };

const CARD = "rounded-[12px] border border-[#e2e9f3] bg-white shadow-[0_5px_18px_rgba(31,60,110,0.045)]";
const TABLE_HEAD = "border-y border-[#e6ecf4] bg-[#f7f9fc] text-[#52617c]";
const BLUE = "var(--brand)";
const GREEN = "#19b85a";
const PURPLE = "#7c3ff2";
const ORANGE = "#ff9f0a";
const RED = "#ff314f";

const PERIOD_LABELS: Record<BillPeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  all: "All Time",
};

const BILL_TABS: Array<{ value: BillFilter; label: string }> = [
  { value: "all", label: "All Bills" },
  { value: "pakka", label: "Pakka Bills" },
  { value: "estimate", label: "Estimates" },
  { value: "paid", label: "Paid" },
  { value: "partial", label: "Partial" },
  { value: "udhar", label: "Udhar" },
  { value: "cancelled", label: "Cancelled" },
];

const MODE_META: Record<string, { label: string; chip: string; color: string }> = {
  cash: { label: "Cash", chip: CHIP_TONES.green, color: "#20b75a" },
  upi: { label: "UPI", chip: CHIP_TONES.violet, color: "#7c3ff2" },
  card: { label: "Card", chip: CHIP_TONES.blue, color: "#f6ad14" },
  split: { label: "Split", chip: CHIP_TONES.blue, color: "var(--brand)" },
  udhar: { label: "Credit (Udhar)", chip: CHIP_TONES.amber, color: "#ff7a1a" },
  bank: { label: "Bank Transfer", chip: CHIP_TONES.blue, color: "#0ea5e9" },
};

const STATUS_CLS: Record<string, string> = {
  Paid: CHIP_TONES.green,
  Partial: CHIP_TONES.orange,
  Udhar: CHIP_TONES.amber,
  Pending: CHIP_TONES.gray,
  Cancelled: CHIP_TONES.red,
  Estimate: CHIP_TONES.violet,
};

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
  return String(bill.businessDate ?? bill.business_date ?? bill.createdAt ?? bill.created_at ?? "");
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

// A merged twin is the local optimistic bill row after its server copy synced back:
// reconcile sets deleted_at AND merged_into_id on it. It is NOT a user-deleted bill,
// so it must never show in the recycle bin (every synced bill would otherwise leave a
// phantom there). Shared predicate — the rest of the app already treats it as "gone".
function isMergedTwin(bill: BillRecord) {
  return isMergedBillTwin(bill as unknown as Record<string, unknown>);
}

function isEstimateBill(bill: BillRecord) {
  const type = String(bill.billType ?? bill.bill_type ?? "").toLowerCase();
  const status = String(bill.status ?? "").toLowerCase();
  return type === "estimate"
    || type.includes("rough")
    || status.includes("rough")
    || status === "draft"
    || Boolean(bill.is_rough_estimate ?? bill.isRoughEstimate);
}

function syncStatusOf(bill: BillRecord) {
  const explicit = bill.sync_status ?? bill.syncStatus ?? bill.cloudSyncStatus;
  if (explicit) return String(explicit);
  const status = String(bill.status ?? "");
  if (["pending_sync", "syncing", "failed", "conflict"].includes(status)) return status;
  return "synced";
}

function paymentStatusOf(bill: BillRecord) {
  if (bill.status === "cancelled") return "Cancelled";
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
  const nonCreditModes = Array.from(new Set(payments
    .filter((p) => String(p.mode ?? "") !== "credit" && readNumber(p.amount, 0) > 0)
    .map((p) => String(p.mode ?? "").toLowerCase())));
  const hasCredit = payments.some((p) => String(p.mode ?? "") === "credit" && readNumber(p.amount, 0) > 0) || billCredit(bill) > 0;
  if (nonCreditModes.length > 1 || (nonCreditModes.length === 1 && hasCredit)) return "split";
  if (nonCreditModes.length === 1) return nonCreditModes[0];
  if (hasCredit) return "udhar";
  return String(bill.paymentMode ?? "cash").toLowerCase();
}

function itemsCount(bill: BillRecord) {
  return Array.isArray(bill.items) ? bill.items.length : readNumber(bill.itemCount ?? bill.itemsCount, 0);
}

function money(value: number, fractionDigits = 0) {
  return `\u20b9${value.toLocaleString("en-IN", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}`;
}

function statusLabel(status: string) {
  return status;
}

function modeLabel(mode: string) {
  return MODE_META[mode]?.label ?? mode.charAt(0).toUpperCase() + mode.slice(1);
}

function billTypeOf(bill: BillRecord) {
  if (isEstimateBill(bill)) return "Estimate";
  const raw = String(bill.saleType ?? bill.billType ?? "retail").toLowerCase();
  if (raw === "wholesale") return "Wholesale";
  if (raw === "gst_invoice") return "Pakka GST";
  return "Pakka";
}

function staffNameOf(bill: BillRecord, fallback: string) {
  return String(bill.staffName ?? bill.cashierName ?? bill.createdByName ?? bill.userName ?? fallback);
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return toDateInputValue(date);
}

function periodRange(period: BillPeriod) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (period === "all") return { from: "", to: "" };
  if (period === "today") {
    const value = toDateInputValue(today);
    return { from: value, to: value };
  }
  if (period === "month") {
    return { from: toDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)), to: toDateInputValue(today) };
  }
  return { from: dateDaysAgo(6), to: toDateInputValue(today) };
}

function formatRange(from: string, to: string) {
  if (!from || !to) return "All time";
  const fmt = (value: string, withYear = false) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
  });
  return from === to ? fmt(from, true) : `${fmt(from)} - ${fmt(to, true)}`;
}

function billDayKey(bill: BillRecord) {
  return billDate(bill).slice(0, 10);
}

function dateMatches(bill: BillRecord, from: string, to: string) {
  const day = billDayKey(bill);
  return (!from || day >= from) && (!to || day <= to);
}

function realSaleRows(rows: BillRecord[]) {
  // Estimates (kacha bills) count as sales — same money and stock effects as pakka bills,
  // only the EST- number series differs. History deletion hides a row but must not
  // rewrite financial summaries; cancellation is the action that removes a sale.
  return rows.filter((bill) => bill.status !== "cancelled" && !isMergedTwin(bill));
}

function activeEstimateRows(rows: BillRecord[]) {
  return rows.filter((bill) => isEstimateBill(bill) && !isDeleted(bill));
}

function pctDelta(current: number, previous: number) {
  if (Math.abs(previous) < 0.005) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1_000) / 10;
}

function previousRangeFor(from: string, to: string) {
  if (!from || !to) return { from: "", to: "" };
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const prevTo = new Date(start);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - days + 1);
  return { from: toDateInputValue(prevFrom), to: toDateInputValue(prevTo) };
}

function sparkFromRows(rows: BillRecord[], to: string, metric: (dayRows: BillRecord[]) => number) {
  const end = to ? new Date(`${to}T00:00:00`) : new Date();
  end.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (6 - index));
    const key = toDateInputValue(date);
    return {
      label: date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
      value: metric(rows.filter((bill) => billDayKey(bill) === key)),
    };
  });
}

function formatBillDateParts(raw: string) {
  if (!raw) return { date: "-", time: "" };
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { date: "-", time: "" };
  return {
    date: date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    time: date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
  };
}

function compactBillNo(value: string) {
  const match = value.match(/(\d{1,6})$/);
  return match ? String(Number(match[1])) : value;
}

let billHistoryRepairTimer: ReturnType<typeof setTimeout> | null = null;
let billHistoryRepairSweep: Promise<number> | null = null;

function scheduleBillHistoryRepair() {
  if (billHistoryRepairTimer !== null || billHistoryRepairSweep !== null) return;
  // History is a local-first operational screen. A repair sweep can involve an
  // IndexedDB transaction and must never delay the first readable bill list.
  // The sweep already emits kirana:sync-queue-updated when it changes anything,
  // which invalidates this query and refreshes the badges after the first paint.
  billHistoryRepairTimer = setTimeout(() => {
    billHistoryRepairTimer = null;
    billHistoryRepairSweep = repairStaleSyncedBillOutboxFailures()
      .catch(() => 0)
      .finally(() => { billHistoryRepairSweep = null; });
  }, 0);
}

async function loadBills(): Promise<BillRecord[]> {
  const [dbRows, outboxRows] = await Promise.all([
    offlineDB.getAll<BillRecord>("bills").catch(() => []),
    offlineDB.getAll<PendingSyncEvent>("sync_outbox").catch(() => []),
  ]);
  const cached = readInstantCache<BillRecord[]>("bills", []);
  const merged = new Map<string, BillRecord>();
  for (const row of cached) merged.set(row.id, row);
  for (const row of dbRows) merged.set(row.id, row);
  const rows = Array.from(merged.values());
  const displayRows = dedupeBillsForDisplay(rows.filter((row) => !isDeleted(row) && !isMergedTwin(row))) as unknown as BillRecord[];
  const annotatedDisplayRows = annotateBillSyncStatuses(displayRows, outboxRows) as BillRecord[];
  const deletedRows = annotateBillSyncStatuses(rows.filter((row) => isDeleted(row) && !isMergedTwin(row)), outboxRows) as BillRecord[];
  scheduleBillHistoryRepair();
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
  const { shop } = useAuth();
  const [, navigate] = useLocation();
  const cancelPermission = usePermission("cancel_bill");
  const { isOnline, isBrowserOnline, backendStatus, isSyncing } = useOfflineStatus();
  const { data: bills = [], isLoading, refetch } = useLocalBills();
  const [period, setPeriod] = useState<BillPeriod>("all");
  const initialRange = useMemo(() => periodRange("all"), []);
  const [fromDate, setFromDate] = useState(initialRange.from);
  const [toDate, setToDate] = useState(initialRange.to);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<BillFilter>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [staffFilter, setStaffFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pinAction, setPinAction] = useState<PinActionState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const staffFallback = shop?.name || "Mukesh Store";

  const periodBills = useMemo(
    () => bills.filter((bill) => !isMergedTwin(bill) && dateMatches(bill, fromDate, toDate)),
    [bills, fromDate, toDate],
  );

  const staffOptions = useMemo(() => {
    const names = new Set<string>();
    for (const bill of periodBills) names.add(staffNameOf(bill, staffFallback));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [periodBills, staffFallback]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills.filter((bill) => {
      const status = paymentStatusOf(bill).toLowerCase();
      const sync = syncStatusOf(bill);
      const deleted = isDeleted(bill);
      const staff = staffNameOf(bill, staffFallback);
      const matchesSearch = !q
        || billNo(bill).toLowerCase().includes(q)
        || String(bill.customerName ?? "walk-in").toLowerCase().includes(q)
        || String(bill.customerMobile ?? "").includes(q);
      const matchesDate = dateMatches(bill, fromDate, toDate);
      const mode = paymentModeOf(bill);
      const matchesMode = modeFilter === "all" || mode === modeFilter;
      const matchesStaff = staffFilter === "all" || staff === staffFilter;
      const matchesFilter =
        filter === "all" ? !deleted :
        filter === "pakka" ? !isEstimateBill(bill) && !deleted :
        filter === "estimate" ? isEstimateBill(bill) && !deleted :
        filter === "paid" ? status === "paid" && !deleted :
        filter === "udhar" ? status === "udhar" && !deleted :
        filter === "partial" ? status === "partial" && !deleted :
        filter === "rough" ? isEstimateBill(bill) && !deleted :
        filter === "cancelled" ? bill.status === "cancelled" && !deleted :
        filter === "pending_sync" ? ["pending_sync", "syncing", "failed", "conflict"].includes(sync) && !deleted :
        filter === "deleted" ? deleted : true;
      return matchesSearch && matchesDate && matchesMode && matchesStaff && matchesFilter;
    });
  }, [bills, filter, fromDate, modeFilter, search, staffFallback, staffFilter, toDate]);

  useEffect(() => { setPage(1); }, [search, filter, modeFilter, staffFilter, fromDate, toDate, perPage]);
  useEffect(() => {
    const handler = (event: Event) => {
      const query = String((event as CustomEvent<{ query?: unknown }>).detail?.query ?? "").trim();
      if (!query) return;
      setSearch(query);
      setPage(1);
    };
    window.addEventListener("kirana:voice-bill-search", handler);
    return () => window.removeEventListener("kirana:voice-bill-search", handler);
  }, []);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * perPage, safePage * perPage);

  const analytics = useMemo(() => {
    const previous = previousRangeFor(fromDate, toDate);
    const previousRows = bills.filter((bill) => !isMergedTwin(bill) && dateMatches(bill, previous.from, previous.to));
    const currentReal = realSaleRows(periodBills);
    const previousReal = realSaleRows(previousRows);
    const sum = (rows: BillRecord[], getter: (bill: BillRecord) => number) => rows.reduce((total, bill) => total + getter(bill), 0);
    const currentSales = sum(currentReal, billTotal);
    const previousSales = sum(previousReal, billTotal);
    const currentAvg = currentReal.length ? currentSales / currentReal.length : 0;
    const previousAvg = previousReal.length ? previousSales / previousReal.length : 0;
    const currentPaid = currentReal.filter((bill) => paymentStatusOf(bill) === "Paid").length;
    const previousPaid = previousReal.filter((bill) => paymentStatusOf(bill) === "Paid").length;
    const currentUdhar = currentReal.filter((bill) => ["Udhar", "Partial"].includes(paymentStatusOf(bill))).length;
    const previousUdhar = previousReal.filter((bill) => ["Udhar", "Partial"].includes(paymentStatusOf(bill))).length;
    const currentCancelled = periodBills.filter((bill) => bill.status === "cancelled").length;
    const previousCancelled = previousRows.filter((bill) => bill.status === "cancelled").length;
    const sparkEnd = toDate || toDateInputValue(new Date());

    return {
      totalBills: currentReal.length,
      totalBillsDelta: period === "all" ? 0 : pctDelta(currentReal.length, previousReal.length),
      totalSales: currentSales,
      totalSalesDelta: period === "all" ? 0 : pctDelta(currentSales, previousSales),
      paidBills: currentPaid,
      paidBillsDelta: period === "all" ? 0 : pctDelta(currentPaid, previousPaid),
      udharBills: currentUdhar,
      udharBillsDelta: period === "all" ? 0 : pctDelta(currentUdhar, previousUdhar),
      avgBill: currentAvg,
      avgBillDelta: period === "all" ? 0 : pctDelta(currentAvg, previousAvg),
      cancelledBills: currentCancelled,
      cancelledBillsDelta: period === "all" ? 0 : pctDelta(currentCancelled, previousCancelled),
      sparks: {
        totalBills: sparkFromRows(periodBills, sparkEnd, (rows) => realSaleRows(rows).length),
        totalSales: sparkFromRows(periodBills, sparkEnd, (rows) => sum(realSaleRows(rows), billTotal)),
        paidBills: sparkFromRows(periodBills, sparkEnd, (rows) => realSaleRows(rows).filter((bill) => paymentStatusOf(bill) === "Paid").length),
        udharBills: sparkFromRows(periodBills, sparkEnd, (rows) => realSaleRows(rows).filter((bill) => ["Udhar", "Partial"].includes(paymentStatusOf(bill))).length),
        avgBill: sparkFromRows(periodBills, sparkEnd, (rows) => {
          const real = realSaleRows(rows);
          const sales = sum(real, billTotal);
          return real.length ? sales / real.length : 0;
        }),
        cancelledBills: sparkFromRows(periodBills, sparkEnd, (rows) => rows.filter((bill) => bill.status === "cancelled").length),
      },
    };
  }, [bills, fromDate, period, periodBills, toDate]);

  const counts = useMemo(() => ({
    pending: bills.filter((bill) => ["pending_sync", "syncing", "failed", "conflict"].includes(syncStatusOf(bill)) && !isDeleted(bill)).length,
    deleted: bills.filter((bill) => isDeleted(bill) && !isMergedTwin(bill)).length,
    estimates: activeEstimateRows(bills).length,
  }), [bills]);

  const estimatesInView = useMemo(() => activeEstimateRows(filtered), [filtered]);

  const paymentBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const bill of realSaleRows(periodBills)) {
      const key = paymentModeOf(bill);
      totals.set(key, (totals.get(key) ?? 0) + billTotal(bill));
    }
    const order = ["cash", "upi", "card", "split", "udhar", "bank"];
    return order
      .map((key) => ({ key, value: totals.get(key) ?? 0, ...MODE_META[key] }))
      .filter((row) => row.value > 0);
  }, [periodBills]);

  const recentActivities = useMemo(() => filtered.filter((bill) => !isDeleted(bill)).slice(0, 4).map((bill) => {
    const status = paymentStatusOf(bill);
    const mode = paymentModeOf(bill);
    const customer = String(bill.customerName || "Walk-in customer");
    const title = isEstimateBill(bill)
      ? `Estimate saved for ${customer}`
      : bill.status === "cancelled"
      ? `Bill cancelled for ${customer}`
      : status === "Udhar"
        ? `Udhar bill created for ${customer}`
        : status === "Partial"
          ? `Partial payment from ${customer}`
          : `Payment received from ${customer}`;
    return {
      id: bill.id,
      title,
      sub: `${billNo(bill)} - ${money(billTotal(bill))}`,
      time: formatBillDateParts(billDate(bill)).time || formatBillDateParts(billDate(bill)).date,
      tone: isEstimateBill(bill) ? "violet" : bill.status === "cancelled" ? "rose" : mode === "udhar" ? "orange" : "emerald",
      bill,
    };
  }), [filtered]);

  const topCustomers = useMemo(() => {
    const groups = new Map<string, { name: string; bills: number; total: number }>();
    for (const bill of realSaleRows(periodBills)) {
      const name = String(bill.customerName || "Walk-in Customer");
      const current = groups.get(name) ?? { name, bills: 0, total: 0 };
      current.bills += 1;
      current.total += billTotal(bill);
      groups.set(name, current);
    }
    return Array.from(groups.values()).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [periodBills]);

  const backupStatus = isOnline
    ? { icon: Wifi, label: isSyncing ? "Syncing" : "Synced", sub: isSyncing ? "Backing up now" : "Just now", cls: "border-[#c9efd5] bg-[#eaf9ef] text-[#119447]" }
    : isBrowserOnline
      ? { icon: CloudOff, label: backendStatus.checkedAt ? "Cloud paused" : "Checking backup", sub: "Local data safe", cls: "border-[#dbe9ff] bg-[var(--brand-soft)] text-[var(--brand)]" }
      : { icon: WifiOff, label: "Offline ready", sub: "Saved locally", cls: "border-[#dfe6f0] bg-[#f7f9fc] text-[#64748b]" };
  const BackupStatusIcon = backupStatus.icon;

  function applyPeriod(nextPeriod: BillPeriod) {
    const next = periodRange(nextPeriod);
    setPeriod(nextPeriod);
    setFromDate(next.from);
    setToDate(next.to);
  }

  function printBill(bill: BillRecord) {
    const ok = openPrintableBill(buildPrintableBillSnapshot(bill, [], [], {
      name: shop?.name, address: shop?.address, city: shop?.city, phone: shop?.phone, gstNumber: shop?.gstNumber,
    }));
    if (!ok) toast({ title: "Print blocked", description: "Allow pop-ups to print or save PDF.", variant: "destructive" });
  }

  async function shareOnWhatsapp(bill: BillRecord) {
    const customerMobile = await resolveBillCustomerMobile(bill as Record<string, unknown>);
    const shareInput = billRecordToShareInput(bill as Record<string, unknown>, {
      shopName: shop?.name,
      shopLocation: [shop?.city, shop?.address].filter(Boolean)[0] as string | undefined,
      customerMobile,
    });
    const { targetedCustomer } = shareBillOnWhatsapp(shareInput);
    toast({
      title: "Opening WhatsApp",
      description: targetedCustomer ? "Ready to send to the customer's number." : "Pick a chat to send this bill.",
    });
  }

  function refundReverse(bill: BillRecord) {
    navigate(`/bills/${bill.id}`);
  }

  function exportCsv() {
    const rows = checked.size > 0 ? filtered.filter((bill) => checked.has(bill.id)) : filtered;
    const header = ["Bill No", "Date", "Customer", "Mobile", "Items", "Total", "Paid", "Due", "Mode", "Status", "Sync"];
    const lines = rows.map((bill) => [
      billNo(bill), billDate(bill) ? new Date(billDate(bill)).toLocaleString("en-IN") : "", String(bill.customerName ?? "Walk-in"),
      String(bill.customerMobile ?? ""), itemsCount(bill) || "", billTotal(bill), billPaid(bill), billCredit(bill),
      modeLabel(paymentModeOf(bill)), statusLabel(paymentStatusOf(bill)), syncStatusOf(bill),
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
    if (action === "clear_estimates") return;
    if (action === "cancel" && !cancelPermission.allowed) {
      toast({ title: "Permission denied", description: cancelPermission.reason, variant: "destructive" });
      return;
    }
    setPinAction({ action, bill });
  }

  function requestEstimateCleanup() {
    const rows = filter === "estimate" ? estimatesInView : activeEstimateRows(bills);
    if (rows.length === 0) {
      toast({ title: "No estimates to clear", description: "Estimate bills are already clean." });
      return;
    }
    setPinAction({ action: "clear_estimates", bills: rows });
  }

  async function runPinAction(ownerPin: string, reason: string) {
    if (!pinAction) return;
    setIsSaving(true);
    try {
      if (pinAction.action === "clear_estimates") {
        const rows = activeEstimateRows(pinAction.bills);
        for (const bill of rows) {
          await softDeleteBillWithOwnerPinLocalFirst(bill.id, ownerPin, reason || "Estimate cleanup");
        }
        setChecked((prev) => {
          const next = new Set(prev);
          for (const bill of rows) next.delete(bill.id);
          return next;
        });
        toast({
          title: "Estimates moved to recycle bin",
          description: `${rows.length} estimate bill${rows.length === 1 ? "" : "s"} cleared from active bill history.`,
        });
      } else {
        if (pinAction.action === "cancel") await cancelBillWithOwnerPinLocalFirst(pinAction.bill.id, ownerPin, reason);
        if (pinAction.action === "delete") await softDeleteBillWithOwnerPinLocalFirst(pinAction.bill.id, ownerPin, reason);
        if (pinAction.action === "restore") await restoreBillWithOwnerPinLocalFirst(pinAction.bill.id, ownerPin, reason);
        toast({ title: "Saved locally", description: "Data is safe locally. Cloud backup will run automatically." });
      }
      setPinAction(null);
      await refetch();
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : "Please check owner PIN and try again.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  const deletingEstimate = pinAction?.action === "delete" && isEstimateBill(pinAction.bill);

  return (
    <div className="app-docked-page space-y-3 bg-transparent p-3.5 font-sans sm:p-5 lg:space-y-4 lg:bg-white 2xl:p-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="hidden flex-wrap items-center gap-2 lg:flex">
          <span className={cn("inline-flex h-10 items-center gap-2 rounded-[9px] border px-3 text-[11px] font-bold", backupStatus.cls)}>
            <BackupStatusIcon size={14} />
            <span>{backupStatus.label}</span>
            <span className="font-semibold opacity-70">{backupStatus.sub}</span>
          </span>
          {counts.pending > 0 && <Link href="/sync-status" className="inline-flex h-10 items-center rounded-[9px] border border-amber-200 bg-amber-50 px-3 text-[11px] font-bold text-amber-700">{counts.pending} pending sync</Link>}
        </div>
        <div className="grid grid-cols-2 items-center gap-2 lg:flex lg:flex-wrap">
          <div className="col-span-2 lg:contents">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-11 w-full justify-between rounded-[12px] border-[#dfe7f2] bg-white px-3 text-[12px] font-bold text-[#24385f] lg:h-10 lg:w-auto lg:min-w-[218px] lg:rounded-[8px]">
                  <span className="inline-flex items-center gap-2"><CalendarDays size={15} className="text-[var(--brand)]" />{formatRange(fromDate, toDate)}</span>
                  <ChevronDown size={13} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {(Object.keys(PERIOD_LABELS) as BillPeriod[]).map((key) => (
                  <DropdownMenuItem key={key} onClick={() => applyPeriod(key)} className={cn("text-[12px] font-semibold", period === key && "text-[var(--brand)]")}>{PERIOD_LABELS[key]}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button variant="outline" className="hidden h-10 rounded-[8px] border-[#dfe7f2] bg-white px-4 text-[12px] font-bold text-[#24385f] lg:inline-flex" onClick={() => document.getElementById("billing-history-table")?.scrollIntoView({ block: "start", behavior: "smooth" })}>
            <Filter size={15} /> Filters
          </Button>
          <Button onClick={exportCsv} disabled={filtered.length === 0} variant="outline" className="hidden h-10 rounded-[8px] border-[#dfe7f2] bg-white px-4 text-[12px] font-bold text-[var(--brand)] lg:inline-flex">
            <Download size={15} /> Export
          </Button>
          <Button onClick={requestEstimateCleanup} disabled={counts.estimates === 0 || isSaving} variant="outline" className="hidden h-10 rounded-[8px] border-rose-100 bg-white px-4 text-[12px] font-bold text-rose-600 hover:border-rose-200 hover:bg-rose-50 lg:inline-flex">
            <Trash2 size={15} /> Clear Estimates
          </Button>
          <Button asChild variant="outline" className="h-12 w-full rounded-[14px] border-[#dfe7f2] bg-white px-3 text-[11px] font-bold text-[var(--brand)] lg:h-10 lg:w-auto lg:rounded-[8px] lg:px-4 lg:text-[12px]">
            <Link href="/billing?billType=estimate"><FileText size={15} />New estimate</Link>
          </Button>
          <Button asChild className="h-12 w-full rounded-[14px] bg-[var(--brand)] px-3 text-[11px] font-bold text-white shadow-[0_9px_20px_var(--brand-shadow)] hover:bg-[var(--brand-strong)] lg:h-10 lg:w-auto lg:rounded-[8px] lg:px-5 lg:text-[12px]">
            <Link href="/billing?billType=normal_sale"><Plus size={15} />New pakka bill</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 items-stretch gap-2.5 lg:grid-cols-3 lg:gap-3 xl:grid-cols-6">
        <BillKpiCard label="Total Bills" value={String(analytics.totalBills)} delta={analytics.totalBillsDelta} data={analytics.sparks.totalBills} color={BLUE} icon={<ReceiptText size={17} />} iconClass="border-[#d3e2ff] bg-[var(--brand-soft)] text-[var(--brand)] shadow-[0_10px_22px_rgba(7,95,255,0.18)]" loading={isLoading} comparisonLabel={period === "all" ? "all time" : "vs last week"} />
        <BillKpiCard label="Total Sales" value={money(analytics.totalSales)} delta={analytics.totalSalesDelta} data={analytics.sparks.totalSales} color={PURPLE} icon={<IndianRupee size={17} />} iconClass="border-[#dfd3ff] bg-[#f1edff] text-[#7c3ff2] shadow-[0_10px_22px_rgba(124,63,242,0.18)]" loading={isLoading} comparisonLabel={period === "all" ? "all time" : "vs last week"} />
        <BillKpiCard mobileHidden label="Paid Bills" value={String(analytics.paidBills)} delta={analytics.paidBillsDelta} data={analytics.sparks.paidBills} color={GREEN} icon={<CheckCircle2 size={17} />} iconClass="border-[#c9efd5] bg-[#eaf9ef] text-[#19a84e] shadow-[0_10px_22px_rgba(25,184,90,0.18)]" loading={isLoading} comparisonLabel={period === "all" ? "all time" : "vs last week"} />
        <BillKpiCard label="Udhar Bills" value={String(analytics.udharBills)} delta={analytics.udharBillsDelta} data={analytics.sparks.udharBills} color={ORANGE} icon={<Wallet size={17} />} iconClass="border-[#ffe1b5] bg-[#fff3df] text-[#f28a00] shadow-[0_10px_22px_rgba(255,159,10,0.18)]" loading={isLoading} comparisonLabel={period === "all" ? "all time" : "vs last week"} deltaPositiveIsBad />
        <BillKpiCard mobileHidden label="Average Bill Value" value={money(analytics.avgBill)} delta={analytics.avgBillDelta} data={analytics.sparks.avgBill} color={BLUE} icon={<CreditCard size={17} />} iconClass="border-[#d3e2ff] bg-[var(--brand-soft)] text-[var(--brand)] shadow-[0_10px_22px_rgba(7,95,255,0.18)]" loading={isLoading} comparisonLabel={period === "all" ? "all time" : "vs last week"} />
        <BillKpiCard label="Cancelled Bills" value={String(analytics.cancelledBills)} delta={analytics.cancelledBillsDelta} data={analytics.sparks.cancelledBills} color={RED} icon={<Ban size={17} />} iconClass="border-[#ffcfd8] bg-[#ffecef] text-[#ff314f] shadow-[0_10px_22px_rgba(255,49,79,0.18)]" loading={isLoading} comparisonLabel={period === "all" ? "all time" : "vs last week"} deltaPositiveIsBad />
      </div>

      <section id="billing-history-table" className={cn(CARD, "overflow-hidden")}>
        <div className="flex flex-col gap-3 border-b border-[#e8edf4] p-3">
          <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            {/* A rail of filters that runs off the right edge. `scroll-rail`
                fades the last few pixels on phones so it reads as "there is
                more", and the taller chip is the thumb-sized version of the
                36px one the desktop keeps. */}
            <div className="scroll-rail -mx-1 flex min-w-0 gap-1 overflow-x-auto px-1" role="tablist" aria-label="Filter bills">
              {BILL_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={filter === tab.value}
                  onClick={() => setFilter(tab.value)}
                  className={cn(
                    "h-11 whitespace-nowrap rounded-[9px] border px-4 text-[12px] font-bold transition-colors lg:h-9 lg:rounded-[7px]",
                    filter === tab.value
                      ? "border-[#d8e6ff] bg-[var(--brand-soft)] text-[var(--brand)] shadow-[0_5px_12px_rgba(7,95,255,0.08)]"
                      : "border-transparent bg-white text-[#24385f] hover:bg-[var(--brand-softer)]",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_190px_150px_40px] xl:w-[760px]">
              <div className="relative min-w-0">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7f8da5]" />
                <Input className="h-10 rounded-[8px] border-[#dfe7f2] bg-white pl-9 text-[12px] font-medium shadow-none placeholder:text-[#71809b] focus-visible:ring-0" placeholder="Search by bill no, customer, mobile..." value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <Select value={modeFilter} onValueChange={(value) => setModeFilter(value as ModeFilter)}>
                <SelectTrigger className="h-10 rounded-[8px] border-[#dfe7f2] bg-white text-[12px] font-bold text-[#24385f]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Payment Modes</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="split">Split</SelectItem>
                  <SelectItem value="udhar">Credit (Udhar)</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
              <Select value={staffFilter} onValueChange={setStaffFilter}>
                <SelectTrigger className="h-10 rounded-[8px] border-[#dfe7f2] bg-white text-[12px] font-bold text-[#24385f]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Staff</SelectItem>
                  {staffOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" className="h-10 w-10 rounded-[8px] border-[#dfe7f2] bg-white text-[var(--brand)]" onClick={() => { setSearch(""); setModeFilter("all"); setStaffFilter("all"); setFilter("all"); applyPeriod("all"); void refetch(); }} aria-label="Clear filters">
                <SlidersHorizontal size={15} />
              </Button>
            </div>
          </div>
          {(counts.deleted > 0 || counts.pending > 0 || counts.estimates > 0) && (
            <div className="flex flex-wrap gap-2 text-[10px] font-bold">
              {counts.estimates > 0 && <span className="rounded-full bg-[#f5f0ff] px-2.5 py-1 text-[#6d3df0]">{counts.estimates} estimate bills separated</span>}
              {counts.deleted > 0 && <span className="rounded-full bg-[#eef2f8] px-2.5 py-1 text-[#64748b]">{counts.deleted} in recycle bin</span>}
              {counts.pending > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{counts.pending} waiting for backup</span>}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="grid h-52 place-items-center text-[13px] font-semibold text-[#7a879f]">Loading bill history...</div>
        ) : filtered.length === 0 ? (
          <div className="grid h-56 place-items-center px-4 text-center">
            <div>
              <ReceiptText size={28} className="mx-auto text-[#9aa8bc]" />
              <p className="mt-2 text-[14px] font-bold text-[var(--brand-ink)]">No bills found</p>
              <p className="mt-1 text-[12px] text-[#7a879f]">Try a different filter or create a new bill.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2.5 p-3 md:hidden">
              {pageRows.map((bill) => {
                const date = formatBillDateParts(billDate(bill));
                const status = paymentStatusOf(bill);
                const mode = paymentModeOf(bill);
                const sync = syncStatusOf(bill);
                const deleted = isDeleted(bill);
                const estimate = isEstimateBill(bill);
                return (
                  <article key={bill.id} className={cn("rounded-[16px] border border-[#e4ebf4] bg-white p-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.05)]", deleted && "opacity-70")}>
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/bills/${bill.id}`} className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-extrabold text-[var(--brand)]">Bill #{compactBillNo(billNo(bill))}</p>
                        <p className="mt-1 truncate text-xs font-bold text-[var(--brand-ink)]">{bill.customerName || "Walk-in Customer"}</p>
                        <p className="mt-0.5 text-[11px] font-medium text-[#71809b]">{date.date} {date.time ? `• ${date.time}` : ""} • {itemsCount(bill) || 0} items</p>
                      </Link>
                      <div className="text-right">
                        <p className="text-[15px] font-black text-[var(--brand-ink)]">{money(billTotal(bill))}</p>
                        <div className="mt-1 flex justify-end"><StatusBadge status={status} /></div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ModeBadge mode={mode} />
                      <span className="rounded-[6px] bg-[var(--brand-soft)] px-2 py-1 text-[10px] font-black text-[var(--brand)]">{billTypeOf(bill)}</span>
                      <SyncBadgeMini sync={sync} />
                    </div>
                    {/* This is the phone card's whole action set, so each button
                        gets the full 44px rather than the desktop row's 36px. */}
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      <button type="button" className="h-11 rounded-[10px] border border-[#dfe7f2] bg-white text-[var(--brand)] active:scale-95" onClick={() => navigate(`/bills/${bill.id}`)} aria-label="View bill"><Eye size={16} className="mx-auto" /></button>
                      <button type="button" className="h-11 rounded-[10px] border border-[#dfe7f2] bg-white text-[var(--brand)] active:scale-95" onClick={() => printBill(bill)} aria-label="Print bill"><Printer size={16} className="mx-auto" /></button>
                      <button type="button" className="h-11 rounded-[10px] border border-[#dfe7f2] bg-white text-[var(--brand)] active:scale-95" onClick={() => void shareOnWhatsapp(bill)} aria-label="Share bill"><Share2 size={16} className="mx-auto" /></button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="h-11 rounded-[10px] border border-[#dfe7f2] bg-white text-[#405273] active:scale-95" aria-label={`More actions for ${billNo(bill)}`}><MoreVertical size={16} className="mx-auto" /></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem asChild><Link href={`/bills/${bill.id}`}><span className="flex items-center"><FileText size={14} className="mr-2" /> Open bill page</span></Link></DropdownMenuItem>
                          <DropdownMenuItem onClick={() => refundReverse(bill)}><RotateCcw size={14} className="mr-2" /> Return / refund</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {deleted ? (
                            <DropdownMenuItem onClick={() => requestPinAction("restore", bill)}><RotateCcw size={14} className="mr-2" /> Restore bill</DropdownMenuItem>
                          ) : (
                            <>
                              {bill.status !== "cancelled" && <DropdownMenuItem className="text-amber-600 focus:text-amber-700" onClick={() => requestPinAction("cancel", bill)}><ShieldCheck size={14} className="mr-2" /> Cancel bill</DropdownMenuItem>}
                              <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={() => requestPinAction("delete", bill)}><Trash2 size={14} className="mr-2" /> {estimate ? "Move estimate to recycle bin" : "Move to recycle bin"}</DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="app-table-scroll hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1240px] border-collapse text-[11px]">
                <thead>
                  <tr className={TABLE_HEAD}>
                    <th className="w-9 px-4 py-2.5 text-left">
                      <input type="checkbox" className="h-3.5 w-3.5 rounded border-[#cbd5e1] accent-[var(--brand)]" aria-label="Select all bills on page" checked={pageRows.length > 0 && pageRows.every((bill) => checked.has(bill.id))} onChange={toggleAllOnPage} />
                    </th>
                    {["Bill No", "Customer", "Date & Time", "Items", "Payment Mode", "Bill Type", "Amount", "Status", "Staff", "Sync", "Action"].map((header) => (
                      <th key={header} className={cn("px-4 py-2.5 font-bold", ["Items", "Amount"].includes(header) ? "text-right" : "text-left")}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8edf4]">
                  {pageRows.map((bill) => {
                    const date = formatBillDateParts(billDate(bill));
                    const status = paymentStatusOf(bill);
                    const mode = paymentModeOf(bill);
                    const sync = syncStatusOf(bill);
                    const deleted = isDeleted(bill);
                    const estimate = isEstimateBill(bill);
                    return (
                      <tr key={bill.id} className={cn("text-[#24385f] transition-colors hover:bg-[#fbfcfe]", deleted && "bg-[#f8fafc] opacity-70")}>
                        <td className="px-4 py-2.5">
                          <input type="checkbox" className="h-3.5 w-3.5 rounded border-[#cbd5e1] accent-[var(--brand)]" aria-label={`Select bill ${billNo(bill)}`} checked={checked.has(bill.id)} onChange={() => toggleOne(bill.id)} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-black text-[var(--brand)]">{compactBillNo(billNo(bill))}</td>
                        <td className="min-w-[145px] px-4 py-2.5">
                          <p className="font-bold text-[var(--brand-ink)]">{bill.customerName || "Walk-in Customer"}</p>
                          <p className="mt-0.5 text-[#6f7f9b]">{bill.customerMobile || "-"}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <p className="font-semibold">{date.date}</p>
                          <p className="mt-0.5 text-[#6f7f9b]">{date.time}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold">{itemsCount(bill) || "-"}</td>
                        <td className="px-4 py-2.5"><ModeBadge mode={mode} /></td>
                        <td className="px-4 py-2.5"><span className="rounded-[5px] bg-[var(--brand-soft)] px-2 py-1 text-[10px] font-black text-[var(--brand)]">{billTypeOf(bill)}</span></td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right font-black text-[var(--brand-ink)]">{money(billTotal(bill))}</td>
                        <td className="px-4 py-2.5"><StatusBadge status={status} /></td>
                        <td className="px-4 py-2.5 font-semibold">{staffNameOf(bill, staffFallback)}</td>
                        <td className="px-4 py-2.5"><SyncBadgeMini sync={sync} /></td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <ActionIcon title="View bill" onClick={() => navigate(`/bills/${bill.id}`)}><Eye size={13} /></ActionIcon>
                            <ActionIcon title="Print bill" onClick={() => printBill(bill)}><Printer size={13} /></ActionIcon>
                            <ActionIcon title="Share bill" onClick={() => void shareOnWhatsapp(bill)}><Share2 size={13} /></ActionIcon>
                            {estimate && !deleted && (
                              <button
                                type="button"
                                title="Delete estimate"
                                onClick={() => requestPinAction("delete", bill)}
                                className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-[7px] border border-rose-200 bg-rose-50 px-2.5 text-[11px] font-bold text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-100"
                              >
                                <Trash2 size={13} /> Delete
                              </button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="grid h-8 w-8 place-items-center rounded-[7px] border border-[#dfe7f2] bg-white text-[#405273] transition-colors hover:border-[#c7d8ef] hover:bg-[var(--brand-softer)]" aria-label={`More actions for ${billNo(bill)}`}><MoreVertical size={14} /></button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem asChild><Link href={`/bills/${bill.id}`}><span className="flex items-center"><FileText size={14} className="mr-2" /> Open bill page</span></Link></DropdownMenuItem>
                                <DropdownMenuItem onClick={() => refundReverse(bill)}><RotateCcw size={14} className="mr-2" /> Return / refund</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {deleted ? (
                                  <DropdownMenuItem onClick={() => requestPinAction("restore", bill)}><RotateCcw size={14} className="mr-2" /> Restore bill</DropdownMenuItem>
                                ) : (
                                  <>
                                    {bill.status !== "cancelled" && <DropdownMenuItem className="text-amber-600 focus:text-amber-700" onClick={() => requestPinAction("cancel", bill)}><ShieldCheck size={14} className="mr-2" /> Cancel bill</DropdownMenuItem>}
                                    <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={() => requestPinAction("delete", bill)}><Trash2 size={14} className="mr-2" /> {estimate ? "Move estimate to recycle bin" : "Move to recycle bin"}</DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col items-center justify-between gap-3 border-t border-[#e8edf4] px-4 py-3 sm:flex-row">
              <span className="text-[11px] font-medium text-[#60708e]">Showing {(safePage - 1) * perPage + 1} to {Math.min(safePage * perPage, filtered.length)} of {filtered.length} entries</span>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <PageBtn ariaLabel="Previous page" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}><ChevronLeft size={14} aria-hidden="true" /></PageBtn>
                  {Array.from({ length: pageCount }, (_, idx) => idx + 1)
                    .filter((p) => p === 1 || p === pageCount || Math.abs(p - safePage) <= 1)
                    .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                      if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("...");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, idx) => p === "..."
                      ? <span key={`gap-${idx}`} className="px-1 text-[12px] text-[#94a3b8]">...</span>
                      : <PageBtn key={p} active={p === safePage} onClick={() => setPage(p as number)}>{p}</PageBtn>)}
                  <PageBtn ariaLabel="Next page" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}><ChevronRight size={14} aria-hidden="true" /></PageBtn>
                </div>
                <Select value={String(perPage)} onValueChange={(value) => setPerPage(Number(value))}>
                  <SelectTrigger aria-label="Bills per page" className="h-8 w-[70px] rounded-[7px] border-[#dfe7f2] text-[11px] font-bold"><SelectValue /></SelectTrigger>
                  <SelectContent>{[10, 20, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.75fr_0.8fr]">
        <RecentActivityCard rows={recentActivities} />
        <PaymentBreakdownCard rows={paymentBreakdown} total={paymentBreakdown.reduce((sum, row) => sum + row.value, 0)} period={PERIOD_LABELS[period]} />
        <TopCustomersCard rows={topCustomers} />
      </div>

      <OwnerPinModal
        open={!!pinAction}
        onCancel={() => setPinAction(null)}
        title={pinAction?.action === "clear_estimates" ? "Clear estimate bills" : pinAction?.action === "restore" ? "Restore bill" : pinAction?.action === "cancel" ? "Cancel bill" : deletingEstimate ? "Delete estimate" : "Move bill to recycle bin"}
        description={pinAction?.action === "clear_estimates" ? `Owner PIN is required. ${pinAction.bills.length} estimate bill${pinAction.bills.length === 1 ? "" : "s"} will move to recycle bin. Estimates count as sales — cancel a bill first if you need its stock and udhar reversed.` : deletingEstimate ? "Enter your owner PIN to delete this estimate. It moves to the recycle bin like any bill — cancel it instead if you need stock and udhar reversed." : "Owner PIN is required. Financial records are never hard deleted and this action is saved locally first."}
        confirmLabel={pinAction?.action === "clear_estimates" ? "Clear estimates" : pinAction?.action === "restore" ? "Restore" : pinAction?.action === "cancel" ? "Cancel bill" : deletingEstimate ? "Delete estimate" : "Move to recycle bin"}
        reasonRequired={pinAction?.action === "cancel" || pinAction?.action === "delete" || pinAction?.action === "clear_estimates"}
        loading={isSaving}
        onConfirm={({ ownerPin, reason }) => runPinAction(ownerPin, reason)}
      />
    </div>
  );
}

function BillKpiCard({ label, value, delta, data, color, icon, iconClass, loading, comparisonLabel, deltaPositiveIsBad, mobileHidden = false }: {
  label: string;
  value: string;
  delta: number;
  data: Array<{ label: string; value: number }>;
  color: string;
  icon: ReactNode;
  iconClass: string;
  loading?: boolean;
  comparisonLabel?: string;
  deltaPositiveIsBad?: boolean;
  mobileHidden?: boolean;
}) {
  const positive = delta > 0;
  const bad = deltaPositiveIsBad ? positive : delta < 0;
  const DeltaIcon = delta === 0 ? null : positive ? ArrowUpRight : ArrowDownRight;
  const gradientId = `bill-kpi-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <article className={cn(CARD, "h-[126px] min-w-0 flex-col overflow-hidden rounded-[18px] p-3.5 lg:h-[150px] lg:rounded-[12px] lg:p-4", mobileHidden ? "hidden md:flex" : "flex")}>
      <div className="grid h-10 grid-cols-[36px_minmax(0,1fr)] items-start gap-3">
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[9px] border", iconClass)}>{icon}</span>
        <p className="min-h-[30px] min-w-0 overflow-hidden pt-0.5 text-[12px] font-semibold leading-[15px] text-[#34486e]">{label}</p>
      </div>
      <p className="mt-2 min-h-[24px] truncate font-display text-[22px] font-black leading-none text-[var(--brand-ink)]">{loading ? "..." : value}</p>
      <div className="mt-2 flex h-4 items-center gap-1 text-[10px]">
        <span className={cn("inline-flex items-center gap-0.5 font-black", delta === 0 ? "text-[#70809a]" : bad ? "text-[#ff334d]" : "text-[#10a948]")}>
          {DeltaIcon ? <DeltaIcon size={11} /> : null}{Math.abs(delta)}%
        </span>
        <span className="font-semibold text-[#7a879f]">{comparisonLabel ?? "vs last week"}</span>
      </div>
      <div className="mt-auto hidden h-9 pt-2 lg:block">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 1, left: 1, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.30} />
                <stop offset="68%" stopColor={color} stopOpacity={0.08} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.9} fill={`url(#${gradientId})`} dot={{ r: 1.8, fill: "white", stroke: color, strokeWidth: 1.2 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const meta = MODE_META[mode] ?? MODE_META.cash;
  return <span className={cn("inline-flex items-center gap-2 whitespace-nowrap rounded-[6px] px-2 py-1 text-[10px] font-black", meta.chip)}><span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />{meta.label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={cn("rounded-[6px] px-2 py-1 text-[10px] font-black", STATUS_CLS[status] ?? STATUS_CLS.Pending)}>{statusLabel(status)}</span>;
}

function SyncBadgeMini({ sync }: { sync: string }) {
  const ok = sync === "synced";
  const failed = sync === "failed" || sync === "conflict";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[10px] font-black", ok ? CHIP_TONES.green : failed ? CHIP_TONES.red : CHIP_TONES.amber)}>
      {ok ? <CheckCircle2 size={11} /> : <Clock3 size={11} />}{ok ? "Synced" : sync.replaceAll("_", " ")}
    </span>
  );
}

function ActionIcon({ title, children, onClick }: { title: string; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="tap-target grid h-8 w-8 place-items-center rounded-[7px] border border-[#dfe7f2] bg-white text-[var(--brand)] transition-colors hover:border-[#c7d8ef] hover:bg-[var(--brand-soft)]">
      {children}
    </button>
  );
}

function PageBtn({ children, active, disabled, ariaLabel, onClick }: { children: ReactNode; active?: boolean; disabled?: boolean; ariaLabel?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "tap-target grid h-8 min-w-8 place-items-center rounded-[7px] border px-2 text-[12px] font-black transition-colors",
        active ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[#dfe7f2] bg-white text-[#405273] hover:bg-[var(--brand-softer)] disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}

function RecentActivityCard({ rows }: { rows: Array<{ id: string; title: string; sub: string; time: string; tone: string; bill: BillRecord }> }) {
  const toneClass = (tone: string) => tone === "emerald" ? "bg-[#eaf9ef] text-[#119447]" : tone === "orange" ? "bg-[#fff3df] text-[#f28a00]" : "bg-[#ffecef] text-[#ff314f]";
  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <header className="flex h-12 items-center justify-between border-b border-[#e8edf4] px-4">
        <h2 className="text-[14px] font-extrabold text-[var(--brand-ink)]">Recent Billing Activity</h2>
        <Link href="/bills" className="tap-target text-[11px] font-bold text-[var(--brand)]">View all</Link>
      </header>
      <div className="divide-y divide-[#edf2f8]">
        {rows.length === 0 ? (
          <div className="grid h-44 place-items-center text-[12px] font-semibold text-[#8290a8]">No bill activity in this period</div>
        ) : rows.map((row) => (
          <Link key={row.id} href={`/bills/${row.bill.id}`} className="grid grid-cols-[34px_1fr_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-[#fbfcfe]">
            <span className={cn("grid h-8 w-8 place-items-center rounded-full", toneClass(row.tone))}><IndianRupee size={14} /></span>
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-black text-[var(--brand-ink)]">{row.title}</span>
              <span className="mt-0.5 block truncate text-[10.5px] font-semibold text-[#6f7f9b]">{row.sub}</span>
            </span>
            <span className="text-[10.5px] font-semibold text-[#405273]">{row.time}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function PaymentBreakdownCard({ rows, total, period }: { rows: Array<{ key: string; label: string; value: number; color: string }>; total: number; period: string }) {
  const chartRows = rows.length > 0 ? rows : [{ key: "empty", label: "No sales", value: 1, color: "#e5eaf2" }];
  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <header className="flex h-12 items-center justify-between border-b border-[#e8edf4] px-4">
        <h2 className="text-[14px] font-extrabold text-[var(--brand-ink)]">Payment Mode Breakdown</h2>
        <span className="rounded-[6px] border border-[#dfe7f2] bg-[#fbfcfe] px-2.5 py-1 text-[10px] font-bold text-[#405273]">{period}</span>
      </header>
      <div className="grid min-h-[220px] items-center gap-3 px-4 py-4 sm:grid-cols-[184px_1fr]">
        <div className="relative mx-auto h-[176px] w-[176px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={chartRows} dataKey="value" nameKey="label" innerRadius={56} outerRadius={84} paddingAngle={1.5} stroke="#fff" strokeWidth={3}>
                {chartRows.map((row) => <Cell key={row.key} fill={row.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-[16px] font-black text-[#13244a]">{money(total)}</p>
              <p className="mt-1 text-[10px] text-[#7886a0]">Total Sales</p>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          {rows.length === 0 ? <p className="text-center text-[12px] font-semibold text-[#8290a8]">No payment activity</p> : rows.map((row) => {
            const pct = total > 0 ? (row.value / total) * 100 : 0;
            return (
              <div key={row.key} className="grid grid-cols-[10px_1fr_auto] items-center gap-2 text-[11px]">
                <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />
                <span className="font-semibold text-[#2c3f64]">{row.label}</span>
                <span className="font-black text-[#15264b]">{money(row.value)} <em className="font-normal not-italic text-[#75839d]">({pct.toFixed(1)}%)</em></span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TopCustomersCard({ rows }: { rows: Array<{ name: string; bills: number; total: number }> }) {
  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <header className="flex h-12 items-center justify-between border-b border-[#e8edf4] px-4">
        <h2 className="text-[14px] font-extrabold text-[var(--brand-ink)]">Top Customers</h2>
        <Link href="/customers" className="tap-target text-[11px] font-bold text-[var(--brand)]">View all</Link>
      </header>
      {rows.length === 0 ? (
        <div className="grid h-44 place-items-center text-[12px] font-semibold text-[#8290a8]">No customer sales in this period</div>
      ) : (
        <div className="overflow-x-auto px-3 pb-3">
          <table className="w-full text-[10.5px]">
            <thead>
              <tr className="border-y border-[#e6ecf4] bg-[#f7f9fc] text-[#52617c]">
                <th className="px-2 py-2 text-left font-bold">Customer</th>
                <th className="px-2 py-2 text-right font-bold">Total Bills</th>
                <th className="px-2 py-2 text-right font-bold">Total Spent</th>
                <th className="px-2 py-2 text-right font-bold">Avg. Bill Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8edf4]">
              {rows.map((row) => (
                <tr key={row.name} className="text-[#24385f]">
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-2 font-black"><span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><User size={12} /></span>{row.name}</span>
                  </td>
                  <td className="px-2 py-2 text-right font-bold">{row.bills}</td>
                  <td className="px-2 py-2 text-right font-black">{money(row.total)}</td>
                  <td className="px-2 py-2 text-right font-bold">{money(row.bills ? row.total / row.bills : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
