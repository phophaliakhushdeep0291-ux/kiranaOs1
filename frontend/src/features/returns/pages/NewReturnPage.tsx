import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  Eye,
  Filter,
  PackageCheck,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingBag,
  Smartphone,
  Trash2,
  Undo2,
  Wallet,
} from "lucide-react";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageShell, SyncBadge } from "@/components/shared";
import { useListBills } from "@/features/bills/queries";
import { useListCustomers } from "@/features/customers/queries";
import { useListProducts } from "@/features/products/queries";
import { ReturnDialog, type ReturnLineInput } from "@/features/returns/components/ReturnDialog";
import { dedupeBillsForDisplay } from "@/features/sync/bill-reconciliation";
import { useOfflineStatus } from "@/features/sync";
import { offlineDB } from "@/lib/offline/db";
import { cn } from "@/lib/utils";
import type { Bill, Product } from "@/types/api";

type RecordLike = Record<string, unknown>;
type ReturnTab = "sales" | "purchase";
type ReturnStatus = "all" | "completed" | "pending";
type ReturnModeFilter = "all" | "cash" | "upi" | "udhar";

interface ReturnRegisterData {
  bills: Bill[];
  items: RecordLike[];
}

interface ReturnRow {
  bill: Bill;
  id: string;
  type: ReturnTab;
  reference: string;
  customer: string;
  mobile: string;
  createdAt: string;
  dateKey: string;
  itemCount: number;
  quantity: number;
  amount: number;
  mode: "cash" | "upi" | "udhar" | "credit_note";
  status: "completed" | "pending";
  items: RecordLike[];
}

const PANEL = "overflow-hidden rounded-[9px] border border-[#e2e9f3] bg-white shadow-[0_5px_18px_rgba(31,60,110,0.045)]";
const MODE_META = {
  cash: { label: "Cash", color: "#24b75a", icon: Wallet },
  upi: { label: "UPI", color: "#1768f5", icon: Smartphone },
  udhar: { label: "Credit (Udhar)", color: "#7c4df1", icon: CreditCard },
  credit_note: { label: "Credit Note", color: "#f5a30a", icon: ReceiptText },
} as const;

function sellPrice(product: Product & RecordLike): number {
  const value = Number(product.defaultPricePerRateUnit ?? product.sellingPrice ?? product.mrp ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function money(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(Math.abs(number) * 100) / 100 : 0;
}

function inr(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function dateInput(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateInput(date);
}

function rowDate(bill: Bill): string {
  const record = bill as Bill & RecordLike;
  return String(bill.createdAt ?? record.created_at ?? record.date ?? "");
}

function compactReturnId(value: string): string {
  const suffix = value.match(/([A-Z0-9]{6,})$/i)?.[1];
  return suffix ? `RET-${suffix.toUpperCase()}` : value;
}

function isReturnBill(bill: Bill): boolean {
  return String(bill.billType ?? "").toLowerCase().includes("return");
}

function returnType(bill: Bill): ReturnTab {
  return String(bill.billType ?? "").toLowerCase().includes("purchase") ? "purchase" : "sales";
}

function returnStatus(bill: Bill): ReturnRow["status"] {
  const record = bill as Bill & RecordLike;
  const status = String(record.sync_status ?? bill.status ?? "").toLowerCase();
  return ["pending_sync", "syncing", "failed", "conflict", "local_only"].some((value) => status.includes(value)) ? "pending" : "completed";
}

function refundMode(bill: Bill): ReturnRow["mode"] {
  const record = bill as Bill & RecordLike;
  const raw = String(record.refundMode ?? record.refund_mode ?? record.paymentMode ?? record.payment_mode ?? "cash").toLowerCase();
  if (raw.includes("udhar") || raw.includes("credit")) return returnType(bill) === "purchase" ? "credit_note" : "udhar";
  if (raw.includes("upi") || raw.includes("bank") || raw.includes("card")) return "upi";
  return "cash";
}

function billIdentityKeys(bill: Bill): string[] {
  const record = bill as Bill & RecordLike;
  return [bill.id, bill.localBillId, bill.clientBillId, record.server_id, record.local_id]
    .map((value) => String(value ?? ""))
    .filter(Boolean);
}

function itemBillId(item: RecordLike): string {
  return String(item.billId ?? item.bill_id ?? item.localBillId ?? item.local_bill_id ?? "");
}

async function loadReturnRegister(): Promise<ReturnRegisterData> {
  const [bills, items] = await Promise.all([
    offlineDB.getAll<Bill>("bills").catch(() => []),
    offlineDB.getAll<RecordLike>("bill_items").catch(() => []),
  ]);
  return { bills, items };
}

function metricDelta(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1_000) / 10;
}

function previousRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const previousTo = new Date(start);
  previousTo.setDate(previousTo.getDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setDate(previousFrom.getDate() - days + 1);
  return { from: dateInput(previousFrom), to: dateInput(previousTo) };
}

export default function NewReturnPage() {
  const [location, navigate] = useLocation();
  const { pendingCount, failedCount } = useOfflineStatus();
  const billsQuery = useListBills({ limit: 1000 }, { query: { staleTime: 60_000 } });
  const productsQuery = useListProducts({ limit: 1000 });
  const customersQuery = useListCustomers({ limit: 2000 });
  const registerQuery = useQuery({ queryKey: ["return-register"], queryFn: loadReturnRegister, staleTime: 1_000 });
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(dateInput(new Date()));
  const [tab, setTab] = useState<ReturnTab>("sales");
  const [statusFilter, setStatusFilter] = useState<ReturnStatus>("all");
  const [modeFilter, setModeFilter] = useState<ReturnModeFilter>("all");
  const [search, setSearch] = useState("");
  const [builderOpen, setBuilderOpen] = useState(location === "/returns/new");
  const [refundOpen, setRefundOpen] = useState(false);
  const [lines, setLines] = useState<ReturnLineInput[]>([]);
  const [productId, setProductId] = useState("");
  const [customerId, setCustomerId] = useState("");

  useEffect(() => {
    const refresh = () => void registerQuery.refetch();
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [registerQuery.refetch]);

  useEffect(() => {
    if (location === "/returns/new") setBuilderOpen(true);
  }, [location]);

  const products = useMemo(() => (productsQuery.data ?? []) as Array<Product & RecordLike>, [productsQuery.data]);
  const customers = customersQuery.data ?? [];
  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const allBills = useMemo(
    () => dedupeBillsForDisplay([...(billsQuery.data?.bills ?? []), ...(registerQuery.data?.bills ?? [])]) as unknown as Bill[],
    [billsQuery.data?.bills, registerQuery.data?.bills],
  );

  const rows = useMemo<ReturnRow[]>(() => {
    const items = registerQuery.data?.items ?? [];
    const originalById = new Map<string, Bill>();
    allBills.forEach((bill) => billIdentityKeys(bill).forEach((key) => originalById.set(key, bill)));
    return allBills.filter(isReturnBill).map((bill) => {
      const keys = new Set(billIdentityKeys(bill));
      const billItems = items.filter((item) => keys.has(itemBillId(item)));
      const embedded = Array.isArray(bill.items) ? bill.items.filter((item): item is RecordLike => Boolean(item && typeof item === "object")) : [];
      const returnItems = billItems.length > 0 ? billItems : embedded;
      const record = bill as Bill & RecordLike;
      const originalId = String(record.returnOfBillId ?? record.return_of_bill_id ?? record.originalBillId ?? "");
      const original = originalById.get(originalId);
      const createdAt = rowDate(bill);
      return {
        bill,
        id: compactReturnId(String(bill.billNo ?? bill.billNumber ?? bill.id)),
        type: returnType(bill),
        reference: String(original?.billNo ?? original?.billNumber ?? record.originalBillNo ?? record.original_bill_no ?? "—"),
        customer: String(bill.customerName ?? "Walk-in Customer"),
        mobile: String(bill.customerMobile ?? record.customer_mobile ?? ""),
        createdAt,
        dateKey: createdAt.slice(0, 10),
        itemCount: returnItems.length,
        quantity: returnItems.reduce((sum, item) => sum + money(item.quantity ?? item.qty), 0),
        amount: money(bill.grandTotal ?? bill.totalAmount ?? bill.netAmount),
        mode: refundMode(bill),
        status: returnStatus(bill),
        items: returnItems,
      };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [allBills, registerQuery.data?.items]);

  const previous = useMemo(() => previousRange(from, to), [from, to]);
  const selectedRows = useMemo(() => rows.filter((row) => row.dateKey >= from && row.dateKey <= to), [rows, from, to]);
  const previousRows = useMemo(() => rows.filter((row) => row.dateKey >= previous.from && row.dateKey <= previous.to), [rows, previous]);
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return selectedRows.filter((row) => {
      const matchesTab = row.type === tab;
      const matchesStatus = statusFilter === "all" || row.status === statusFilter;
      const matchesMode = modeFilter === "all" || row.mode === modeFilter;
      const matchesSearch = !query || [row.id, row.reference, row.customer, row.mobile].some((value) => value.toLowerCase().includes(query));
      return matchesTab && matchesStatus && matchesMode && matchesSearch;
    });
  }, [selectedRows, tab, statusFilter, modeFilter, search]);

  const metrics = useMemo(() => calculateMetrics(selectedRows), [selectedRows]);
  const previousMetrics = useMemo(() => calculateMetrics(previousRows), [previousRows]);
  const spark = useMemo(() => buildSparkRows(selectedRows, from, to), [selectedRows, from, to]);
  const topItems = useMemo(() => buildTopItems(selectedRows), [selectedRows]);
  const modeSummary = useMemo(() => {
    return (["cash", "udhar", "upi", "credit_note"] as const)
      .map((mode) => ({ mode, value: selectedRows.filter((row) => row.mode === mode).reduce((sum, row) => sum + row.amount, 0), ...MODE_META[mode] }))
      .filter((item) => item.value > 0);
  }, [selectedRows]);

  function applyPreset(days: number) {
    setFrom(daysAgo(days));
    setTo(dateInput(new Date()));
  }

  function closeBuilder(open: boolean) {
    setBuilderOpen(open);
    if (!open && location === "/returns/new") navigate("/returns");
  }

  function addLine() {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    setLines((current) => current.some((line) => line.productId === product.id) ? current : [...current, {
      productId: product.id,
      name: product.name,
      soldQty: 0,
      enteredUnit: String(product.displayUnit ?? product.unit ?? product.rateUnit ?? "piece"),
      ratePerRateUnit: sellPrice(product),
      gstRate: Number(product.gstRate ?? 0),
    }]);
    setProductId("");
  }

  function continueToRefund() {
    if (lines.length === 0) return;
    setBuilderOpen(false);
    setRefundOpen(true);
    if (location === "/returns/new") navigate("/returns");
  }

  return (
    <PageShell className="space-y-4 bg-white p-4 sm:p-5 2xl:p-6">
      <section className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between 2xl:fixed 2xl:right-[276px] 2xl:top-[18px] 2xl:z-[60] 2xl:w-auto 2xl:flex-row 2xl:gap-3">
        <SyncBadge status={failedCount > 0 ? "failed" : pendingCount > 0 ? "pending" : "synced"} label={failedCount > 0 ? "Review sync" : pendingCount > 0 ? `${pendingCount} pending` : "Synced · Just now"} />
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-10 min-w-[230px] justify-between rounded-[8px] border-[#dfe7f2] bg-white px-3 text-[12px] font-semibold text-[#24385f]">
                <span className="inline-flex items-center gap-2"><CalendarDays size={14} className="text-[#1768f5]" />{format(new Date(`${from}T00:00:00`), "dd MMM yyyy")} - {format(new Date(`${to}T00:00:00`), "dd MMM yyyy")}</span>
                <ChevronDown size={13} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[320px] rounded-[8px] border-[#dfe7f2] p-3">
              <div className="mb-3 grid grid-cols-3 gap-1.5">
                <button className="rounded-[6px] bg-[#f2f6fc] px-2 py-2 text-[11px] font-bold text-[#405273] hover:bg-[#e8f0ff]" onClick={() => applyPreset(0)}>Today</button>
                <button className="rounded-[6px] bg-[#edf4ff] px-2 py-2 text-[11px] font-bold text-[#075fff]" onClick={() => applyPreset(6)}>7 days</button>
                <button className="rounded-[6px] bg-[#f2f6fc] px-2 py-2 text-[11px] font-bold text-[#405273] hover:bg-[#e8f0ff]" onClick={() => applyPreset(29)}>30 days</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-[10px] font-bold uppercase text-[#74819a]">From</Label><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 h-9 rounded-[6px]" /></div>
                <div><Label className="text-[10px] font-bold uppercase text-[#74819a]">To</Label><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 h-9 rounded-[6px]" /></div>
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild><Button variant="outline" className="h-10 gap-2 rounded-[8px] border-[#dfe7f2] px-4 text-[12px] font-semibold"><Filter size={14} />Filters</Button></PopoverTrigger>
            <PopoverContent align="end" className="w-56 space-y-3 rounded-[8px] p-3">
              <div><Label className="text-[10px] font-bold uppercase text-[#74819a]">Status</Label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ReturnStatus)} className="mt-1 h-9 w-full rounded-[6px] border border-[#dfe7f2] bg-white px-2 text-xs"><option value="all">All status</option><option value="completed">Completed</option><option value="pending">Pending sync</option></select></div>
              <div><Label className="text-[10px] font-bold uppercase text-[#74819a]">Refund mode</Label><select value={modeFilter} onChange={(event) => setModeFilter(event.target.value as ReturnModeFilter)} className="mt-1 h-9 w-full rounded-[6px] border border-[#dfe7f2] bg-white px-2 text-xs"><option value="all">All modes</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="udhar">Credit (Udhar)</option></select></div>
            </PopoverContent>
          </Popover>
          <Button onClick={() => setBuilderOpen(true)} className="h-10 gap-2 rounded-[8px] bg-[#075fff] px-5 text-[12px] font-bold text-white shadow-[0_8px_18px_rgba(7,95,255,0.2)] hover:bg-[#0052e0]"><Plus size={15} />New Return</Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <MetricCard label="Total Returns" value={inr(metrics.total)} previous={previousMetrics.total} current={metrics.total} color="#1768f5" icon={<ShoppingBag size={16} />} iconClass="bg-[#edf4ff] text-[#1768f5]" spark={spark.map((row) => row.total)} />
        <MetricCard label="Return Orders" value={String(metrics.orders)} previous={previousMetrics.orders} current={metrics.orders} color="#20b75a" icon={<RotateCcw size={16} />} iconClass="bg-[#eaf9ef] text-[#20a951]" spark={spark.map((row) => row.orders)} />
        <MetricCard label="Items Returned" value={String(metrics.items)} previous={previousMetrics.items} current={metrics.items} color="#f59b0b" icon={<PackageCheck size={16} />} iconClass="bg-[#fff3e5] text-[#f08b00]" spark={spark.map((row) => row.items)} />
        <MetricCard label="Refund Amount" value={inr(metrics.refund)} previous={previousMetrics.refund} current={metrics.refund} color="#ff334d" positiveIsBad icon={<CircleDollarSign size={16} />} iconClass="bg-[#ffedef] text-[#ff334d]" spark={spark.map((row) => row.refund)} />
        <MetricCard label="Credit Issued (Udhar)" value={inr(metrics.credit)} previous={previousMetrics.credit} current={metrics.credit} color="#1768f5" icon={<CreditCard size={16} />} iconClass="bg-[#edf4ff] text-[#1768f5]" spark={spark.map((row) => row.credit)} />
      </section>

      <section className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-2">
          <TabButton active={tab === "sales"} onClick={() => setTab("sales")} icon={<RotateCcw size={14} />}>Sales Returns</TabButton>
          <TabButton active={tab === "purchase"} onClick={() => setTab("purchase")} icon={<Undo2 size={14} />}>Purchase Returns</TabButton>
        </div>
        <div className="relative w-full lg:w-[320px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7b89a2]" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by invoice, customer, mobile..." className="h-10 rounded-[8px] border-[#dfe7f2] pl-9 text-xs" /></div>
      </section>

      <ReturnOrdersTable rows={filteredRows} loading={registerQuery.isLoading || billsQuery.isLoading} />

      <section className="grid gap-4 xl:grid-cols-[0.82fr_1fr]">
        <TopReturnedItems rows={topItems} />
        <ReturnSummary rows={modeSummary} total={metrics.total} />
      </section>

      <p className="mx-auto flex max-w-xl items-center justify-center gap-2 rounded-full bg-[#f7f9fc] px-4 py-2 text-center text-[10px] font-medium text-[#687792]"><CheckCircle2 size={13} className="text-[#1768f5]" />Sales returns affect stock. Resellable items are added back to inventory automatically.</p>

      <Dialog open={builderOpen} onOpenChange={closeBuilder}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>New sales return</DialogTitle><DialogDescription>For an exact refund, open the original bill and use Return items. This form records a standalone return.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <div><Label className="text-xs">Add product</Label><select data-testid="return-product-select" value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-1 h-10 w-full rounded-[8px] border bg-white px-2 text-sm"><option value="">Select a product...</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} — {inr(sellPrice(product))}</option>)}</select></div>
              <div className="flex items-end"><Button onClick={addLine} disabled={!productId} className="h-10 gap-1"><Plus size={15} />Add</Button></div>
            </div>
            {lines.length === 0 ? <p className="rounded-[8px] border border-dashed p-4 text-center text-sm text-muted-foreground">No items yet. Add products above.</p> : <ul className="divide-y rounded-[8px] border">{lines.map((line, index) => <li key={`${line.productId}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"><span className="min-w-0 truncate font-semibold">{line.name} <span className="font-normal text-muted-foreground">· {inr(line.ratePerRateUnit)}/{line.enteredUnit}</span></span><button type="button" title="Remove item" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="text-rose-600 hover:text-rose-700"><Trash2 size={15} /></button></li>)}</ul>}
            <div><Label className="text-xs">Customer (optional — required for an udhar refund)</Label><select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="mt-1 h-10 w-full rounded-[8px] border bg-white px-2 text-sm"><option value="">Walk-in / no customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.mobile ? ` · ${customer.mobile}` : ""}</option>)}</select></div>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => closeBuilder(false)}>Cancel</Button><Button onClick={continueToRefund} disabled={lines.length === 0} className="gap-2"><RotateCcw size={15} />Continue to refund</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      <ReturnDialog open={refundOpen} onOpenChange={setRefundOpen} lines={lines} customerId={selectedCustomer?.id} customerName={selectedCustomer?.name} gstMode="inclusive" onDone={() => { setLines([]); setCustomerId(""); void registerQuery.refetch(); }} />
    </PageShell>
  );
}

function calculateMetrics(rows: ReturnRow[]) {
  return {
    total: rows.reduce((sum, row) => sum + row.amount, 0),
    orders: rows.length,
    items: rows.reduce((sum, row) => sum + row.quantity, 0),
    refund: rows.filter((row) => row.mode === "cash" || row.mode === "upi").reduce((sum, row) => sum + row.amount, 0),
    credit: rows.filter((row) => row.mode === "udhar").reduce((sum, row) => sum + row.amount, 0),
  };
}

function buildSparkRows(rows: ReturnRow[], from: string, to: string) {
  const end = new Date(`${to}T00:00:00`);
  const start = new Date(`${from}T00:00:00`);
  const dayCount = Math.max(2, Math.min(7, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1));
  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(end);
    date.setDate(date.getDate() - (dayCount - index - 1));
    const key = dateInput(date);
    const dayRows = rows.filter((row) => row.dateKey === key);
    const metrics = calculateMetrics(dayRows);
    return { key, ...metrics };
  });
}

function buildTopItems(rows: ReturnRow[]) {
  const byProduct = new Map<string, { name: string; category: string; quantity: number; amount: number }>();
  for (const row of rows) {
    for (const item of row.items) {
      const productId = String(item.productId ?? item.product_id ?? item.name ?? "item");
      const quantity = money(item.quantity ?? item.qty);
      const amount = money(item.lineTotal ?? item.line_total ?? Number(item.ratePerRateUnit ?? item.rate_per_rate_unit ?? 0) * quantity);
      const current = byProduct.get(productId) ?? { name: String(item.name ?? item.productName ?? "Returned item"), category: String(item.category ?? "General"), quantity: 0, amount: 0 };
      current.quantity += quantity;
      current.amount += amount;
      byProduct.set(productId, current);
    }
  }
  return [...byProduct.values()].sort((a, b) => b.quantity - a.quantity || b.amount - a.amount).slice(0, 5);
}

function MetricCard({ label, value, current, previous, color, icon, iconClass, spark, positiveIsBad = false }: { label: string; value: string; current: number; previous: number; color: string; icon: ReactNode; iconClass: string; spark: number[]; positiveIsBad?: boolean }) {
  const change = metricDelta(current, previous);
  const bad = positiveIsBad ? change > 0 : change < 0;
  const gradientId = `return-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const data = spark.map((item, index) => ({ index, value: item }));
  return <article className={cn(PANEL, "min-h-[150px] p-4")}><div className="flex items-center gap-3"><span className={cn("grid h-9 w-9 place-items-center rounded-[9px]", iconClass)}>{icon}</span><p className="text-[11px] font-semibold text-[#34486e]">{label}</p></div><p className="mt-3 text-[22px] font-black leading-none text-[#101f40]">{value}</p><div className="mt-2 flex items-center gap-1 text-[9.5px]"><span className={cn("inline-flex items-center gap-0.5 font-bold", change === 0 ? "text-[#70809a]" : bad ? "text-[#ff334d]" : "text-[#10a948]")}>{change >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}{Math.abs(change)}%</span><span className="text-[#7a879f]">vs last period</span></div><div className="mt-1.5 h-7"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.25} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs><Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.7} fill={`url(#${gradientId})`} dot={{ r: 1.5, fill: "white", stroke: color, strokeWidth: 1.2 }} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div></article>;
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("inline-flex h-10 min-w-[160px] items-center justify-center gap-2 rounded-[8px] border px-4 text-[11px] font-bold transition-colors", active ? "border-[#075fff] bg-[#f4f7ff] text-[#075fff] shadow-[0_4px_12px_rgba(7,95,255,0.06)]" : "border-[#dfe7f2] bg-white text-[#405273] hover:bg-[#f8faff]")}>{icon}{children}</button>;
}

function ReturnOrdersTable({ rows, loading }: { rows: ReturnRow[]; loading: boolean }) {
  return <section className={PANEL}><header className="flex h-12 items-center px-4"><h2 className="text-[14px] font-extrabold text-[#13254a]">Return Orders</h2></header><div className="overflow-x-auto"><table className="w-full min-w-[1040px] border-collapse text-[10px]"><thead><tr className="border-y border-[#e5ebf3] bg-[#f7f9fc] text-[#52617c]">{["Return ID", "Order Type", "Reference", "Customer", "Date", "Items", "Return Amount", "Payment Mode", "Status", "Action"].map((header) => <th key={header} className="px-4 py-2.5 text-left font-bold">{header}</th>)}</tr></thead><tbody className="divide-y divide-[#e8edf4]">{loading ? <tr><td colSpan={10} className="h-32 text-center text-[#8290a8]">Loading returns...</td></tr> : rows.length === 0 ? <tr><td colSpan={10} className="h-36 text-center"><RotateCcw className="mx-auto mb-2 text-[#9aa8bc]" size={22} /><p className="font-bold text-[#314563]">No returns in this period</p><p className="mt-1 text-[#8290a8]">Record a new return or adjust the filters.</p></td></tr> : rows.slice(0, 10).map((row) => { const mode = MODE_META[row.mode]; return <tr key={row.bill.id} className="text-[#24385f] hover:bg-[#fbfcfe]"><td className="whitespace-nowrap px-4 py-2.5 font-bold">{row.id}</td><td className="px-4 py-2.5"><span className={cn("rounded-[5px] border px-2 py-1 font-bold", row.type === "sales" ? "border-[#cadcff] bg-[#edf4ff] text-[#1768f5]" : "border-[#dfcffd] bg-[#f5efff] text-[#8043e9]")}>{row.type === "sales" ? "Sales Return" : "Purchase Return"}</span></td><td className="px-4 py-2.5 font-semibold">{row.reference}</td><td className="px-4 py-2.5"><p className="font-bold">{row.customer}</p>{row.mobile && <p className="mt-0.5 text-[#73829a]">{row.mobile}</p>}</td><td className="whitespace-nowrap px-4 py-2.5"><p className="font-semibold">{row.createdAt ? format(new Date(row.createdAt), "dd MMM yyyy") : "—"}</p>{row.createdAt && <p className="mt-0.5 text-[#73829a]">{format(new Date(row.createdAt), "hh:mm a")}</p>}</td><td className="px-4 py-2.5 font-semibold">{row.quantity || row.itemCount}</td><td className="px-4 py-2.5 font-black text-[#102347]">{inr(row.amount)}</td><td className="whitespace-nowrap px-4 py-2.5"><span className="inline-flex items-center gap-2 font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: mode.color }} />{mode.label}</span></td><td className="px-4 py-2.5"><span className={cn("rounded-[5px] border px-2 py-1 font-bold", row.status === "completed" ? "border-[#c9efd5] bg-[#eaf9ef] text-[#169447]" : "border-[#ffdda8] bg-[#fff3e1] text-[#d77c00]")}>{row.status === "completed" ? "Completed" : "Pending"}</span></td><td className="px-4 py-2.5"><Link href={`/bills/${row.bill.id}`} title="View return"><span className="grid h-8 w-8 place-items-center rounded-[7px] border border-[#dfe7f2] text-[#075fff] hover:bg-[#edf4ff]"><Eye size={14} /></span></Link></td></tr>; })}</tbody></table></div>{rows.length > 0 && <Link href="/bills" className="flex h-10 items-center justify-center border-t border-[#e8edf4] text-[10px] font-bold text-[#075fff] hover:bg-[#f7faff]">View all returns</Link>}</section>;
}

function TopReturnedItems({ rows }: { rows: Array<{ name: string; category: string; quantity: number; amount: number }> }) {
  return <article className={PANEL}><header className="flex h-11 items-center justify-between px-4"><h2 className="text-[13px] font-extrabold text-[#13254a]">Top Returned Items</h2><Link href="/products" className="text-[10px] font-bold text-[#075fff]">View all</Link></header>{rows.length === 0 ? <div className="grid h-44 place-items-center text-[11px] text-[#8290a8]">No returned items in this period</div> : <div className="overflow-x-auto px-3 pb-3"><table className="w-full text-[10px]"><thead><tr className="border-y border-[#e5ebf3] bg-[#f7f9fc] text-[#52617c]"><th className="px-2 py-2 text-left">Product</th><th className="px-2 py-2 text-left">Category</th><th className="px-2 py-2 text-right">Qty Returned</th><th className="px-2 py-2 text-right">Return Amount</th></tr></thead><tbody className="divide-y divide-[#e8edf4]">{rows.map((row) => <tr key={row.name}><td className="px-2 py-2 font-bold text-[#24385f]">{row.name}</td><td className="px-2 py-2 text-[#60708e]">{row.category}</td><td className="px-2 py-2 text-right font-semibold">{row.quantity}</td><td className="px-2 py-2 text-right font-bold">{inr(row.amount)}</td></tr>)}</tbody></table></div>}</article>;
}

function ReturnSummary({ rows, total }: { rows: Array<{ mode: keyof typeof MODE_META; value: number; label: string; color: string }>; total: number }) {
  const chartRows = rows.length > 0 ? rows : [{ mode: "cash" as const, value: 1, label: "No returns", color: "#e6ebf2" }];
  return <article className={PANEL}><header className="flex h-11 items-center justify-between px-4"><h2 className="text-[13px] font-extrabold text-[#13254a]">Return Summary</h2><span className="rounded-[5px] border border-[#dfe6f0] bg-[#fbfcfe] px-2 py-1 text-[9px] font-semibold text-[#405273]">Selected period</span></header><div className="grid min-h-[205px] items-center gap-4 px-4 pb-4 sm:grid-cols-[220px_1fr]"><div className="relative mx-auto h-[180px] w-[180px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={chartRows} dataKey="value" nameKey="label" innerRadius={58} outerRadius={84} paddingAngle={1} stroke="#fff" strokeWidth={2}>{chartRows.map((row) => <Cell key={row.mode} fill={row.color} />)}</Pie></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><p className="text-[16px] font-black text-[#13244a]">{inr(total)}</p><p className="mt-1 text-[10px] text-[#7886a0]">Total Returns</p></div></div></div><div className="space-y-4">{rows.length === 0 ? <p className="text-center text-[11px] text-[#8290a8]">No refund activity yet</p> : rows.map((row) => <div key={row.mode} className="grid grid-cols-[10px_1fr_auto] items-center gap-2 text-[11px]"><span className="h-2 w-2 rounded-full" style={{ background: row.color }} /><span className="font-semibold text-[#2c3f64]">{row.label}</span><span className="font-bold text-[#15264b]">{inr(row.value)} <em className="font-normal not-italic text-[#75839d]">({total ? ((row.value / total) * 100).toFixed(1) : 0}%)</em></span></div>)}</div></div></article>;
}
