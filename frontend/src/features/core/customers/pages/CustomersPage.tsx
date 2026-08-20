import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Download,
  FileText,
  Filter,
  Info,
  Landmark,
  MapPin,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Phone,
  Plus,
  Search,
  Star,
  Trash2,
  UserCheck,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { SyncBadge, TradeFocusStrip } from "@/components/shared";
import { CHIP_TONES } from "@/lib/chip-tones";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { createCustomerLocalFirst, deleteCustomerLocalFirst, updateCustomerLocalFirst } from "@/features/core/customers/local-actions";
import { recordPaymentLocalFirst } from "@/features/core/payments/local-actions";
import { useOfflineStatus } from "@/features/core/sync";
import { dedupePaymentsForDisplay } from "@/features/core/sync/bill-reconciliation";
import {
  applyAuthoritativeUdharSummary,
  loadCustomerDetail,
  loadCustomersWithLedger,
  projectCustomerOutstanding,
  readCachedCustomersWithLedger,
  formatShortDate,
  toLedgerDriftCandidates,
  type CustomerDetailData,
  type CustomerWithLedger,
} from "@/features/core/customers/customer-ledger-data";
import { loadCachedAuthoritativeSummary, resolveAuthoritativeUdharSummary } from "@/features/core/ledger/authoritative-balances";
import { repairLedgerDriftFromServer } from "@/features/core/ledger/ledger-drift-repair";
import { isManualAdjustmentEntry } from "@/features/core/ledger/accounting";
import type { CustomerInput } from "@/types/api";
import { useAppLanguage, type Translate, type TranslationKey } from "@/features/core/settings/i18n";
import { useBusinessTypeKey } from "@/features/core/settings/business-types";
import { getShopCustomersProfile } from "@/features/core/settings/shop-customers";
import { offlineDB } from "@/lib/offline/db";
import {
  addMoney,
  formatMoney as formatRupees,
  moneyExceeds,
  roundMoney,
} from "@/lib/money";
import { cn } from "@/lib/utils";
import { validateGstin } from "@/lib/gstin";
import { escapeHtml } from "@/lib/escape-html";

interface CustomerFormState {
  name: string;
  mobile: string;
  address: string;
  gstNumber: string;
  stateCode: string;
  type: "regular" | "udhar";
  dueDate: string;
  promiseToPayDate: string;
  udharLimit: string;
  notes: string;
}

interface PaymentFormState {
  customerId: string;
  amount: string;
  mode: "cash" | "upi" | "bank" | "split";
  cashAmount: string;
  upiAmount: string;
  note: string;
}

interface CustomerOverviewActivity {
  payments: Array<Record<string, unknown>>;
  ledger: Array<Record<string, unknown>>;
}

function blankCustomerForm(): CustomerFormState {
  return { name: "", mobile: "", address: "", gstNumber: "", stateCode: "", type: "regular", dueDate: "", promiseToPayDate: "", udharLimit: "", notes: "" };
}

function useCustomersLedgerList() {
  const queryClient = useQueryClient();
  const { t } = useAppLanguage();
  const authoritativeAppliedAtRef = useRef(0);
  const listKey = ["customers-ledger-list"] as const;
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: listKey });
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [queryClient]);

  const localQuery = useQuery({
    queryKey: listKey,
    initialData: readCachedCustomersWithLedger(),
    queryFn: async () => {
      // First paint uses only local IndexedDB plus the last safe server summary.
      // The live server refresh below runs in parallel and never blocks the list.
      const [localCustomers, cached] = await Promise.all([
        loadCustomersWithLedger(),
        loadCachedAuthoritativeSummary(),
      ]);
      return cached?.summary ? applyAuthoritativeUdharSummary(localCustomers, cached.summary) : localCustomers;
    },
    staleTime: 1_500,
    // The synchronous cache is only a first-frame placeholder. Always start
    // the IndexedDB ledger read on mount instead of treating that cache as a
    // freshly fetched result for the whole stale window.
    refetchOnMount: "always",
  });

  const authoritativeQuery = useQuery({
    queryKey: ["customers-authoritative-summary-refresh"],
    queryFn: resolveAuthoritativeUdharSummary,
    staleTime: 10_000,
  });

  useEffect(() => {
    const resolved = authoritativeQuery.data;
    if (!resolved?.summary) return;
    const current = queryClient.getQueryData<CustomerWithLedger[]>(listKey) ?? [];
    if (current.length === 0 || authoritativeAppliedAtRef.current === authoritativeQuery.dataUpdatedAt) return;
    authoritativeAppliedAtRef.current = authoritativeQuery.dataUpdatedAt;
    queryClient.setQueryData(listKey, applyAuthoritativeUdharSummary(current, resolved.summary));
    if (resolved.source !== "server") return;

    // Repair a drifted device replica after the correct server numbers are
    // already visible. A successful repair invalidates the list and re-reads it.
    void repairLedgerDriftFromServer(toLedgerDriftCandidates(current), resolved.summary)
      .then((repaired) => {
        if (repaired) return queryClient.invalidateQueries({ queryKey: listKey });
        return undefined;
      })
      .catch(() => undefined);
  }, [authoritativeQuery.data, authoritativeQuery.dataUpdatedAt, localQuery.data, queryClient]);

  return localQuery;
}

function money(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? roundMoney(num) : 0;
}

function fmtMoney(value: unknown) {
  return formatRupees(money(value));
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "CU";
}

function customerDedupeKey(customer: CustomerWithLedger) {
  const mobile = String(customer.mobile ?? "").replace(/\D/g, "");
  if (mobile) return `mobile:${mobile}`;
  return `name:${customer.name.trim().toLowerCase()}|address:${String(customer.address ?? "").trim().toLowerCase()}`;
}

function chooseBestCustomer(current: CustomerWithLedger, candidate: CustomerWithLedger) {
  const candidateSynced = !String(candidate.id).startsWith("local_") && candidate.sync_status !== "pending_sync";
  const currentSynced = !String(current.id).startsWith("local_") && current.sync_status !== "pending_sync";
  if (candidateSynced !== currentSynced) return candidateSynced ? candidate : current;
  if (Math.abs(candidate.ledgerBalance) !== Math.abs(current.ledgerBalance)) return Math.abs(candidate.ledgerBalance) > Math.abs(current.ledgerBalance) ? candidate : current;
  const candidateTime = new Date(candidate.updatedAt ?? candidate.createdAt ?? 0).getTime();
  const currentTime = new Date(current.updatedAt ?? current.createdAt ?? 0).getTime();
  return candidateTime >= currentTime ? candidate : current;
}

// Returns a translation key rather than text: this is module scope and cannot
// call the `t()` hook. Callers resolve `labelKey` where they render it.
function riskInfo(customer: CustomerWithLedger): { labelKey: TranslationKey; cls: string; dot: string } {
  const balance = Math.max(0, customer.ledgerBalance);
  const limit = Number(customer.udharLimit ?? 0);
  if (balance <= 0) return { labelKey: "customers.noDue", cls: "bg-[#eef2f8] text-[#52627e]", dot: "bg-[#94a3b8]" };
  // With a limit: risk scales by utilisation. Without one: by absolute exposure.
  const ratio = limit > 0 ? balance / limit : balance / 10_000;
  if (customer.ledgerMetrics.isBadCustomer || ratio > 0.8) {
    return { labelKey: "customers.risk.high", cls: "bg-rose-50 text-rose-600 ring-rose-100", dot: "bg-rose-500" };
  }
  if (ratio > 0.35) return { labelKey: "customers.risk.medium", cls: "bg-amber-50 text-amber-700 ring-amber-100", dot: "bg-amber-500" };
  return { labelKey: "customers.risk.low", cls: "bg-emerald-50 text-emerald-700 ring-emerald-100", dot: "bg-emerald-500" };
}

function trustBadge(customer: CustomerWithLedger) {
  const score = customer.ledgerMetrics.trustScore;
  if (score >= 75) return { label: `Trusted ${score}`, cls: "bg-emerald-50 text-emerald-700" };
  if (score >= 45) return { label: `Watch ${score}`, cls: "bg-amber-50 text-amber-700" };
  return { label: `Risk ${score}`, cls: "bg-rose-50 text-rose-700" };
}

function getAmount(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(row[key] ?? 0);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function getDate(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function customerOverdueDays(customer: CustomerWithLedger): number {
  if (customer.ledgerBalance <= 0) return 0;
  const dueDate = customer.dueDate ? new Date(`${customer.dueDate}T00:00:00`).getTime() : NaN;
  if (Number.isFinite(dueDate)) return Math.max(0, Math.floor((Date.now() - dueDate) / 86_400_000));
  if (customer.ledgerMetrics.ageing.thirtyPlus > 0) return 30;
  if (customer.ledgerMetrics.ageing.sevenToThirty > 0) return 8;
  return 0;
}

function formatCustomerActivityDateTime(value: unknown): string {
  if (!value) return "No udhar activity";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "No udhar activity";
  return `${formatShortDate(date.toISOString())}, ${date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

function latestCustomerUdharActivity(customer: CustomerWithLedger): string | null {
  const times = [customer.ledgerMetrics.lastBillAt, customer.ledgerMetrics.lastPaymentAt]
    .map((value) => ({ value, time: value ? new Date(value).getTime() : NaN }))
    .filter((row): row is { value: string; time: number } => typeof row.value === "string" && Number.isFinite(row.time));
  if (times.length === 0) return null;
  return times.sort((a, b) => b.time - a.time)[0].value;
}

async function loadCustomerOverviewActivity(): Promise<CustomerOverviewActivity> {
  const [payments, ledger] = await Promise.all([
    offlineDB.getAll<Record<string, unknown>>("payments").catch(() => []),
    offlineDB.getAll<Record<string, unknown>>("customer_ledger").catch(() => []),
  ]);
  return { payments: dedupePaymentsForDisplay(payments), ledger };
}

function inputDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBefore(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return inputDate(date);
}

function inDateRange(value: unknown, from: string, to: string): boolean {
  if (!value) return false;
  const time = new Date(String(value)).getTime();
  if (!Number.isFinite(time)) return false;
  return time >= new Date(`${from}T00:00:00`).getTime() && time <= new Date(`${to}T23:59:59.999`).getTime();
}

function paymentAmount(row: Record<string, unknown>): number {
  return getAmount(row, ["amount", "paidAmount", "paid_amount"]);
}

function paymentDate(row: Record<string, unknown>): string {
  return getDate(row, ["paidAt", "paid_at", "createdAt", "created_at"]);
}

const LEDGER_DATE_KEYS = ["businessDate", "business_date", "entry_at", "createdAt", "created_at"];

function ledgerEntryDate(row: Record<string, unknown>): string {
  return getDate(row, LEDGER_DATE_KEYS);
}

// After sync the table holds BOTH the local optimistic row and the server echo,
// with the local twin tombstoned. Counting raw rows doubles every figure.
function isLiveLedgerRow(row: Record<string, unknown>): boolean {
  return !(row.deleted_at ?? row.deletedAt ?? row.merged_into_id ?? row.mergedIntoId);
}

// "Received" on this page means udhar RECOVERED, so it must come from the customer
// ledger, not the `payments` table — that table also holds bill tender for ordinary
// cash/UPI sales, and summing it reports shop revenue as khata collections.
function udharCollectionAmount(row: Record<string, unknown>): number {
  const type = String(row.type ?? row.source_type ?? "").toUpperCase();
  if (!type.includes("PAYMENT")) return 0;
  if (row.reversedAt ?? row.reversed_at) return 0;
  const amount = Number(row.amount ?? 0);
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

function ledgerSignedAmount(row: Record<string, unknown>): number {
  const amount = Number(row.amount ?? 0);
  if (!Number.isFinite(amount)) return 0;
  const type = String(row.type ?? row.source_type ?? "").toUpperCase();
  if (type.includes("PAYMENT") || type.includes("CANCEL")) return -Math.abs(amount);
  if (type.includes("BILL") || type === "DEBIT" || type === "CREDIT") return Math.abs(amount);
  return amount;
}

function percentageChange(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1_000) / 10;
}

export default function CustomersPage() {
  const { t } = useAppLanguage();
  // Who the person on the other side of the counter is here — the sidebar
  // already reached this screen as "Khata", "Accounts" or "Tabs", and the
  // credit word comes from the same map the report reads.
  const tradeProfile = getShopCustomersProfile(useBusinessTypeKey());
  const creditWord = t(tradeProfile.creditWordKey);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { pendingCount, failedCount } = useOfflineStatus();
  const { data: customers = [], isLoading, refetch } = useCustomersLedgerList();
  const overviewQuery = useQuery({ queryKey: ["customers-overview-activity"], queryFn: loadCustomerOverviewActivity, staleTime: 1_500 });
  const [search, setSearch] = useState("");
  const [rangeFrom, setRangeFrom] = useState(daysBefore(6));
  const [rangeTo, setRangeTo] = useState(inputDate(new Date()));
  // Honor a ?filter= deep link (e.g. dashboard "Khata" cards link to /customers?filter=udhar).
  const [filter, setFilter] = useState<"all" | "udhar" | "bad" | "due" | "promise" | "cleared">(() => {
    if (typeof window === "undefined") return "all";
    const f = new URLSearchParams(window.location.search).get("filter");
    return f === "udhar" || f === "bad" || f === "due" || f === "promise" || f === "cleared" ? f : "all";
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerWithLedger | null>(null);
  const [customerForm, setCustomerForm] = useState<CustomerFormState>(blankCustomerForm());
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>({ customerId: "", amount: "", mode: "cash", cashAmount: "", upiAmount: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomerWithLedger | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"ledger" | "transactions" | "payments" | "notes">("ledger");

  useEffect(() => {
    const refresh = () => void overviewQuery.refetch();
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [overviewQuery.refetch]);

  const dedupedCustomers = useMemo(() => {
    const map = new Map<string, CustomerWithLedger>();
    for (const customer of customers) {
      if (customer.deletedAt || (customer as { deleted_at?: unknown }).deleted_at) continue;
      const key = customerDedupeKey(customer);
      const existing = map.get(key);
      map.set(key, existing ? chooseBestCustomer(existing, customer) : customer);
    }
    return Array.from(map.values()).sort((a, b) => b.ledgerBalance - a.ledgerBalance || a.name.localeCompare(b.name));
  }, [customers]);

  const totals = useMemo(() => {
    const totalUdhar = dedupedCustomers.reduce((sum, customer) => sum + Math.max(0, customer.ledgerBalance), 0);
    return {
      customers: dedupedCustomers.length,
      active: dedupedCustomers.filter((customer) => customer.ledgerBalance > 0).length,
      totalUdhar,
      bad: dedupedCustomers.filter((customer) => customer.ledgerMetrics.isBadCustomer).length,
      dueSoon: dedupedCustomers.filter((customer) => Boolean(customer.dueDate || customer.promiseToPayDate)).length,
    };
  }, [dedupedCustomers]);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dedupedCustomers.filter((customer) => {
      const matchesSearch = !q
        || customer.name.toLowerCase().includes(q)
        || String(customer.mobile ?? "").includes(q)
        || String(customer.address ?? "").toLowerCase().includes(q);
      const matchesFilter =
        filter === "all" ? true :
        filter === "udhar" ? customer.ledgerBalance > 0 :
        filter === "bad" ? customer.ledgerMetrics.isBadCustomer :
        filter === "cleared" ? customer.ledgerBalance <= 0 :
        filter === "due" ? customer.ledgerMetrics.ageing.sevenToThirty > 0 || customer.ledgerMetrics.ageing.thirtyPlus > 0 :
        filter === "promise" ? Boolean(customer.promiseToPayDate) : true;
      return matchesSearch && matchesFilter;
    });
  }, [dedupedCustomers, filter, search]);

  useEffect(() => {
    if (selectedId && !filteredCustomers.some((customer) => customer.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filteredCustomers, selectedId]);

  const selectedCustomer = useMemo(
    () => selectedId ? filteredCustomers.find((customer) => customer.id === selectedId) ?? null : null,
    [filteredCustomers, selectedId],
  );

  const selectedDetail = useQuery({
    queryKey: ["customer-detail-inline", selectedCustomer?.id],
    queryFn: () => loadCustomerDetail(selectedCustomer?.id ?? ""),
    enabled: Boolean(selectedCustomer?.id),
    staleTime: 1_500,
  });

  const ageing = selectedCustomer?.ledgerMetrics.ageing;
  const ledgerRows = selectedDetail.data?.ledger ?? [];
  const paymentRows = selectedDetail.data?.payments ?? [];
  const billRows = selectedDetail.data?.bills ?? [];
  const selectedRisk = selectedCustomer ? riskInfo(selectedCustomer) : null;
  const selectedTrust = selectedCustomer ? trustBadge(selectedCustomer) : null;
  const creditLimit = money(selectedCustomer?.udharLimit);
  const availableCredit = Math.max(0, creditLimit - Math.max(0, money(selectedCustomer?.ledgerBalance)));
  const trustScore = selectedCustomer?.ledgerMetrics.trustScore ?? 0;
  const allLedger = useMemo(
    () => (overviewQuery.data?.ledger ?? []).filter(isLiveLedgerRow),
    [overviewQuery.data?.ledger],
  );
  const receivedInRange = useMemo(
    () => allLedger
      .filter((row) => inDateRange(ledgerEntryDate(row), rangeFrom, rangeTo))
      .reduce((sum, row) => sum + udharCollectionAmount(row), 0),
    [allLedger, rangeFrom, rangeTo],
  );
  const selectedReceivedInRange = useMemo(
    () => paymentRows
      .filter((payment) => inDateRange(paymentDate(payment), rangeFrom, rangeTo))
      .reduce((sum, payment) => sum + paymentAmount(payment), 0),
    [paymentRows, rangeFrom, rangeTo],
  );
  const overdueAmount = useMemo(
    () => dedupedCustomers.reduce((sum, customer) => sum + Math.max(0, customer.ledgerMetrics.ageing.thirtyPlus), 0),
    [dedupedCustomers],
  );
  // The insights range is the same one the top-right dropdown drives. Derive a live
  // label + a cycle so the "This Week" chip on Collection Progress is real, not static.
  const rangeDays = Math.max(0, Math.round((new Date(`${rangeTo}T00:00:00`).getTime() - new Date(`${rangeFrom}T00:00:00`).getTime()) / 86_400_000));
  const rangeLabel = rangeDays <= 0 ? t("customers.list.today") : rangeDays <= 6 ? t("customers.list.last7") : rangeDays <= 29 ? t("customers.list.last30") : `Last ${rangeDays + 1} days`;
  const cycleRange = () => applyRange(rangeDays <= 0 ? 6 : rangeDays <= 6 ? 29 : 0);
  const averageCollectionDays = useMemo(() => {
    const values = dedupedCustomers.flatMap((customer) => {
      const bill = customer.ledgerMetrics.lastBillAt ? new Date(customer.ledgerMetrics.lastBillAt).getTime() : NaN;
      const payment = customer.ledgerMetrics.lastPaymentAt ? new Date(customer.ledgerMetrics.lastPaymentAt).getTime() : NaN;
      return Number.isFinite(bill) && Number.isFinite(payment) && payment >= bill ? [(payment - bill) / 86_400_000] : [];
    });
    return values.length > 0 ? Math.max(0, Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)) : 0;
  }, [dedupedCustomers]);
  const metricSparks = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      return inputDate(date);
    });
    const ledgerByDay = new Map(days.map((day) => [day, 0]));
    const paymentsByDay = new Map(days.map((day) => [day, 0]));
    const customersByDay = new Map(days.map((day) => [day, 0]));
    for (const row of allLedger) {
      const date = ledgerEntryDate(row).slice(0, 10);
      if (ledgerByDay.has(date)) ledgerByDay.set(date, (ledgerByDay.get(date) ?? 0) + ledgerSignedAmount(row));
      if (paymentsByDay.has(date)) paymentsByDay.set(date, (paymentsByDay.get(date) ?? 0) + udharCollectionAmount(row));
    }
    for (const customer of dedupedCustomers) {
      const date = String(customer.createdAt ?? customer.created_at ?? "").slice(0, 10);
      if (customersByDay.has(date)) customersByDay.set(date, (customersByDay.get(date) ?? 0) + 1);
    }
    let outstanding = Math.max(0, totals.totalUdhar - days.reduce((sum, day) => sum + (ledgerByDay.get(day) ?? 0), 0));
    let customerCount = Math.max(0, totals.customers - days.reduce((sum, day) => sum + (customersByDay.get(day) ?? 0), 0));
    return {
      customers: days.map((day) => (customerCount += customersByDay.get(day) ?? 0)),
      outstanding: days.map((day) => Math.max(0, outstanding += ledgerByDay.get(day) ?? 0)),
      overdue: days.map(() => overdueAmount),
      received: days.map((day) => paymentsByDay.get(day) ?? 0),
      active: days.map(() => totals.active),
      collection: days.map(() => averageCollectionDays),
    };
  }, [allLedger, averageCollectionDays, dedupedCustomers, overdueAmount, totals.active, totals.customers, totals.totalUdhar]);
  const metricChanges = useMemo(() => {
    const from = new Date(`${rangeFrom}T00:00:00`);
    const to = new Date(`${rangeTo}T23:59:59.999`);
    const duration = Math.max(1, to.getTime() - from.getTime() + 1);
    const previousTo = new Date(from.getTime() - 1);
    const previousFrom = new Date(previousTo.getTime() - duration + 1);
    const previousFromKey = inputDate(previousFrom);
    const previousToKey = inputDate(previousTo);
    const previousPayments = allLedger.filter((row) => inDateRange(ledgerEntryDate(row), previousFromKey, previousToKey)).reduce((sum, row) => sum + udharCollectionAmount(row), 0);
    const currentLedgerMovement = allLedger.filter((row) => inDateRange(ledgerEntryDate(row), rangeFrom, rangeTo)).reduce((sum, row) => sum + ledgerSignedAmount(row), 0);
    const priorOutstanding = Math.max(0, totals.totalUdhar - currentLedgerMovement);
    const customersAtPreviousEnd = dedupedCustomers.filter((customer) => {
      const created = new Date(String(customer.createdAt ?? customer.created_at ?? 0)).getTime();
      return Number.isFinite(created) && created <= previousTo.getTime();
    }).length;
    return {
      customers: percentageChange(totals.customers, customersAtPreviousEnd),
      outstanding: percentageChange(totals.totalUdhar, priorOutstanding),
      overdue: 0,
      received: percentageChange(receivedInRange, previousPayments),
      active: 0,
      collection: 0,
    };
  }, [allLedger, dedupedCustomers, rangeFrom, rangeTo, receivedInRange, totals.customers, totals.totalUdhar]);

  useEffect(() => {
    if (!selectedCustomer) return;
    setPaymentForm((form) => form.customerId === selectedCustomer.id ? form : { ...form, customerId: selectedCustomer.id, amount: "", cashAmount: "", upiAmount: "" });
  }, [selectedCustomer]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ draft?: Partial<CustomerFormState> & { mode?: "create" | "edit" } }>).detail;
      const draft = detail?.draft;
      if (!draft) return;
      const lookupName = String(draft.name ?? "").trim().toLowerCase();
      const lookupMobile = String(draft.mobile ?? "").replace(/\D/g, "");
      const existing = draft.mode === "edit"
        ? dedupedCustomers.find((customer) => {
            const mobile = String(customer.mobile ?? "").replace(/\D/g, "");
            return (lookupMobile && mobile === lookupMobile) || (lookupName && customer.name.toLowerCase().includes(lookupName));
          })
        : undefined;

      setEditing(existing ?? null);
      setCustomerForm({
        name: draft.name ?? existing?.name ?? "",
        mobile: draft.mobile ?? existing?.mobile ?? "",
        address: draft.address ?? existing?.address ?? "",
        gstNumber: draft.gstNumber ?? existing?.gstNumber ?? "",
        stateCode: draft.stateCode ?? existing?.stateCode ?? "",
        type: draft.type === "udhar" || existing?.type === "udhar" ? "udhar" : "regular",
        dueDate: draft.dueDate ?? existing?.dueDate ?? "",
        promiseToPayDate: draft.promiseToPayDate ?? existing?.promiseToPayDate ?? "",
        udharLimit: draft.udharLimit !== undefined ? String(draft.udharLimit) : typeof existing?.udharLimit === "number" ? String(existing.udharLimit) : "",
        notes: draft.notes ?? existing?.notes ?? "",
      });
      setCustomerOpen(true);
      toast({ title: existing ? t("customers.toast.editPrepared") : t("customers.toast.draftPrepared"), description: t("customers.toast.voiceFilled") });
    };
    window.addEventListener("kirana:voice-customer-draft", handler);
    return () => window.removeEventListener("kirana:voice-customer-draft", handler);
  }, [dedupedCustomers, toast]);

  useEffect(() => {
    const handler = (event: Event) => {
      const query = String((event as CustomEvent<{ query?: unknown }>).detail?.query ?? "").trim();
      if (!query) return;
      setSearch(query);
    };
    window.addEventListener("kirana:voice-customer-search", handler);
    return () => window.removeEventListener("kirana:voice-customer-search", handler);
  }, []);

  // Voice "show udhar" → focus this page on outstanding customers (migrated from the retired /udhar page).
  useEffect(() => {
    const handler = (event: Event) => {
      const query = String((event as CustomEvent<{ query?: unknown }>).detail?.query ?? "").trim();
      setFilter("udhar");
      if (query) setSearch(query);
    };
    window.addEventListener("kirana:voice-udhar-search", handler);
    return () => window.removeEventListener("kirana:voice-udhar-search", handler);
  }, []);

  // Voice "record payment ..." → prefill + open the payment dialog (migrated from the retired /udhar page).
  useEffect(() => {
    const handler = (event: Event) => {
      const draft = (event as CustomEvent<{
        draft?: { customerName?: unknown; mobile?: unknown; amount?: unknown; mode?: unknown; note?: unknown };
      }>).detail?.draft;
      if (!draft) return;
      const name = String(draft.customerName ?? "").trim().toLowerCase();
      const mobile = String(draft.mobile ?? "").replace(/\D/g, "").slice(-10);
      const customer = dedupedCustomers.find((row) => {
        const rowMobile = String(row.mobile ?? "").replace(/\D/g, "").slice(-10);
        return Boolean(
          (mobile && rowMobile === mobile) ||
          (name && row.name.toLowerCase().includes(name)) ||
          (name && name.includes(row.name.toLowerCase())),
        );
      });
      if (name) setSearch(name);
      const draftMode = String(draft.mode ?? "cash").toLowerCase();
      setPaymentForm({
        customerId: customer?.id ?? "",
        amount: draft.amount !== undefined && Number.isFinite(Number(draft.amount)) ? String(draft.amount) : "",
        mode: draftMode === "upi" || draftMode === "bank" ? draftMode : "cash",
        cashAmount: "",
        upiAmount: "",
        note: typeof draft.note === "string" ? draft.note : "",
      });
      setPaymentOpen(true);
      if (!customer) {
        toast({ title: t("customers.action.chooseCustomer"), description: t("customers.toast.voicePayment") });
      }
    };
    window.addEventListener("kirana:voice-payment-draft", handler);
    return () => window.removeEventListener("kirana:voice-payment-draft", handler);
  }, [dedupedCustomers, toast]);

  function openCreate() {
    setEditing(null);
    setCustomerForm(blankCustomerForm());
    setCustomerOpen(true);
  }

  function openEdit(customer: CustomerWithLedger) {
    setEditing(customer);
    setCustomerForm({
      name: customer.name,
      mobile: customer.mobile ?? "",
      address: customer.address ?? "",
      gstNumber: customer.gstNumber ?? "",
      stateCode: customer.stateCode ?? "",
      type: customer.type === "udhar" ? "udhar" : "regular",
      dueDate: customer.dueDate ?? "",
      promiseToPayDate: customer.promiseToPayDate ?? "",
      udharLimit: typeof customer.udharLimit === "number" ? String(customer.udharLimit) : "",
      notes: customer.notes ?? "",
    });
    setCustomerOpen(true);
  }

  function openPayment(customer?: CustomerWithLedger) {
    setPaymentForm({ customerId: customer?.id ?? selectedCustomer?.id ?? "", amount: "", mode: "cash", cashAmount: "", upiAmount: "", note: "" });
    setPaymentOpen(true);
  }

  async function saveCustomer() {
    if (!customerForm.name.trim()) {
      toast({ title: t("customers.toast.nameRequired"), variant: "destructive" });
      return;
    }
    if (!customerForm.mobile.trim()) {
      toast({ title: t("customers.toast.mobileRequired"), description: t("customers.field.mobileHint"), variant: "destructive" });
      return;
    }
    const gstin = customerForm.gstNumber.trim() ? validateGstin(customerForm.gstNumber) : null;
    if (gstin && !gstin.valid) {
      toast({ title: t("customers.detail.checkGstin"), description: gstin.reason, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const data: CustomerInput = {
        name: customerForm.name.trim(),
        mobile: customerForm.mobile.trim(),
        address: customerForm.address.trim() || undefined,
        gstNumber: gstin?.normalized || undefined,
        stateCode: gstin?.stateCode || customerForm.stateCode || undefined,
        type: customerForm.type,
        dueDate: customerForm.dueDate || undefined,
        promiseToPayDate: customerForm.promiseToPayDate || undefined,
        udharLimit: customerForm.udharLimit ? Number(customerForm.udharLimit) : undefined,
        notes: customerForm.notes.trim() || undefined,
      };
      if (editing) await updateCustomerLocalFirst(editing.id, data);
      else await createCustomerLocalFirst(data);
      toast({ title: editing ? t("customers.toast.updated") : t("customers.toast.added"), description: t("customers.toast.dataSafeLocally") });
      setCustomerOpen(false);
      await refetch();
    } catch (error) {
      toast({ title: t("customers.toast.saveFailed"), description: error instanceof Error ? error.message : t("customers.toast.checkDetails"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function requestDeleteCustomer(customer: CustomerWithLedger) {
    setDeleteTarget(customer);
    setDeleteError(null);
  }

  async function confirmDeleteCustomer(ownerPin: string, reason: string) {
    if (!deleteTarget) return;
    setSaving(true);
    setDeleteError(null);
    try {
      await deleteCustomerLocalFirst({ id: deleteTarget.id, ownerPin, reason });
      toast({ title: t("customers.toast.recycled"), description: t("customers.toast.softDeleteNote") });
      setDeleteTarget(null);
      await refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("billing.page.tryAgain");
      setDeleteError(message);
      toast({ title: t("customers.toast.deleteFailed"), description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function mobileDigits() {
    return String(selectedCustomer?.mobile ?? "").replace(/\D/g, "").slice(-10);
  }

  function shareWhatsApp() {
    const digits = mobileDigits();
    if (!digits) { toast({ title: t("customers.detail.noMobile"), description: t("customers.toast.needMobileForWhatsapp"), variant: "destructive" }); return; }
    const balance = Math.max(0, money(selectedCustomer?.ledgerBalance));
    const text = encodeURIComponent(`Namaste ${selectedCustomer?.name} ji, aapka khata balance ${fmtMoney(balance)} hai. Kripya payment kar dein. Dhanyavaad!`);
    window.open(`https://wa.me/91${digits}?text=${text}`, "_blank", "noopener");
  }

  function sendSms() {
    const digits = mobileDigits();
    if (!digits) { toast({ title: t("customers.detail.noMobile"), variant: "destructive" }); return; }
    const balance = Math.max(0, money(selectedCustomer?.ledgerBalance));
    window.location.href = `sms:+91${digits}?body=${encodeURIComponent(`Namaste ${selectedCustomer?.name} ji, aapka khata balance ${fmtMoney(balance)} hai.`)}`;
  }

  function quickCall() {
    const digits = mobileDigits();
    if (!digits) { toast({ title: t("customers.detail.noMobile"), variant: "destructive" }); return; }
    window.location.href = `tel:+91${digits}`;
  }

  function printStatement() {
    if (!selectedCustomer) return;
    const popup = window.open("", "_blank", "width=540,height=740");
    if (!popup) { toast({ title: t("customers.toast.allowPopups"), description: t("customers.toast.enablePopups"), variant: "destructive" }); return; }
    const rows = (selectedDetail.data?.ledger ?? []).map((row) => {
      const signed = Number(row.signed_amount ?? 0);
      return `<tr><td>${escapeHtml(formatShortDate(row.display_date))}</td><td>${escapeHtml(row.note || row.source_id || row.display_type)}</td><td style="text-align:right">${escapeHtml(signed > 0 ? fmtMoney(signed) : "-")}</td><td style="text-align:right">${escapeHtml(signed < 0 ? fmtMoney(Math.abs(signed)) : "-")}</td><td style="text-align:right">${escapeHtml(fmtMoney(row.running_balance))}</td></tr>`;
    }).join("");
    const customerName = escapeHtml(selectedCustomer.name);
    popup.document.write(`<!doctype html><html><head><title>${escapeHtml(t("customers.print.title", { name: customerName }))}</title><style>body{font-family:Arial;font-size:12px;padding:18px;color:#111827}h1{font-size:17px;margin:0}p{margin:3px 0;color:#555}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #e2e8f0;padding:6px 4px;text-align:left;font-size:11px}th{background:#f5f8fc;text-transform:uppercase;font-size:10px}strong.due{color:#ef4444}</style></head><body><h1>${escapeHtml(t("customers.print.title", { name: customerName }))}</h1><p>${escapeHtml(selectedCustomer.mobile)}</p><p>${escapeHtml(t("customers.print.asOn", { date: formatShortDate(new Date().toISOString()) }))}<strong class="due">${escapeHtml(fmtMoney(Math.max(0, money(selectedCustomer.ledgerBalance))))}</strong></p><table><thead><tr><th>${escapeHtml(t("customers.ledger.date"))}</th><th>${escapeHtml(t("customers.ledger.particulars"))}</th><th style="text-align:right">${escapeHtml(t("customers.ledger.udharAmount"))}</th><th style="text-align:right">${escapeHtml(t("customers.ledger.paidAmount"))}</th><th style="text-align:right">${escapeHtml(t("customers.ledger.balanceAmount"))}</th></tr></thead><tbody>${rows || `<tr><td colspan="5">${escapeHtml(t("customers.ledger.empty"))}</td></tr>`}</tbody></table><script>setTimeout(function(){window.print()},300)</script></body></html>`);
    popup.document.close();
  }

  async function recordPayment() {
    const cashAmount = paymentForm.mode === "split" ? money(paymentForm.cashAmount) : 0;
    const upiAmount = paymentForm.mode === "split" ? money(paymentForm.upiAmount) : 0;
    const amount = paymentForm.mode === "split" ? addMoney(cashAmount, upiAmount) : money(paymentForm.amount);
    if (!paymentForm.customerId || !Number.isFinite(amount) || amount <= 0) {
      toast({ title: t("customers.detail.selectCustomerAndAmount"), variant: "destructive" });
      return;
    }
    if (paymentForm.mode === "split" && (!Number.isFinite(cashAmount) || !Number.isFinite(upiAmount) || cashAmount < 0 || upiAmount < 0 || (cashAmount <= 0 && upiAmount <= 0))) {
      toast({ title: t("customers.toast.invalidSplit"), variant: "destructive" });
      return;
    }
    const customer =
      dedupedCustomers.find((row) => row.id === paymentForm.customerId) ??
      selectedCustomer;
    const outstanding = Math.max(0, money(customer?.ledgerBalance));
    if (moneyExceeds(amount, outstanding)) {
      toast({
        title: t("customers.toast.amountExceeds"),
        description: `${customer?.name ?? t("customers.detail.thisCustomer")} owes ${fmtMoney(outstanding)}. Enter that amount or less.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      // Validate against the balance the operator can see (the authoritative
      // summary this page overlays), not the device ledger — it can be drifted.
      let nextOutstanding = outstanding;
      if (paymentForm.mode === "split") {
        const baseNote = paymentForm.note.trim();
        if (cashAmount > 0) {
          const result = await recordPaymentLocalFirst(paymentForm.customerId, { amount: cashAmount, mode: "cash", note: baseNote ? `${baseNote} (split cash)` : t("customers.detail.splitCash") }, { expectedOutstanding: outstanding });
          nextOutstanding = result.nextBalance;
        }
        if (upiAmount > 0) {
          const result = await recordPaymentLocalFirst(paymentForm.customerId, { amount: upiAmount, mode: "upi", note: baseNote ? `${baseNote} (split UPI)` : t("customers.detail.splitUpi") }, { expectedOutstanding: nextOutstanding });
          nextOutstanding = result.nextBalance;
        }
      } else {
        const result = await recordPaymentLocalFirst(paymentForm.customerId, { amount, mode: paymentForm.mode, note: paymentForm.note.trim() || undefined }, { expectedOutstanding: outstanding });
        nextOutstanding = result.nextBalance;
      }
      // Paint the durable local result immediately. Network refreshes below are
      // reconciliation work and must never gate what the cashier sees.
      queryClient.setQueryData<CustomerWithLedger[]>(["customers-ledger-list"], (current) =>
        projectCustomerOutstanding(current ?? [], paymentForm.customerId, nextOutstanding),
      );
      queryClient.setQueryData<CustomerDetailData | null>(["customer-detail", paymentForm.customerId], (current) => {
        if (!current) return current;
        const projected = projectCustomerOutstanding([current.customer], paymentForm.customerId, nextOutstanding)[0];
        return projected ? { ...current, customer: projected } : current;
      });
      toast({ title: t("customers.toast.paymentRecorded"), description: t("customers.ledger.updatedLocally") });
      setPaymentOpen(false);
      void refetch();
      void overviewQuery.refetch();
      void selectedDetail.refetch();
      // Replace the optimistic projection with a fresh server-ledger summary.
      // Do not await this network refresh: payment acknowledgement and the
      // correct local balance are already durable and visible.
      void queryClient.refetchQueries({ queryKey: ["customers-authoritative-summary-refresh"], type: "active" });
      setPaymentForm((form) => ({ ...form, amount: "", cashAmount: "", upiAmount: "", note: "" }));
    } catch (error) {
      toast({ title: t("customers.toast.paymentFailed"), description: error instanceof Error ? error.message : t("billing.page.tryAgain"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function applyRange(days: number) {
    setRangeFrom(daysBefore(days));
    setRangeTo(inputDate(new Date()));
  }

  function exportCustomers() {
    const rows = [
      [t("customers.field.customer"), t("customers.field.mobile"), t("customers.field.address"), "Outstanding", "Risk", t("customers.detail.lastPaymentLower")],
      ...filteredCustomers.map((customer) => [
        customer.name,
        customer.mobile ?? "",
        customer.address ?? "",
        String(Math.max(0, customer.ledgerBalance)),
        t(riskInfo(customer).labelKey),
        customer.ledgerMetrics.lastPaymentAt ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `customers-udhar-${rangeFrom}-to-${rangeTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const showLegacyCustomerPanel: boolean = false;

  return (
    <div className="app-docked-page space-y-4 bg-transparent lg:space-y-5">
      <section className="rounded-[18px] border border-[#e2e8f2] bg-white p-4 shadow-[0_10px_30px_rgba(15,35,80,0.05)] lg:flex lg:items-center lg:justify-between lg:gap-6 lg:p-5">
        <div className="min-w-0">
          <div className="hidden items-center gap-3 lg:flex"><span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[var(--brand-soft)] text-[var(--brand)]"><Users size={19} /></span><div><h2 className="text-[17px] font-black tracking-tight text-[var(--brand-ink)]">{t(tradeProfile.headingKey)}</h2><p className="mt-0.5 text-[11px] font-medium text-[#718099]">{t(tradeProfile.subtitleKey)}</p></div></div>
          <SyncBadge className="hidden lg:mt-3 lg:inline-flex" status={failedCount > 0 ? "failed" : pendingCount > 0 ? "pending" : "synced"} label={failedCount > 0 ? t("customers.detail.reviewSync") : pendingCount > 0 ? `${pendingCount} pending` : t("customers.detail.syncedJustNow")} />
        </div>
        <div className="grid grid-cols-2 items-center gap-2 lg:flex lg:flex-wrap">
          <div className="col-span-2 lg:contents">
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" className="h-11 w-full justify-between rounded-[12px] border-[#dfe7f2] bg-white px-3.5 text-[11px] font-bold text-[#24385f] lg:w-auto lg:min-w-[215px]"><span className="inline-flex items-center gap-2"><CalendarDays size={16} className="text-[var(--brand)]" />{formatShortDate(rangeFrom)} - {formatShortDate(rangeTo)}</span><ChevronRight size={13} className="rotate-90" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56"><DropdownMenuItem onClick={() => applyRange(0)}>{t("customers.list.today")}</DropdownMenuItem><DropdownMenuItem onClick={() => applyRange(6)}>{t("customers.list.last7")}</DropdownMenuItem><DropdownMenuItem onClick={() => applyRange(29)}>{t("customers.list.last30")}</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" className="hidden h-11 gap-2 rounded-[10px] border-[#dfe7f2] px-3.5 text-[11px] font-bold lg:inline-flex"><Filter size={16} />{t("customers.filters")}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44"><DropdownMenuItem onClick={() => setFilter("all")}>{t("customers.filter.all")}</DropdownMenuItem><DropdownMenuItem onClick={() => setFilter("udhar")}>{t("customers.filter.withBalance")}</DropdownMenuItem><DropdownMenuItem onClick={() => setFilter("due")}>{t("customers.list.overdue")}</DropdownMenuItem><DropdownMenuItem onClick={() => setFilter("cleared")}>{t("customers.list.cleared")}</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={exportCustomers} className="hidden h-11 gap-2 rounded-[10px] border-[#dfe7f2] px-3.5 text-[11px] font-bold lg:inline-flex"><Download size={16} />{t("customers.export")}</Button>
          <Button variant="outline" onClick={() => openPayment()} className="h-12 w-full gap-2 rounded-[14px] border-[var(--brand-border)] bg-[var(--brand-softer)] px-3 text-[11px] font-bold text-[var(--brand)] hover:bg-[var(--brand-soft)] lg:h-11 lg:w-auto lg:rounded-[10px]"><Wallet size={16} />{t("customers.collectPayment")}</Button>
          <Button onClick={openCreate} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-gradient-to-r from-[var(--brand)] to-[var(--brand-strong)] px-3 text-[11px] font-bold shadow-[0_8px_18px_var(--brand-shadow)] hover:from-[var(--brand-strong)] hover:to-[var(--brand-strong)] lg:h-11 lg:w-auto lg:rounded-[10px] lg:px-[18px]"><Plus size={16} className="shrink-0" /><span>{t("customers.list.addCustomer")}</span></Button>
        </div>
      </section>

      <TradeFocusStrip titleKey="customers.trade.title" focusKey={tradeProfile.focusKey} links={tradeProfile.links} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-label={t("customers.accountSummary")}>
        <CustomerMetricCard label={t("customers.stat.total")} value={String(totals.customers)} change={metricChanges.customers} color="var(--brand)" icon={<Users size={18} />} iconClass="bg-[var(--brand-soft)] text-[var(--brand)]" spark={metricSparks.customers} />
        <CustomerMetricCard label={t("customers.trade.outstanding", { credit: creditWord })} value={fmtMoney(totals.totalUdhar)} change={metricChanges.outstanding} color="#20b75a" icon={<Wallet size={18} />} iconClass="bg-[#eaf9ef] text-[#20a951]" spark={metricSparks.outstanding} />
        <CustomerMetricCard label={t("customers.stat.overdueAmount")} value={fmtMoney(overdueAmount)} change={metricChanges.overdue} color="#f59b0b" icon={<CalendarDays size={18} />} iconClass="bg-[#fff3e5] text-[#f08b00]" spark={metricSparks.overdue} />
        <CustomerMetricCard label={t("customers.stat.udharCollected")} value={fmtMoney(receivedInRange)} change={metricChanges.received} color="#7c4df1" icon={<CircleDollarSign size={18} />} iconClass="bg-[#f4efff] text-[#7c4df1]" spark={metricSparks.received} />
      </section>

      <section className="grid min-w-0 items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(580px,1fr)_380px]">
        <CustomerListPanelV3 customers={filteredCustomers} selectedId={selectedId} loading={isLoading} search={search} filter={filter} total={totals.customers} onSearch={setSearch} onFilter={setFilter} onSelect={setSelectedId} />
        <CustomerPaymentWorkspaceV3 customer={selectedCustomer} risk={selectedRisk} creditLimit={creditLimit} paymentRows={paymentRows} paymentForm={paymentForm} saving={saving} onEdit={openEdit} onPaymentChange={setPaymentForm} onCollect={() => void recordPayment()} onReminder={shareWhatsApp} />
        <CustomerInsightsPanelV3 customer={selectedCustomer} risk={selectedRisk} ageing={ageing} received={selectedReceivedInRange} pending={Math.max(0, selectedCustomer?.ledgerBalance ?? 0)} collectionChange={metricChanges.received} payments={paymentRows} onReminder={shareWhatsApp} rangeLabel={rangeLabel} onCycleRange={cycleRange} onViewAllPayments={() => document.getElementById("customer-ledger-register")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
      </section>

      <div id="customer-ledger-register" className="scroll-mt-4"><CustomerLedgerRegisterV3 customer={selectedCustomer} rows={ledgerRows} loading={selectedDetail.isLoading} onPrint={printStatement} /></div>

      {showLegacyCustomerPanel && selectedCustomer && selectedRisk && selectedTrust && <div className="hidden">
        <section className="min-h-0 overflow-hidden rounded-[16px] border border-[#e6ecf4] bg-white shadow-[0_12px_34px_rgba(15,35,80,0.055)]">
          <div className="border-b border-[#edf2f8] p-4">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7a9a]" />
              <Input
                className="h-11 rounded-[12px] border-[#e3eaf3] bg-[#f8fafd] pl-10 text-[13px] font-medium text-[var(--brand-ink)] placeholder:text-[#6b7a9a] focus-visible:border-[var(--brand)] focus-visible:bg-white focus-visible:ring-0"
                placeholder={t("customers.search")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {([
                ["all", `All ${totals.customers}`],
                ["udhar", `Active ${totals.active}`],
                ["bad", `High ${totals.bad}`],
                ["due", `Due ${totals.dueSoon}`],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "h-9 rounded-[10px] border px-2 text-[11px] font-black transition-colors",
                    filter === key
                      ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-[0_8px_18px_var(--brand-shadow)]"
                      : "border-[#e6ecf4] bg-white text-[#334466] hover:bg-[var(--brand-softer)]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-[12px] font-bold text-[#64748b]">{t("customers.list.sort")} <span className="text-[var(--brand-ink)]">{t("customers.sort.highestBalance")}</span></p>
            <Button onClick={openCreate} variant="outline" className="h-8 rounded-[9px] px-3 text-[12px] font-bold">
              <Plus size={14} className="mr-1" /> Add
            </Button>
          </div>

          <div className="max-h-[calc(100vh-245px)] overflow-y-auto px-3 pb-3">
            {isLoading ? (
              <div className="py-10 text-center text-[13px] text-[#64748b]">{t("customers.list.loadingCustomers")}</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="rounded-[14px] border border-dashed border-[#d8e2f1] px-4 py-10 text-center">
                <Users size={26} className="mx-auto text-[#94a3b8]" />
                <p className="mt-2 text-[13px] font-bold text-[var(--brand-ink)]">{t("customers.list.none")}</p>
                <p className="mt-1 text-[12px] text-[#64748b]">{t("customers.list.emptyHint")}</p>
              </div>
            ) : (
              filteredCustomers.map((customer) => {
                const risk = riskInfo(customer);
                const active = selectedCustomer?.id === customer.id;
                return (
                  <button
                    key={customer.id}
                    onClick={() => setSelectedId(customer.id)}
                    className={cn(
                      "mb-2 flex w-full items-center gap-3 rounded-[14px] border p-3 text-left transition-all",
                      active
                        ? "border-[var(--brand)] bg-[var(--brand-soft)] shadow-[0_10px_22px_var(--brand-shadow-soft)]"
                        : "border-transparent bg-white hover:border-[var(--brand-border)] hover:bg-[#f8fbff]",
                    )}
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[13px] font-black text-[var(--brand)]">{initials(customer.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-black text-[var(--brand-ink)]">{customer.name}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-[#52627e]">{customer.mobile || t("customers.noMobile")}</span>
                      <span className="mt-1 block text-[11px] text-[#64748b]">{customer.ledgerMetrics.lastBillAt ? t("customers.detail.lastBill") + formatShortDate(customer.ledgerMetrics.lastBillAt) : t("customers.list.noRecentBillShort")}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn("block text-[13px] font-black", customer.ledgerBalance > 0 ? "text-rose-600" : "text-[var(--brand-ink)]")}>{fmtMoney(customer.ledgerBalance)}</span>
                      <span className={cn("mt-1 inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[10px] font-black ring-1 ring-inset", risk.cls)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", risk.dot)} />
                        {t(risk.labelKey)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          {!selectedCustomer || !selectedRisk || !selectedTrust ? (
            <div className="rounded-[16px] border border-dashed border-[#d8e2f1] bg-white px-5 py-16 text-center shadow-[0_12px_34px_rgba(15,35,80,0.055)]">
              <Users size={30} className="mx-auto text-[#94a3b8]" />
              <p className="mt-3 font-display text-[18px] font-black text-[var(--brand-ink)]">{t("customers.detail.select")}</p>
              <p className="mt-1 text-[13px] text-[#64748b]">{t("customers.list.selectPromptHint")}</p>
            </div>
          ) : (
            <>
              <div className="rounded-[16px] border border-[#e6ecf4] bg-white p-5 shadow-[0_12px_34px_rgba(15,35,80,0.055)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 gap-4">
                    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#e7efff] font-display text-[22px] font-black text-[var(--brand)]">{initials(selectedCustomer.name)}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate font-display text-[21px] font-black tracking-tight text-[var(--brand-ink)]">{selectedCustomer.name}</h2>
                        <button onClick={() => openEdit(selectedCustomer)} className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] font-bold text-[var(--brand)] hover:bg-[var(--brand-soft)]">
                          <Pencil size={13} /> Edit
                        </button>
                        <span className={cn("inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[11px] font-black", selectedTrust!.cls)}>
                          <Star size={12} /> {selectedTrust!.label}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-[#344668]">
                        <span><Phone size={13} className="mr-1 inline text-[#64748b]" />{selectedCustomer.mobile || t("customers.noMobile")}</span>
                        <span><MapPin size={13} className="mr-1 inline text-[#64748b]" />{selectedCustomer.address || t("customers.noAddress")}</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-right">
                    <InfoMini label={t("customers.profile.since")} value={formatShortDate(selectedCustomer.createdAt)} />
                    <InfoMini label={t("customers.profile.lastPurchase")} value={formatShortDate(selectedCustomer.ledgerMetrics.lastBillAt)} />
                  </div>
                </div>

                <div className="mt-5 grid gap-3 rounded-[14px] border border-[#e8eef7] bg-[#fbfdff] p-4 md:grid-cols-3">
                  <SummaryCell label={t("customers.trade.outstanding", { credit: creditWord })} value={fmtMoney(selectedCustomer.ledgerBalance)} valueClass={selectedCustomer.ledgerBalance > 0 ? "text-rose-600" : "text-emerald-600"} />
                  <SummaryCell label={t("customers.profile.creditLimit")} value={creditLimit > 0 ? fmtMoney(creditLimit) : t("products.import.notSet")} />
                  <SummaryCell
                    label={t("customers.profile.availableCredit")}
                    value={creditLimit > 0
                      ? (money(selectedCustomer.ledgerBalance) > creditLimit ? `Over by ${fmtMoney(money(selectedCustomer.ledgerBalance) - creditLimit)}` : fmtMoney(availableCredit))
                      : t("customers.noLimit")}
                    valueClass={creditLimit > 0 && money(selectedCustomer.ledgerBalance) > creditLimit ? "text-rose-600" : "text-emerald-600"}
                  />
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px]">
                  <div className="rounded-[14px] border border-[#e8eef7] bg-white p-4">
                    <p className="text-[12px] font-bold text-[#64748b]">{t("customers.profile.riskLevel")}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-[9px] px-2.5 py-1.5 text-[12px] font-black ring-1 ring-inset", selectedRisk!.cls)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", selectedRisk!.dot)} />
                        {t(selectedRisk!.labelKey)}
                      </span>
                      <span className="text-[12px] text-[#64748b]">{selectedCustomer.ledgerMetrics.warning ?? t("customers.risk.trackable")}</span>
                    </div>
                  </div>
                  <div className="rounded-[14px] border border-[#e8eef7] bg-white p-4 text-center">
                    <p className="text-[12px] font-bold text-[#64748b]">{t("customers.profile.paymentScore")}</p>
                    {(() => {
                      const scoreColor = trustScore >= 75 ? "#16a34a" : trustScore >= 45 ? "#f59e0b" : "#ef4444";
                      return (
                        <div
                          className="mx-auto mt-2 grid h-16 w-16 place-items-center rounded-full"
                          style={{ background: `conic-gradient(${scoreColor} 0 ${Math.min(100, Math.max(0, trustScore))}%, #eef2f8 ${Math.min(100, Math.max(0, trustScore))}% 100%)` }}
                        >
                          <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-white font-display text-[12px] font-black" style={{ color: scoreColor }}>
                            {trustScore}<span className="text-[8px] text-[#94a3b8]">/100</span>
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <div className="rounded-[16px] border border-[#e6ecf4] bg-white shadow-[0_12px_34px_rgba(15,35,80,0.055)]">
                <div className="flex items-center gap-6 overflow-x-auto border-b border-[#edf2f8] px-5">
                  {([["ledger", t("customers.tab.ledger")], ["transactions", t("customers.tab.transactions")], ["payments", "Payment History"], ["notes", `Notes${selectedCustomer.notes ? " (1)" : ""}`]] as const).map(([key, label]) => (
                    <button key={key} onClick={() => setActiveTab(key)} className={cn("h-12 whitespace-nowrap border-b-2 text-[13px] font-black transition-colors", activeTab === key ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[#536383] hover:text-[var(--brand-ink)]")}>{label}</button>
                  ))}
                </div>
                {activeTab === "ledger" && (
                  <>
                    <div className="overflow-x-auto p-3">
                      <table className="w-full min-w-[650px] text-[12.5px]">
                        <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                          <tr>
                            <th className="px-3 py-2.5 text-left font-bold">{t("customers.ledger.date")}</th>
                            <th className="px-3 py-2.5 text-left font-bold">{t("customers.ledger.particulars")}</th>
                            <th className="px-3 py-2.5 text-left font-bold">{t("customers.ledger.type")}</th>
                            <th className="px-3 py-2.5 text-right font-bold">{t("customers.ledger.debit")}</th>
                            <th className="px-3 py-2.5 text-right font-bold">{t("customers.ledger.credit")}</th>
                            <th className="px-3 py-2.5 text-right font-bold">{t("customers.ledger.balance")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedDetail.isLoading ? (
                            <tr><td colSpan={6} className="px-3 py-10 text-center text-[#64748b]">{t("customers.ledger.loading")}</td></tr>
                          ) : ledgerRows.length === 0 ? (
                            <tr><td colSpan={6} className="px-3 py-10 text-center text-[#64748b]">{t("customers.ledger.emptyYet")}</td></tr>
                          ) : (
                            ledgerRows.slice(0, 7).map((row) => {
                              const signed = Number(row.signed_amount ?? 0);
                              return (
                                <tr key={row.id} className="border-b border-[#eef2f8] last:border-0">
                                  <td className="px-3 py-3 text-[#52627e]">{formatShortDate(row.display_date)}</td>
                                  <td className="max-w-[220px] truncate px-3 py-3 font-semibold text-[var(--brand-ink)]">{row.note || row.source_id || row.display_type}</td>
                                  <td className="px-3 py-3"><span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", row.display_type === "PAYMENT" ? CHIP_TONES.green : CHIP_TONES.blue)}>{row.display_type}</span></td>
                                  <td className="px-3 py-3 text-right font-bold text-[var(--brand-ink)]">{signed > 0 ? fmtMoney(signed) : "-"}</td>
                                  <td className="px-3 py-3 text-right font-bold text-emerald-600">{signed < 0 ? fmtMoney(Math.abs(signed)) : "-"}</td>
                                  <td className="px-3 py-3 text-right font-black text-[var(--brand-ink)]">{fmtMoney(row.running_balance)}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="border-t border-[#edf2f8] px-5 py-3 text-center">
                      <Link href={`/customers/${selectedCustomer.id}`} className="inline-flex items-center gap-2 text-[13px] font-black text-[var(--brand)] hover:underline">
                        View Full Ledger <ChevronRight size={14} />
                      </Link>
                    </div>
                  </>
                )}
                {activeTab === "transactions" && (
                  <div className="p-4">
                    {billRows.length === 0 ? (
                      <p className="py-8 text-center text-[12.5px] text-[#64748b]">{t("customers.bills.empty")}</p>
                    ) : (
                      billRows.slice(0, 8).map((bill, index) => (
                        <div key={String(bill.id ?? index)} className={cn("flex items-center gap-3 py-2.5", index < Math.min(billRows.length, 8) - 1 && "border-b border-[#eef2f8]")}>
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[var(--brand-soft)] text-[var(--brand)]"><FileText size={15} /></span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12.5px] font-black text-[var(--brand-ink)]">{String(bill.billNumber ?? bill.billNo ?? t("customers.ledger.billFallback"))}</p>
                            <p className="text-[11px] text-[#94a3b8]">{formatShortDate(getDate(bill, ["businessDate", "business_date", "createdAt", "created_at"]))}</p>
                          </div>
                          <span className="text-[13px] font-black text-[var(--brand-ink)]">{fmtMoney(getAmount(bill, ["grandTotal", "grand_total", "totalAmount", "total_amount"]))}</span>
                          <span className={cn("rounded-[7px] px-2 py-[3px] text-[10.5px] font-black", money(bill.creditAmount) > 0 ? CHIP_TONES.red : CHIP_TONES.green)}>{money(bill.creditAmount) > 0 ? "Due" : "Paid"}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {activeTab === "payments" && (
                  <div className="p-4">
                    {paymentRows.length === 0 ? (
                      <p className="py-8 text-center text-[12.5px] text-[#64748b]">{t("customers.detail.noPayments")}</p>
                    ) : (
                      paymentRows.slice(0, 8).map((payment, index) => (
                        <div key={String(payment.id ?? index)} className={cn("flex items-center gap-3 py-2.5", index < Math.min(paymentRows.length, 8) - 1 && "border-b border-[#eef2f8]")}>
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-emerald-50 text-emerald-600"><Wallet size={15} /></span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-black text-[var(--brand-ink)]">{fmtMoney(getAmount(payment, ["amount", "paidAmount", "paid_amount"]))}</p>
                            <p className="text-[11px] text-[#94a3b8]">{formatShortDate(getDate(payment, ["paidAt", "paid_at", "createdAt", "created_at"]))}</p>
                          </div>
                          <span className={cn("rounded-[7px] px-2 py-[3px] text-[10.5px] font-black", String(payment.mode ?? "").toLowerCase() === "upi" ? CHIP_TONES.violet : CHIP_TONES.green)}>{String(payment.mode ?? "cash").toUpperCase()}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {activeTab === "notes" && (
                  <div className="p-4">
                    <div className="rounded-[12px] border border-[#e8eef7] bg-[#fbfdff] p-4 text-[12.5px] leading-6 text-[#344668]">
                      {selectedCustomer.notes || t("customers.notes.empty")}
                      <p className="mt-3 text-[11px] font-semibold text-[#94a3b8]">{t("customers.profile.updatedOn", { date: formatShortDate(selectedCustomer.updatedAt ?? selectedCustomer.createdAt) })}</p>
                    </div>
                    <Button variant="outline" className="mt-3 h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={() => openEdit(selectedCustomer)}><Pencil size={13} /> {selectedCustomer.notes ? t("customers.action.editNote") : t("customers.action.addNote")}</Button>
                  </div>
                )}
              </div>

              <button
                onClick={() => openPayment(selectedCustomer)}
                className="flex w-full items-center justify-between rounded-[14px] bg-gradient-to-b from-[var(--brand)] to-[var(--brand-strong)] p-4 text-left text-white shadow-[0_14px_28px_var(--brand-shadow)] transition-transform hover:-translate-y-0.5"
              >
                <span className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-white/15"><Wallet size={18} /></span>
                  <span>
                    <span className="block text-[14px] font-black">{t("customers.action.recordPayment")}</span>
                    <span className="block text-[12px] text-white/75">{t("customers.profile.receivePaymentFrom", { name: selectedCustomer.name })}</span>
                  </span>
                </span>
                <ChevronRight size={20} />
              </button>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <ActionTile icon={<FileText size={18} />} title={t("customers.action.statement")} sub={t("customers.action.downloadPrint")} onClick={printStatement} />
                <ActionTile icon={<MessageCircle size={18} className="text-emerald-600" />} title={t("customers.action.whatsapp")} sub={t("customers.action.shareStatement")} onClick={shareWhatsApp} />
                <ActionTile icon={<MessageSquare size={18} />} title={t("customers.action.sms")} sub={t("customers.payment.sendReminder")} onClick={sendSms} />
                <ActionTile icon={<Phone size={18} />} title={t("customers.action.call")} sub={t("customers.action.quickCall")} onClick={quickCall} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="rounded-[14px] border border-[#e6ecf4] bg-white p-4 text-center shadow-[0_10px_24px_rgba(15,35,80,0.045)] transition-all hover:-translate-y-0.5 hover:border-[var(--brand-border)] hover:bg-[#f8fbff]">
                      <span className="mx-auto grid h-10 w-10 place-items-center rounded-[12px] bg-[var(--brand-soft)] text-[var(--brand)]"><MoreHorizontal size={18} /></span>
                      <span className="mt-2 block text-[12px] font-black text-[var(--brand-ink)]">{t("customers.action.more")}</span>
                      <span className="mt-0.5 block text-[10.5px] font-medium text-[#64748b]">{t("customers.action.moreOptions")}</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem asChild><Link href={`/customers/${selectedCustomer.id}`}><span className="flex items-center"><UserRound size={14} className="mr-2" /> {t("customers.detail.openProfile")}</span></Link></DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openEdit(selectedCustomer)}><Pencil size={14} className="mr-2" /> {t("customers.detail.editCustomer")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { void navigator.clipboard?.writeText(selectedCustomer.mobile ?? ""); toast({ title: t("customers.toast.mobileCopied") }); }}><Phone size={14} className="mr-2" /> {t("customers.detail.copyMobile")}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={() => requestDeleteCustomer(selectedCustomer)}><Trash2 size={14} className="mr-2" /> {t("customers.detail.deleteCustomer")}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>
          )}
        </section>

        <aside className="space-y-4">
          <RightCard title={t("customers.ageing.altTitle")}>
            {(() => {
              // Real conic stops from the ledger ageing buckets — not decorative.
              const buckets = [
                { value: Math.max(0, money(ageing?.zeroToSeven)), color: "#22c55e" },
                { value: Math.max(0, money(ageing?.sevenToThirty)), color: "#f59e0b" },
                { value: Math.max(0, money(ageing?.thirtyPlus)), color: "#ef4444" },
              ];
              const total = buckets.reduce((sum, b) => sum + b.value, 0);
              let acc = 0;
              const stops = buckets.filter((b) => b.value > 0).map((b) => {
                const from = (acc / total) * 100;
                acc += b.value;
                const to = (acc / total) * 100;
                return `${b.color} ${from}% ${to}%`;
              }).join(", ");
              return (
                <div className="flex items-center gap-4">
                  <div
                    className="grid h-28 w-28 shrink-0 place-items-center rounded-full"
                    style={{ background: total > 0 ? `conic-gradient(${stops})` : "conic-gradient(#e6ecf4 0 100%)" }}
                  >
                    <div className="grid h-[76px] w-[76px] place-items-center rounded-full bg-white text-center shadow-inner">
                      <div>
                        <p className="font-display text-[16px] font-black text-[var(--brand-ink)]">{fmtMoney(total)}</p>
                        <p className="text-[10px] font-semibold text-[#64748b]">{t("customers.detail.totalDue")}</p>
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2 text-[12px]">
                    <Legend color="bg-emerald-500" label={t("customers.ageing.bucket0to7")} value={fmtMoney(ageing?.zeroToSeven ?? 0)} />
                    <Legend color="bg-amber-500" label={t("customers.ageing.bucket7to30")} value={fmtMoney(ageing?.sevenToThirty ?? 0)} />
                    <Legend color="bg-rose-500" label={t("customers.ageing.bucket30plus")} value={fmtMoney(ageing?.thirtyPlus ?? 0)} />
                  </div>
                </div>
              );
            })()}
          </RightCard>

          <RightCard title={t("customers.paymentHistory")} action="View all" onAction={() => setActiveTab("payments")}>
            {paymentRows.length === 0 ? (
              <p className="py-5 text-center text-[12px] text-[#64748b]">{t("customers.detail.noPayments")}</p>
            ) : (
              <div className="space-y-3">
                {paymentRows.slice(0, 5).map((payment, index) => {
                  const amount = getAmount(payment, ["amount", "paidAmount", "paid_amount"]);
                  const date = getDate(payment, ["paidAt", "paid_at", "createdAt", "created_at"]);
                  return (
                    <div key={String(payment.id ?? index)} className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="text-[#52627e]">{formatShortDate(date)}</span>
                      <span className="font-black text-[var(--brand-ink)]">{fmtMoney(amount)}</span>
                      <span className={cn("rounded-[7px] px-2 py-[3px] text-[10px] font-black", String(payment.mode ?? "").toLowerCase() === "upi" ? CHIP_TONES.violet : CHIP_TONES.green)}>{String(payment.mode ?? "cash").toUpperCase()}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </RightCard>

          <RightCard title={t("customers.transactions.recent")} action="View all" onAction={() => setActiveTab("transactions")}>
            {billRows.length === 0 ? (
              <p className="py-5 text-center text-[12px] text-[#64748b]">{t("customers.detail.noRecentBills")}</p>
            ) : (
              <div className="space-y-3">
                {billRows.slice(0, 5).map((bill, index) => (
                  <div key={String(bill.id ?? index)} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="text-[#52627e]">{formatShortDate(bill.businessDate ?? bill.business_date ?? bill.createdAt ?? bill.created_at)}</span>
                    <span className="font-semibold text-[var(--brand-ink)]">{String(bill.billNumber ?? bill.billNo ?? t("customers.ledger.billFallback"))}</span>
                    <span className={cn("rounded-[7px] px-2 py-[3px] text-[10px] font-black", money(bill.creditAmount) > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
                      {money(bill.creditAmount) > 0 ? "Due" : "Paid"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </RightCard>

          <RightCard title={t("customers.field.notes")} action="View all" onAction={() => setActiveTab("notes")}>
            <div className="rounded-[12px] border border-[#e8eef7] bg-[#fbfdff] p-3 text-[12px] leading-5 text-[#344668]">
              {selectedCustomer?.notes || t("customers.notes.emptyEdit")}
              <p className="mt-3 text-[11px] font-semibold text-[#94a3b8]">{t("customers.profile.updatedOn", { date: formatShortDate(selectedCustomer?.updatedAt ?? selectedCustomer?.createdAt) })}</p>
            </div>
          </RightCard>
        </aside>
      </div>}

      <Dialog open={customerOpen} onOpenChange={setCustomerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("customers.detail.editCustomer") : t("customers.list.addCustomer")}</DialogTitle>
            <DialogDescription>{t("customers.form.help")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div><Label>{t("customers.form.name")}</Label><Input className="mt-1" value={customerForm.name} onChange={(event) => setCustomerForm((form) => ({ ...form, name: event.target.value }))} /></div>
            <div><Label>{t("customers.form.phone")}</Label><Input className="mt-1" value={customerForm.mobile} onChange={(event) => setCustomerForm((form) => ({ ...form, mobile: event.target.value }))} /></div>
            <div className="md:col-span-2"><Label>{t("customers.form.billingAddress")}</Label><Input className="mt-1" value={customerForm.address} onChange={(event) => setCustomerForm((form) => ({ ...form, address: event.target.value }))} placeholder={t("customers.field.gstinHint")} /></div>
            <div className="md:col-span-2 rounded-xl border border-[#dce7f6] bg-[#f8fbff] p-3">
              <div className="mb-3"><p className="text-[12px] font-bold text-[#19345f]">{t("customers.form.gstDetails")}</p><p className="mt-0.5 text-[11px] text-[#64748b]">{t("customers.form.gstHelp")}</p></div>
              <div className="grid gap-3 md:grid-cols-[1fr_120px]">
                <div><Label>{t("customers.form.gstin")}</Label><Input className="mt-1 uppercase" maxLength={15} autoCapitalize="characters" value={customerForm.gstNumber} onChange={(event) => { const gstNumber = event.target.value.toUpperCase().replace(/\s/g, ""); setCustomerForm((form) => ({ ...form, gstNumber, stateCode: /^\d{2}/.test(gstNumber) ? gstNumber.slice(0, 2) : form.stateCode })); }} placeholder="22AAAAA0000A1Z5" /></div>
                <div><Label>{t("customers.form.stateCode")}</Label><Input className="mt-1 bg-white" value={customerForm.stateCode} readOnly placeholder="--" aria-label={t("customers.gstStateCode")} /></div>
              </div>
            </div>
            <div><Label>{t("customers.form.customerType")}</Label><Select value={customerForm.type} onValueChange={(value) => setCustomerForm((form) => ({ ...form, type: value as "regular" | "udhar" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="regular">{t("customers.form.regular")}</SelectItem><SelectItem value="udhar">{t("customers.form.udharAllowed")}</SelectItem></SelectContent></Select></div>
            <div><Label>{t("customers.form.udharLimit")}</Label><Input type="number" className="mt-1" value={customerForm.udharLimit} onChange={(event) => setCustomerForm((form) => ({ ...form, udharLimit: event.target.value }))} /></div>
            <div><Label>{t("customers.form.dueDate")}</Label><Input type="date" className="mt-1" value={customerForm.dueDate} onChange={(event) => setCustomerForm((form) => ({ ...form, dueDate: event.target.value }))} /></div>
            <div><Label>{t("customers.form.promiseDate")}</Label><Input type="date" className="mt-1" value={customerForm.promiseToPayDate} onChange={(event) => setCustomerForm((form) => ({ ...form, promiseToPayDate: event.target.value }))} /></div>
            <div className="md:col-span-2"><Label>{t("customers.form.notes")}</Label><Textarea className="mt-1" value={customerForm.notes} onChange={(event) => setCustomerForm((form) => ({ ...form, notes: event.target.value }))} placeholder={t("customers.field.pricingExample")} /></div>
          </div>
          <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setCustomerOpen(false)}>{t("customers.form.cancel")}</Button><Button onClick={() => void saveCustomer()} disabled={saving}>{saving ? t("customers.detail.saving") : t("customers.detail.saveLocally")}</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("customers.payment.title")}</DialogTitle>
            <DialogDescription>{t("customers.payment.help")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>{t("customers.payment.customer")}</Label><Select value={paymentForm.customerId} onValueChange={(value) => setPaymentForm((form) => ({ ...form, customerId: value }))}><SelectTrigger className="mt-1"><SelectValue placeholder={t("customers.action.selectCustomer")} /></SelectTrigger><SelectContent>{dedupedCustomers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.name} - {fmtMoney(customer.ledgerBalance)}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>{t("customers.payment.amount")}</Label><Input type="number" inputMode="decimal" min="0" step="0.01" className="mt-1" value={paymentForm.amount} onChange={(event) => setPaymentForm((form) => ({ ...form, amount: event.target.value }))} /></div>
            <div><Label>{t("customers.payment.mode")}</Label><Select value={paymentForm.mode} onValueChange={(value) => setPaymentForm((form) => ({ ...form, mode: value as PaymentFormState["mode"] }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">{t("customers.pay.cash")}</SelectItem><SelectItem value="upi">{t("customers.pay.upi")}</SelectItem><SelectItem value="bank">{t("customers.pay.bank")}</SelectItem><SelectItem value="split">{t("customers.payment.splitPayment")}</SelectItem></SelectContent></Select></div>
            {paymentForm.mode === "split" && <div className="grid grid-cols-2 gap-3"><div><Label>{t("customers.payment.cashAmount")}</Label><Input type="number" inputMode="decimal" min="0" step="0.01" className="mt-1" value={paymentForm.cashAmount} onChange={(event) => setPaymentForm((form) => ({ ...form, cashAmount: event.target.value }))} /></div><div><Label>{t("customers.payment.upiAmount")}</Label><Input type="number" inputMode="decimal" min="0" step="0.01" className="mt-1" value={paymentForm.upiAmount} onChange={(event) => setPaymentForm((form) => ({ ...form, upiAmount: event.target.value }))} /></div></div>}
            <div><Label>{t("customers.payment.note")}</Label><Input className="mt-1" value={paymentForm.note} onChange={(event) => setPaymentForm((form) => ({ ...form, note: event.target.value }))} placeholder={t("restaurant.addons.optional")} /></div>
          </div>
          <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setPaymentOpen(false)}>{t("customers.form.cancel")}</Button><Button onClick={() => void recordPayment()} disabled={saving}>{saving ? t("customers.detail.saving") : t("customers.detail.recordOffline")}</Button></div>
        </DialogContent>
      </Dialog>

      <OwnerPinModal
        open={Boolean(deleteTarget)}
        title={t("products.bulk.ownerPinRequired")}
        description={`Delete ${deleteTarget?.name ?? t("customers.thisCustomer")}? This only moves the customer to recycle bin. Bills, ledger, and payments stay safe.`}
        confirmLabel={t("customers.action.moveToRecycleBin")}
        reasonRequired
        loading={saving}
        error={deleteError}
        onCancel={() => { if (!saving) setDeleteTarget(null); }}
        onConfirm={({ ownerPin, reason }) => void confirmDeleteCustomer(ownerPin, reason)}
      />
    </div>
  );
}

function CustomerMetricCard({ label, value, change, color, icon, iconClass, spark, mobileHidden = false }: { label: string; value: string; change: number; color: string; icon: React.ReactNode; iconClass: string; spark: number[]; mobileHidden?: boolean }) {
  const { t } = useAppLanguage();
  const data = spark.map((item, index) => ({ index, value: item }));
  const gradientId = `customer-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <article className={cn("h-[126px] flex-col overflow-hidden rounded-[18px] border border-[#e2e8f2] bg-white p-3.5 shadow-[0_10px_30px_rgba(15,35,80,0.05)] lg:h-[154px] lg:p-4", mobileHidden ? "hidden md:flex" : "flex")}>
      <div className="flex shrink-0 items-center gap-3">
        <span className={cn("grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[12px]", iconClass)}>{icon}</span>
        <p className="min-w-0 text-[12px] font-bold leading-snug text-[#34486e]">{label}</p>
      </div>
      <p className="mt-2.5 shrink-0 truncate text-[21px] font-black leading-[1.18] text-[var(--brand-ink)]">{value}</p>
      <div className="mt-1.5 flex shrink-0 items-center gap-1 text-[10px]">
        <span className={cn("inline-flex items-center gap-0.5 font-bold", change === 0 ? "text-[#71809a]" : change < 0 ? "text-rose-600" : "text-emerald-600")}>
          {change === 0 ? null : change < 0 ? <ArrowDownRight size={11} /> : <ArrowUpRight size={11} />}
          {Math.abs(change)}%
        </span>
        <span className="whitespace-nowrap text-[#7a879f]">{t("customers.list.vsLastWeek")}</span>
      </div>
      <div className="mt-auto hidden h-7 w-full shrink-0 lg:block">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 3, right: 2, left: 2, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.26} />
                <stop offset="65%" stopColor={color} stopOpacity={0.08} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.9} fill={`url(#${gradientId})`} dot={{ r: 1.7, fill: "white", stroke: color, strokeWidth: 1.2 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

function CustomerListPanelV3({ customers, selectedId, loading, search, filter, total, onSearch, onFilter, onSelect }: { customers: CustomerWithLedger[]; selectedId: string | null; loading: boolean; search: string; filter: "all" | "udhar" | "bad" | "due" | "promise" | "cleared"; total: number; onSearch: (value: string) => void; onFilter: (value: "all" | "udhar" | "bad" | "due" | "promise" | "cleared") => void; onSelect: (value: string) => void }) {
  const { t } = useAppLanguage();
  const avatarTones = ["bg-[var(--brand-soft)] text-[var(--brand)]", "bg-[#ecfdf5] text-[#16a34a]", "bg-[#f5f3ff] text-[#7c3aed]", "bg-[#fff7ed] text-[#f97316]", "bg-[#fef2f2] text-[#ef4444]"];
  return (
    <section className="min-h-0 overflow-hidden rounded-[18px] border border-[#e2e8f2] bg-white shadow-[0_10px_30px_rgba(15,35,80,0.05)]">
      <header className="flex h-[58px] items-center justify-between px-[18px]"><h2 className="text-[15px] font-extrabold text-[var(--brand-ink)]">{t("customers.list.title")}</h2><span className="rounded-full bg-[#f2f5f9] px-2.5 py-1 text-[9px] font-black text-[#60708e]">{t("customers.list.shownCount", { count: customers.length })}</span></header>
      <div className="border-y border-[#e8edf4] p-3.5">
        <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7b89a2]" /><Input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={t("customers.searchShort")} className="h-10 rounded-[10px] border-[#dfe7f2] pl-10 text-[12px]" /></div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">{([["all", t("customers.filter.allCustomers")], ["udhar", t("customers.filter.withBalanceTitle")], ["due", t("customers.list.overdue")], ["cleared", t("customers.list.cleared")]] as const).map(([key, label]) => <button key={key} onClick={() => onFilter(key)} className={cn("h-11 rounded-[8px] border px-1 text-[8.5px] font-bold transition-colors", filter === key ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]" : "border-[#e3e9f2] bg-white text-[#405273] hover:bg-[#f8faff]")}>{label}</button>)}</div>
      </div>
      <div className="app-scrollbar max-h-[610px] overflow-y-auto p-3">
        {loading ? <p className="py-10 text-center text-[12px] text-[#7b89a2]">{t("customers.list.loadingCustomers")}</p> : customers.length === 0 ? <p className="py-10 text-center text-[12px] text-[#7b89a2]">{t("customers.list.none")}</p> : customers.map((customer, index) => {
          const risk = riskInfo(customer);
          const active = selectedId === customer.id;
          const ageing = customer.ledgerMetrics.ageing;
          const ageLabel = customer.ledgerBalance <= 0 ? "0 Days" : ageing.thirtyPlus > 0 ? "30+ Days" : ageing.sevenToThirty > 0 ? "8-30 Days" : "0-7 Days";
          const badgeLabel = risk.labelKey === "customers.risk.high"
            ? t("customers.risk.high.short")
            : risk.labelKey === "customers.risk.medium"
              ? t("customers.risk.medium.short")
              : risk.labelKey === "customers.risk.low"
                ? t("customers.risk.low.short")
                : t("customers.filter.cleared");
          const lastActivity = latestCustomerUdharActivity(customer);
          return (
            <button
              key={customer.id}
              onClick={() => onSelect(customer.id)}
              className={cn(
                "relative mb-2 grid min-h-[78px] w-full grid-cols-[40px_minmax(0,1fr)_92px] items-center gap-3 rounded-[12px] border px-3 py-2.5 text-left transition-all last:mb-0",
                active
                  ? "border-[var(--brand)] bg-[var(--brand-soft)] shadow-[0_8px_18px_rgba(11,99,246,0.10)]"
                  : "border-transparent hover:border-[#dce7f6] hover:bg-[#f8fbff]",
              )}
            >
              <span className="relative h-10 w-10 shrink-0">
                <span className={cn("grid h-10 w-10 place-items-center rounded-full text-[11px] font-black", avatarTones[index % avatarTones.length])}>{initials(customer.name)}</span>
                {active && <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full border-2 border-white bg-[var(--brand)] text-white"><CheckCircle2 size={11} /></span>}
              </span>
              <span className="min-w-0 pr-1">
                <span className="block truncate text-[12px] font-black leading-4 text-[var(--brand-ink)]">{customer.name}</span>
                <span className="mt-1 block truncate text-[10px] leading-3 text-[#60708e]">{customer.address || t("customers.noAddress")}</span>
                {/* Mobile and last activity shared one truncated line that needed
                    196px in a 137px column, so the date was always cut off mid-
                    word. The number is what gets dialled, so it keeps the line;
                    the activity sits under it in a form short enough to survive. */}
                <span className="mt-1 block truncate text-[9.5px] leading-3 text-[#7c899f]">{customer.mobile || t("customers.noMobile")}</span>
                <span className="mt-0.5 block truncate text-[9.5px] leading-3 text-[#7c899f]">{formatCustomerActivityDateTime(lastActivity)}</span>
              </span>
              <span className="flex min-w-[92px] flex-col items-end pr-1 text-right">
                <span className="block text-[12px] font-black leading-4 text-[var(--brand-ink)]">{fmtMoney(customer.ledgerBalance)}</span>
                <span className={cn("mt-1 block text-[9px] font-bold leading-3", customer.ledgerBalance <= 0 ? "text-emerald-600" : ageing.thirtyPlus > 0 ? "text-rose-600" : "text-amber-600")}>{ageLabel}</span>
                <span className={cn("mt-1 inline-flex rounded-[8px] px-2 py-1 text-[9px] font-bold leading-none", risk.cls)}>{badgeLabel}</span>
              </span>
            </button>
          );
        })}
      </div>
      <footer className="flex min-h-12 items-center justify-between gap-2 border-t border-[#e8edf4] px-3 text-[9px] text-[#60708e]">
        <span>{customers.length === 0 ? `Showing 0 of ${total} customers` : `Showing ${customers.length} of ${total} customers`}</span>
        <span>{customers.length === 0 ? t("customers.noCustomers") : `${customers.length} loaded`}</span>
      </footer>
    </section>
  );
}

// Named rather than inline: a one-line generic type annotation reads to the
// hardcoded-string scanner as JSX text — a `>` closing one generic and the `<`
// opening the next look exactly like `>label<` — so it reported the type itself
// as untranslated prose and pinned this file to the allowlist.
type CustomerPaymentWorkspaceV3Props = {
  customer: CustomerWithLedger | null;
  risk: ReturnType<typeof riskInfo> | null;
  creditLimit: number;
  paymentRows: Array<Record<string, unknown>>;
  paymentForm: PaymentFormState;
  saving: boolean;
  onEdit: (customer: CustomerWithLedger) => void;
  onPaymentChange: React.Dispatch<React.SetStateAction<PaymentFormState>>;
  onCollect: () => void;
  onReminder: () => void;
};

/**
 * Payment modes, as data rather than a tuple literal inside the JSX.
 *
 * Inline, the text between one icon's `/>` and the next element's `<` reads to
 * the hardcoded-string scanner as a user-visible label, so it reported the array
 * syntax itself as untranslated prose.
 */
function paymentModeChoices(t: Translate) {
  return [
    { mode: "cash" as const, label: t("customers.pay.cash"), icon: <Banknote key="cash" size={15} /> },
    { mode: "upi" as const, label: t("customers.pay.upi"), icon: <CreditCard key="upi" size={15} /> },
    { mode: "bank" as const, label: t("customers.pay.bank"), icon: <Landmark key="bank" size={15} /> },
    { mode: "split" as const, label: t("customers.pay.split"), icon: <ArrowLeftRight key="split" size={15} /> },
  ];
}

function CustomerPaymentWorkspaceV3({ customer, risk, creditLimit, paymentRows, paymentForm, saving, onEdit, onPaymentChange, onCollect, onReminder }: CustomerPaymentWorkspaceV3Props) {
  const { t } = useAppLanguage();
  if (!customer || !risk) {
    return (
      <div className="grid min-h-[430px] place-items-center rounded-[16px] border border-dashed border-[#d8e2f1] bg-white px-6 text-center shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="max-w-[260px]">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Users size={24} /></span>
          <p className="mt-3 text-[16px] font-extrabold text-[var(--brand-ink)]">{t("customers.detail.select")}</p>
          <p className="mt-1 text-[12px] leading-5 text-[#60708e]">{t("customers.detail.selectHelp")}</p>
        </div>
      </div>
    );
  }
  const outstanding = Math.max(0, money(customer.ledgerBalance));
  const paid = paymentRows.reduce((sum, row) => sum + paymentAmount(row), 0);
  const paymentTotal = paymentForm.mode === "split" ? addMoney(paymentForm.cashAmount, paymentForm.upiAmount) : money(paymentForm.amount);
  const overdueDays = customerOverdueDays(customer);
  // Split seeding puts the whole amount in cash and leaves UPI at zero. Never
  // guess a cash/UPI ratio: the tender split decides the cash drawer and the
  // UPI report, so an invented ratio silently falsifies both.
  const chooseAmount = (requested: number) => onPaymentChange((form) => {
    const value = Math.min(requested, outstanding);
    if (form.mode !== "split") return { ...form, amount: String(value) };
    return { ...form, amount: String(value), cashAmount: String(value), upiAmount: "0" };
  });
  const setTotal = (raw: string) => onPaymentChange((form) => {
    if (form.mode !== "split") return { ...form, amount: raw };
    const total = money(raw);
    return { ...form, amount: raw, cashAmount: total > 0 ? String(total) : "", upiAmount: total > 0 ? "0" : "" };
  });
  const invalidAmount = paymentTotal <= 0 || moneyExceeds(paymentTotal, outstanding);
  return (
    <section className="min-w-0 space-y-5">
      <article className="min-h-[128px] overflow-hidden rounded-[16px] border border-[#e6ecf5] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 p-[18px] sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3.5"><span className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-full bg-[#e7efff] text-[18px] font-black text-[var(--brand)]">{initials(customer.name)}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-[18px] font-black text-[var(--brand-ink)]">{customer.name}</h2><span className={cn("rounded-[8px] px-2 py-1 text-[10px] font-bold", risk.cls)}>{t(risk.labelKey)}</span><button onClick={() => onEdit(customer)} title={t("customers.detail.editCustomer")} className="grid h-7 w-7 place-items-center rounded-[8px] text-[var(--brand)] hover:bg-[var(--brand-soft)]"><Pencil size={13} /></button></div><div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[#405273]"><span className="inline-flex items-center gap-1.5"><Phone size={14} className="text-[#64748b]" />{customer.mobile || t("customers.noMobile")}</span><span className="inline-flex items-center gap-1.5"><MapPin size={14} className="text-[#64748b]" />{customer.address || t("customers.noAddress")}</span></div></div></div>
          <div className="flex items-center gap-3">
            <Link href={`/customers/${customer.id}`} title={t("customers.openLedger")} className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--brand)] px-3.5 py-2.5 text-[11px] font-bold text-white shadow-[0_8px_18px_var(--brand-shadow)] transition-colors hover:bg-[var(--brand-strong)]"><BookOpen size={15} />{t("customers.detail.viewLedger")}</Link>
            <InfoMini label={t("customers.profile.lastPayment")} value={formatShortDate(customer.ledgerMetrics.lastPaymentAt)} />
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-[#e8edf4] sm:grid-cols-5"><CompactSummaryV3 label={t("customers.profile.creditLimit")} value={creditLimit > 0 ? fmtMoney(creditLimit) : t("products.import.notSet")} /><CompactSummaryV3 label={t("customers.stat.totalPurchases")} value={fmtMoney(outstanding + paid)} /><CompactSummaryV3 label={t("customers.stat.totalPaid")} value={fmtMoney(paid)} /><CompactSummaryV3 label={t("customers.outstanding")} value={fmtMoney(outstanding)} danger /><CompactSummaryV3 label={t("customers.overdueDays")} value={`${overdueDays} Days`} danger={overdueDays > 0} /></div>
      </article>

      <article className="rounded-[16px] border border-[#e6ecf5] bg-white p-[18px] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        <h2 className="text-[15px] font-extrabold text-[var(--brand-ink)]">{t("customers.detail.recordUdharPayment")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-[120px_1fr]"><div><p className="text-[10px] font-bold uppercase text-[#75839d]">{t("customers.detail.amountDue")}</p><p className="mt-1.5 text-[19px] font-black text-rose-600">{fmtMoney(outstanding)}</p></div><div><Label className="text-[10px] font-bold text-[#52627e]">{t("customers.payment.amountLabel")} <span className="text-rose-500">*</span></Label><div className="relative mt-1.5"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-[#52627e]">₹</span><Input id="customer-payment-amount" type="number" inputMode="decimal" min="0" step="0.01" max={outstanding} value={paymentForm.amount} onChange={(event) => setTotal(event.target.value)} className="h-10 rounded-[10px] border-[#dfe7f2] pl-8 text-[13px] font-bold" placeholder="0.00" /></div></div></div>
        <div className="mt-3 grid grid-cols-[1.45fr_repeat(4,1fr)] gap-2"><button onClick={() => chooseAmount(outstanding)} className="min-h-9 rounded-[8px] border border-[var(--brand)] bg-[var(--brand-soft)] px-1 text-[9px] font-bold text-[var(--brand)]">{t("customers.collect.fullDue", { amount: fmtMoney(outstanding) })}</button>{[500,1000,2000].map((amount) => <button key={amount} onClick={() => chooseAmount(amount)} className="h-9 rounded-[8px] border border-[#dfe7f2] text-[10px] font-bold text-[#405273] hover:bg-[#f8faff]">{fmtMoney(amount)}</button>)}<button onClick={() => document.getElementById("customer-payment-amount")?.focus()} className="h-9 rounded-[8px] border border-[#dfe7f2] text-[10px] font-bold text-[#405273] hover:bg-[#f8faff]">{t("customers.payment.custom")}</button></div>
        <p className="mt-4 text-[10px] font-bold text-[#52627e]">{t("customers.payment.modeLabel")}</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{paymentModeChoices(t).map(({ mode, label, icon }) => <button key={mode} onClick={() => onPaymentChange((form) => { const total = money(form.amount); return { ...form, mode, ...(mode === "split" && total > 0 && !form.cashAmount && !form.upiAmount ? { cashAmount: String(total), upiAmount: "0" } : {}) }; })} className={cn("inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border text-[11px] font-bold transition-colors", paymentForm.mode === mode ? "border-[1.5px] border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]" : "border-[#dfe7f2] text-[#405273] hover:bg-[#f8faff]")}>{paymentForm.mode === mode && mode === "split" ? <CheckCircle2 size={15} /> : icon}{label}</button>)}</div>
        {paymentForm.mode === "split" && <div className="mt-3 rounded-[12px] border border-[#e5ebf3] bg-[#fbfcfe] p-3"><div className="grid grid-cols-2 gap-3"><div><Label className="text-[10px] font-bold text-[#52627e]">{t("customers.payment.cashAmountLabel")}</Label><div className="relative mt-1.5"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-[#52627e]">₹</span><Input type="number" inputMode="decimal" min="0" step="0.01" value={paymentForm.cashAmount} onChange={(event) => onPaymentChange((form) => ({ ...form, cashAmount: event.target.value, amount: String(addMoney(event.target.value, form.upiAmount)) }))} className="h-10 rounded-[9px] pl-7 text-[12px] font-bold" /></div></div><div><Label className="text-[10px] font-bold text-[#52627e]">{t("customers.payment.upiAmountLabel")}</Label><div className="relative mt-1.5"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-[#52627e]">₹</span><Input type="number" inputMode="decimal" min="0" step="0.01" value={paymentForm.upiAmount} onChange={(event) => onPaymentChange((form) => ({ ...form, upiAmount: event.target.value, amount: String(addMoney(form.cashAmount, event.target.value)) }))} className="h-10 rounded-[9px] px-7 text-[12px] font-bold" /><span className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-[6px] border border-[#e6ecf5] bg-[#f8faff] px-1.5 py-0.5 text-[9px] font-black text-[#405273]">{t("customers.pay.upi")}</span></div></div></div><p className="mt-2.5 text-center text-[11px] font-bold text-[#52627e]">{t("customers.payment.totalLabel")} <span className="text-[var(--brand-ink)]">{fmtMoney(paymentTotal)}</span></p></div>}
        {moneyExceeds(paymentTotal, outstanding) && <p className="mt-2 text-[10px] font-semibold text-rose-600">{t("customers.collect.exceedsBalance", { amount: fmtMoney(outstanding) })}</p>}
        <div className="mt-3"><Label className="text-[10px] font-bold text-[#52627e]">{t("customers.payment.noteLabel")} <span className="font-medium text-[#94a3b8]">{t("customers.payment.optional")}</span></Label><Input value={paymentForm.note} onChange={(event) => onPaymentChange((form) => ({ ...form, note: event.target.value }))} className="mt-1.5 h-[42px] rounded-[10px] text-[12px]" placeholder={t("customers.field.paymentNote")} /></div>
        <div className="mt-4 grid grid-cols-2 gap-3"><Button onClick={onCollect} disabled={saving || invalidAmount} className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-gradient-to-r from-[var(--brand)] to-[var(--brand-strong)] text-[12px] font-bold shadow-[0_8px_18px_var(--brand-shadow)]"><CheckCircle2 size={16} />{saving ? t("customers.detail.saving") : t("customers.collectPaymentTitle")}</Button><Button variant="outline" onClick={onReminder} className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border-[#d6e2f2] text-[12px] font-bold text-[var(--brand)]"><Bell size={16} />{t("customers.payment.sendReminder")}</Button></div>
        <p className="mt-3 flex items-center justify-center gap-2 rounded-[8px] bg-[#f7f9fc] px-3 py-2 text-center text-[10px] text-[#71809a]"><Info size={13} className="text-[var(--brand)]" />{t("customers.payment.afterHelp")}</p>
      </article>
    </section>
  );
}

type CustomerInsightsPanelV3Props = {
  customer: CustomerWithLedger | null;
  risk: ReturnType<typeof riskInfo> | null;
  ageing?: CustomerWithLedger["ledgerMetrics"]["ageing"];
  received: number;
  pending: number;
  collectionChange: number;
  payments: Array<Record<string, unknown>>;
  onReminder: () => void;
  rangeLabel?: string;
  onCycleRange?: () => void;
  onViewAllPayments?: () => void;
};

function CustomerInsightsPanelV3({ customer, risk, ageing, received, pending, collectionChange, payments, onReminder, rangeLabel = "This Week", onCycleRange, onViewAllPayments }: CustomerInsightsPanelV3Props) {
  const { t } = useAppLanguage();
  if (!customer || !risk) {
    return (
      <aside className="space-y-5 xl:col-span-2 2xl:col-span-1">
        <div className="grid min-h-[430px] place-items-center rounded-[16px] border border-dashed border-[#d8e2f1] bg-white px-6 text-center shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
          <div className="max-w-[230px]">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#fff7ed] text-[#f97316]"><Wallet size={22} /></span>
            <p className="mt-3 text-[15px] font-extrabold text-[var(--brand-ink)]">{t("customers.insights.title")}</p>
            <p className="mt-1 text-[12px] leading-5 text-[#60708e]">{t("customers.insights.help")}</p>
          </div>
        </div>
      </aside>
    );
  }
  const overdueDays = customer ? customerOverdueDays(customer) : 0;
  const sevenToThirty = Math.max(0, money(ageing?.sevenToThirty));
  const rawBuckets = [
    { value: Math.max(0, money(ageing?.zeroToSeven)), color: "#22c55e", label: t("customers.ageing.bucket0to7") },
    { value: overdueDays <= 15 ? sevenToThirty : 0, color: "#f59e0b", label: t("customers.ageing.bucket8to15") },
    { value: overdueDays > 15 && overdueDays <= 30 ? sevenToThirty : 0, color: "#ef4444", label: t("customers.ageing.bucket16to30") },
    { value: Math.max(0, money(ageing?.thirtyPlus)), color: "#8b5cf6", label: t("customers.ageing.bucket30plus") },
  ];
  const rawTotal = rawBuckets.reduce((sum, row) => sum + row.value, 0);
  const buckets = rawBuckets.map((row, index) => index === 0 && pending > rawTotal ? { ...row, value: row.value + pending - rawTotal } : row);
  const total = buckets.reduce((sum, row) => sum + row.value, 0);
  let acc = 0;
  const stops = buckets.filter((row) => row.value > 0).map((row) => { const from = total ? acc / total * 100 : 0; acc += row.value; return `${row.color} ${from}% ${total ? acc / total * 100 : 0}%`; }).join(", ");
  const collection = received + pending > 0 ? received / (received + pending) * 100 : 0;
  const recentPayments = [...payments].sort((a, b) => paymentDate(b).localeCompare(paymentDate(a))).slice(0, 4);
  return (
    <aside className="space-y-5 xl:col-span-2 2xl:col-span-1">
      <RightCardV3 title={t("customers.ageing.title")} info><div className="flex items-center gap-4"><div className="grid h-[130px] w-[130px] shrink-0 place-items-center rounded-full" style={{ background: total > 0 ? `conic-gradient(${stops})` : "#e7edf5" }}><div className="grid h-[94px] w-[94px] place-items-center rounded-full bg-white text-center"><div><p className="text-[16px] font-black text-[var(--brand-ink)]">{fmtMoney(total)}</p><p className="text-[10px] text-[#71809a]">{t("customers.detail.totalDue")}</p></div></div></div><div className="min-w-0 flex-1 space-y-3">{buckets.map((row) => <div key={row.label} className="grid grid-cols-[9px_1fr_auto] items-center gap-2 text-[10px]"><span className="h-[9px] w-[9px] rounded-full" style={{ background: row.color }} /><span className="text-[#52627e]">{row.label}</span><span className="text-right font-black text-[var(--brand-ink)]">{fmtMoney(row.value)} <span className="block text-[8px] font-medium text-[#94a3b8]">{total > 0 ? `${Math.round(row.value / total * 1000) / 10}%` : "0%"}</span></span></div>)}</div></div></RightCardV3>
      <RightCardV3 title={t("customers.collectionProgress")} action={rangeLabel} onAction={onCycleRange} pill info><div className="flex items-center gap-5"><div className="grid h-24 w-24 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(var(--brand) 0 ${collection}%, #e9eef6 ${collection}% 100%)` }}><div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-white text-center"><div><p className="text-[18px] font-black text-[var(--brand-ink)]">{Math.round(collection)}%</p><p className="text-[9px] font-semibold text-[#71809a]">{t("customers.insights.collected")}</p></div></div></div><div className="grid min-w-0 flex-1 grid-cols-2 gap-3"><div><p className="text-[10px] font-semibold text-[#71809a]">{t("customers.insights.collected")}</p><p className="mt-1 text-[14px] font-black text-[var(--brand-ink)]">{fmtMoney(received)}</p><p className={cn("mt-2 text-[9px] font-semibold", collectionChange < 0 ? "text-rose-600" : "text-emerald-600")}>vs previous period: {collectionChange >= 0 ? "↑" : "↓"} {Math.abs(collectionChange)}%</p></div><div><p className="text-[10px] font-semibold text-[#71809a]">{t("customers.insights.pending")}</p><p className="mt-1 text-[14px] font-black text-[var(--brand-ink)]">{fmtMoney(pending)}</p></div></div></div></RightCardV3>
      <RightCardV3 title={t("customers.payments.recent")} action="View all" onAction={onViewAllPayments}>{recentPayments.length === 0 ? <p className="py-4 text-center text-[11px] text-[#71809a]">{t("customers.detail.noPayments")}</p> : <div className="divide-y divide-[#edf1f6]">{recentPayments.map((payment, index) => { const mode = String(payment.mode ?? "cash").toLowerCase(); const modeLabel = mode === "upi" ? t("customers.pay.upi") : mode === "cash" ? t("customers.pay.cash") : mode.replace(/\b\w/g, (letter) => letter.toUpperCase()); return <div key={String(payment.id ?? index)} className="grid min-h-10 grid-cols-[7px_1fr_auto_auto] items-center gap-2.5 text-[10.5px]"><span className="h-[7px] w-[7px] rounded-full bg-[#22c55e]" /><span className="text-[#52627e]">{formatShortDate(paymentDate(payment))}</span><span className="font-black text-[var(--brand-ink)]">{fmtMoney(paymentAmount(payment))}</span><span className="min-w-[54px] text-right text-[#52627e]">{modeLabel}</span></div>; })}</div>}</RightCardV3>
      <RightCardV3 title={t("customers.profile.creditRisk")}><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600"><AlertTriangle size={15} /></span><div className="min-w-0 flex-1"><span className={cn("inline-flex rounded-[8px] px-2 py-1 text-[10px] font-bold", risk?.cls ?? "bg-slate-50 text-slate-600")}>{risk ? t(risk.labelKey) : t("customers.noCustomer")}</span><p className="mt-2 text-[10.5px] leading-4 text-[#60708e]">{overdueDays > 0 ? `Payment overdue for ${overdueDays} days. Send a reminder or collect payment.` : customer?.ledgerMetrics.warning ?? "Payment pattern looks trackable."}</p></div><Button variant="outline" onClick={onReminder} disabled={!customer} className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[9px] border-[#d6e2f2] px-2.5 text-[9px] font-bold text-[var(--brand)]"><Bell size={13} />{t("customers.payment.sendReminder")}</Button></div></RightCardV3>
    </aside>
  );
}

type CustomerLedgerRow = Record<string, unknown> & { id: string; signed_amount: number; running_balance: number; display_type: string; display_date: string };

function CustomerLedgerRegisterV3({ customer, rows, loading, onPrint }: { customer: CustomerWithLedger | null; rows: CustomerLedgerRow[]; loading: boolean; onPrint: () => void }) {
  const { t } = useAppLanguage();
  const [entryFilter, setEntryFilter] = useState<"all" | "bill" | "payment">("all");
  const visibleRows = rows.filter((row) => entryFilter === "all" || (entryFilter === "bill" ? row.display_type === "BILL" : row.display_type === "PAYMENT"));
  const fromDate = rows.length > 0 ? formatShortDate(rows[rows.length - 1]?.display_date) : t("customers.range.allTime");
  const toDate = rows.length > 0 ? formatShortDate(rows[0]?.display_date) : formatShortDate(new Date().toISOString());
  const badgeFor = (type: string) => type === "PAYMENT" ? "bg-[#dcfce7] text-[#16a34a]" : type.includes("OPEN") ? "bg-[#dbeafe] text-[var(--brand)]" : type === "BILL" ? "bg-[#fee2e2] text-[#dc2626]" : "bg-[#f5f3ff] text-[#7c3aed]";
  const labelFor = (type: string) => type === "PAYMENT" ? "Payment" : type === "BILL" ? t("customers.ledger.typeBill") : type.includes("OPEN") ? "Opening Balance" : type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  // A synced manual adjustment echoes back typed as debit/payment (mode:"adjustment"),
  // so display_type alone reads "Bill"/"Payment". Detect the adjustment and label it plainly.
  const entryBadge = (row: CustomerLedgerRow) => isManualAdjustmentEntry(row) ? "bg-[#f5f3ff] text-[#7c3aed]" : badgeFor(String(row.display_type ?? "ENTRY").toUpperCase());
  const entryLabel = (row: CustomerLedgerRow) => isManualAdjustmentEntry(row) ? t("customers.detail.adjustment") : labelFor(String(row.display_type ?? "ENTRY").toUpperCase());
  return (
    <section className="overflow-hidden rounded-[16px] border border-[#e6ecf5] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8edf4] px-[18px] py-4">
        <div><div className="flex items-center gap-1.5"><h2 className="text-[16px] font-extrabold text-[var(--brand-ink)]">{t("customers.ledger.title")}</h2><Info size={13} className="text-[#94a3b8]" /></div><p className="mt-1 text-[12px] text-[#71809a]">{t("customers.ledger.help")}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="h-9 min-w-[110px] justify-between rounded-[10px] border-[#d6e2f2] px-3 text-[10px] font-bold">{entryFilter === "all" ? t("customers.ledger.allEntries") : entryFilter === "bill" ? t("customers.ledger.bills") : t("customers.ledger.payments")}<ChevronRight size={12} className="rotate-90" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-36"><DropdownMenuItem onClick={() => setEntryFilter("all")}>{t("customers.ledger.allEntries")}</DropdownMenuItem><DropdownMenuItem onClick={() => setEntryFilter("bill")}>{t("customers.ledger.bills")}</DropdownMenuItem><DropdownMenuItem onClick={() => setEntryFilter("payment")}>{t("customers.ledger.payments")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          <Button variant="outline" className="h-9 gap-1.5 rounded-[10px] border-[#d6e2f2] px-3 text-[10px] font-bold"><CalendarDays size={13} className="text-[var(--brand)]" />{fromDate} - {toDate}<ChevronRight size={12} className="rotate-90" /></Button>
          <Button variant="outline" onClick={onPrint} disabled={!customer} className="h-9 rounded-[10px] border-[#d6e2f2] px-3 text-[10px] font-bold text-[var(--brand)]"><Download size={14} className="mr-1.5" />{t("customers.ledger.download")}</Button>
        </div>
      </header>
      <div className="grid min-w-0 2xl:grid-cols-[minmax(0,1fr)_270px]">
        <div className="divide-y divide-[#e8edf4] md:hidden">
          {loading ? (
            <div className="py-12 text-center text-[#71809a]">{t("customers.ledger.loading")}</div>
          ) : visibleRows.length === 0 ? (
            <div className="py-12 text-center text-[#71809a]">{t("customers.ledger.emptyResult")}</div>
          ) : visibleRows.slice(0, 8).map((row) => {
            const signed = Number(row.signed_amount ?? 0);
            const isCredit = signed < 0;
            return (
              <div key={row.id} className="grid grid-cols-[34px_1fr_auto] gap-3 px-4 py-4">
                <span className={cn("grid h-8 w-8 place-items-center rounded-full", isCredit ? "bg-[#ecfdf5] text-[#16a34a]" : "bg-[#fee2e2] text-[#dc2626]")}>
                  {isCredit ? <Wallet size={15} /> : <FileText size={15} />}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex rounded-[8px] px-2 py-1 text-[10px] font-bold", entryBadge(row))}>{entryLabel(row)}</span>
                    <span className="text-[11px] font-semibold text-[#71809a]">{formatShortDate(row.display_date)}</span>
                  </div>
                  <p className="mt-1 truncate text-[12px] font-bold text-[var(--brand-ink)]">{String(row.note || entryLabel(row))}</p>
                  <p className="mt-1 truncate text-[11px] text-[#60708e]">{String(row.source_id ?? "—")} • {String(row.mode ?? t("customers.ledger.modeSystem"))}</p>
                </div>
                <div className="text-right">
                  <p className={cn("text-[14px] font-black", isCredit ? "text-[#16a34a]" : "text-[#ef4444]")}>{isCredit ? "-" : "+"}{fmtMoney(Math.abs(signed))}</p>
                  <p className="mt-1 text-[11px] font-semibold text-[#71809a]">{t("customers.collect.balance", { amount: fmtMoney(row.running_balance) })}</p>
                  <span className="mt-2 inline-flex rounded-[7px] bg-[#dcfce7] px-2 py-1 text-[10px] font-bold text-[#15803d]">{t("customers.ledger.posted")}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1020px] text-[12.5px]">
            <thead><tr className="h-10 bg-[#f7f9fc] text-[10px] text-[#52617c]">{['Date','Entry Type','Reference','Description','Debit (₹)','Credit (₹)','Running Balance (₹)','Mode','Status','Action'].map((label) => <th key={label} className="px-3 text-left font-bold">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-[#e8edf4]">
              {loading ? <tr><td colSpan={10} className="py-12 text-center text-[#71809a]">{t("customers.ledger.loading")}</td></tr> : visibleRows.length === 0 ? <tr><td colSpan={10} className="py-12 text-center text-[#71809a]">{t("customers.ledger.emptyResult")}</td></tr> : visibleRows.slice(0, 8).map((row) => {
                const signed = Number(row.signed_amount ?? 0);
                return <tr key={row.id} className="h-12 text-[#24385f] transition-colors hover:bg-[#fbfcfe]"><td className="whitespace-nowrap px-3">{formatShortDate(row.display_date)}</td><td className="px-3"><span className={cn("inline-flex rounded-[8px] px-2 py-1 text-[11px] font-bold", entryBadge(row))}>{entryLabel(row)}</span></td><td className="whitespace-nowrap px-3 font-semibold text-[var(--brand)]">{String(row.source_id ?? "—")}</td><td className="max-w-[220px] truncate px-3">{String(row.note || entryLabel(row))}</td><td className="px-3 font-bold text-[#ef4444]">{signed > 0 ? fmtMoney(signed) : "—"}</td><td className="px-3 font-bold text-[#16a34a]">{signed < 0 ? fmtMoney(Math.abs(signed)) : "—"}</td><td className="px-3 font-black text-[var(--brand-ink)]">{fmtMoney(row.running_balance)}</td><td className="px-3">{String(row.mode ?? t("customers.ledger.modeSystem"))}</td><td className="px-3"><span className="inline-flex rounded-[8px] bg-[#dcfce7] px-2 py-1 text-[11px] font-bold text-[#15803d]">{t("customers.ledger.posted")}</span></td><td className="px-3"><DropdownMenu><DropdownMenuTrigger asChild><button title={t("customers.ledger.actions")} className="grid h-8 w-8 place-items-center rounded-[8px] border border-[#e6ecf5] bg-white text-[#60708e] hover:bg-[var(--brand-soft)] hover:text-[var(--brand)]"><MoreVertical size={15} /></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-44"><DropdownMenuItem onClick={() => { void navigator.clipboard?.writeText(String(row.source_id ?? row.id)); }}>{t("customers.ledger.copyReference")}</DropdownMenuItem><DropdownMenuItem onClick={onPrint} disabled={!customer}><Download size={14} className="mr-2" />{t("customers.ledger.printStatement")}</DropdownMenuItem>{customer && <><DropdownMenuSeparator /><DropdownMenuItem asChild><Link href={`/customers/${customer.id}`}><span className="flex items-center"><UserRound size={14} className="mr-2" />{t("customers.ledger.openFull")}</span></Link></DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu></td></tr>;
              })}
            </tbody>
          </table>
        </div>
        <aside className="hidden border-l border-[#e8edf4] bg-[#f8faff] p-4 2xl:block"><h3 className="text-[13px] font-black text-[var(--brand)]">{t("customers.ledger.howUdharWorks")}</h3><div className="mt-4 space-y-4 text-[10.5px] leading-4 text-[#52627e]"><HelpLineV3 tone="bg-[#fff7ed] text-[#f97316]" icon={<FileText size={14} />} text={t("customers.ledger.creditNote")} /><HelpLineV3 tone="bg-[#ecfdf5] text-[#16a34a]" icon={<Wallet size={14} />} text={t("customers.ledger.paymentNote")} /><HelpLineV3 tone="bg-[var(--brand-soft)] text-[var(--brand)]" icon={<CheckCircle2 size={14} />} text={t("customers.ledger.recordedNote")} /><HelpLineV3 tone="bg-[#f5f3ff] text-[#7c3aed]" icon={<Download size={14} />} text={t("customers.detail.statementShareHint")} /></div></aside>
      </div>
    </section>
  );
}

function CompactSummaryV3({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  const { t } = useAppLanguage();
  return <div className="border-b border-r border-[#e8edf4] px-3 py-3.5 last:border-r-0"><p className="text-[9px] font-bold uppercase text-[#75839d]">{label}</p><p className={cn("mt-1.5 text-[12px] font-black text-[var(--brand-ink)]", danger && "text-rose-600")}>{value}</p></div>;
}

function HelpLineV3({ icon, text, tone }: { icon: React.ReactNode; text: string; tone: string }) {
  const { t } = useAppLanguage();
  return <div className="flex items-start gap-3"><span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", tone)}>{icon}</span><span className="pt-0.5">{text}</span></div>;
}

function InfoMini({ label, value }: { label: string; value: string }) {
  const { t } = useAppLanguage();
  return (
    <div>
      <p className="text-[11px] font-bold text-[#64748b]">{label}</p>
      <p className="mt-1 text-[12px] font-black text-[var(--brand-ink)]">{value}</p>
    </div>
  );
}

function SummaryCell({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  const { t } = useAppLanguage();
  return (
    <div className="border-b border-[#e8eef7] pb-3 last:border-0 md:border-b-0 md:border-r md:pb-0 md:pr-4 md:last:border-r-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#64748b]">{label}</p>
      <p className={cn("mt-1 font-display text-[21px] font-black tracking-tight text-[var(--brand-ink)]", valueClass)}>{value}</p>
    </div>
  );
}

function ActionTile({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick?: () => void }) {
  const { t } = useAppLanguage();
  return (
    <button onClick={onClick} className="rounded-[14px] border border-[#e6ecf4] bg-white p-4 text-center shadow-[0_10px_24px_rgba(15,35,80,0.045)] transition-all hover:-translate-y-0.5 hover:border-[var(--brand-border)] hover:bg-[#f8fbff]">
      <span className="mx-auto grid h-10 w-10 place-items-center rounded-[12px] bg-[var(--brand-soft)] text-[var(--brand)]">{icon}</span>
      <span className="mt-2 block text-[12px] font-black text-[var(--brand-ink)]">{title}</span>
      <span className="mt-0.5 block text-[10.5px] font-medium text-[#64748b]">{sub}</span>
    </button>
  );
}

function RightCard({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: React.ReactNode }) {
  const { t } = useAppLanguage();
  return (
    <div className="rounded-[8px] border border-[#e2e9f3] bg-white p-4 shadow-[0_5px_18px_rgba(31,60,110,0.045)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-extrabold text-[var(--brand-ink)]">{title}</h3>
        {action ? <button onClick={onAction} className={cn("text-[9.5px] font-black text-[var(--brand)] hover:underline", action.startsWith("This Week") && "rounded-[5px] border border-[#dfe7f2] bg-[#fbfcfe] px-2 py-1 text-[#405273] no-underline")}>{action}</button> : null}
      </div>
      {children}
    </div>
  );
}

function RightCardV3({ title, action, onAction, info = false, pill = false, children }: { title: string; action?: string; onAction?: () => void; info?: boolean; pill?: boolean; children: React.ReactNode }) {
  const { t } = useAppLanguage();
  return (
    <div className="rounded-[16px] border border-[#e6ecf5] bg-white p-[18px] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5"><h3 className="text-[14px] font-extrabold text-[var(--brand-ink)]">{title}</h3>{info && <Info size={13} className="text-[#94a3b8]" />}</div>
        {action ? <button type="button" onClick={onAction} disabled={!onAction} className={cn("text-[10px] font-black text-[var(--brand)] hover:underline disabled:cursor-default disabled:opacity-60 disabled:hover:no-underline", pill && "rounded-[8px] border border-[#dfe7f2] bg-[#f8faff] px-2.5 py-1.5 text-[9px] text-[#405273] no-underline hover:bg-[#eef4ff]")}>{action}{pill && <ChevronRight size={10} className="ml-1 inline rotate-90" />}</button> : null}
      </div>
      {children}
    </div>
  );
}

function Legend({ color, inlineColor, label, value }: { color: string; inlineColor?: string; label: string; value: string }) {
  const { t } = useAppLanguage();
  return (
    <div className="flex items-center gap-2 text-[9.5px]">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", color)} style={inlineColor ? { backgroundColor: inlineColor } : undefined} />
      <span className="min-w-0 flex-1 truncate text-[#52627e]">{label}</span>
      <span className="font-black text-[var(--brand-ink)]">{value}</span>
    </div>
  );
}
