import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  AlertTriangle, Barcode, Box, CalendarDays, Check, CheckCircle2, ClipboardList, Columns3, Crown, FileText, Filter,
  Loader2, MoreVertical, Package, Pencil, Plus, RotateCcw, Search, ShoppingBag, Trash2, Truck, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  FinancialAggregationService,
  type FinancialAggregationSnapshot,
  type SupplierDueRow,
} from "@/features/finance/services/FinancialAggregationService";
import { hydratePurchaseHistoryFromSyncPull } from "@/features/sync/cloud-hydration";
import { useAuth } from "@/features/auth/useAuth";
import { deletePurchaseLocal, markPurchasePaidLocal, updatePurchaseLocal } from "@/features/purchases/local-actions";
import { recordPurchaseLocalFirst } from "@/features/inventory/local-actions";
import { createSupplierLocalFirst } from "@/features/suppliers/local-actions";
import { offlineDB } from "@/lib/offline/db";
import { useToast } from "@/hooks/use-toast";
import { usePanelResize, PanelResizeHandle } from "@/hooks/use-panel-resize";
import { CHIP_TONES } from "@/lib/chip-tones";
import { cn } from "@/lib/utils";
import { fromBaseQty, productDisplayUnit } from "@/features/products/pages/product-pricing";
import type { Product, Supplier } from "@/types/api";

function money(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function fmt(value: number | undefined | null) {
  return `₹${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function safeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "dd MMM yyyy");
}

function daysSince(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

const STATUS_CLS: Record<string, string> = {
  paid: CHIP_TONES.green,
  partial: CHIP_TONES.orange,
  due: CHIP_TONES.red,
};
const STATUS_LABEL: Record<string, string> = { paid: "Paid", partial: "Partial", due: "Unpaid" };
const MODE_CLS: Record<string, string> = {
  cash: CHIP_TONES.green,
  upi: CHIP_TONES.violet,
  bank: CHIP_TONES.blue,
  credit: CHIP_TONES.amber,
};
function modeLabel(mode: string) {
  if (mode === "upi") return "UPI";
  if (mode === "bank") return "Bank Transfer";
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

interface MovementRow extends Record<string, unknown> {
  id: string;
  action?: string;
  type?: string;
  productName?: string;
  quantityDelta?: number;
  quantity_delta?: number;
}

interface PurchaseFormState {
  supplierName: string;
  invoiceNumber: string;
  amount: string;
  paid: string;
  paymentMode: string;
}

function purchaseFormFromRow(row: SupplierDueRow): PurchaseFormState {
  return {
    supplierName: row.supplierName,
    invoiceNumber: row.invoiceNumber === "-" ? "" : row.invoiceNumber,
    amount: String(row.amount || ""),
    paid: String(row.paid || ""),
    paymentMode: row.paymentMode === "upi" ? "upi" : "cash",
  };
}

interface PurchaseLine {
  key: number;
  productId: string;
  qty: string;
  cost: string;
}

export default function PurchaseBillsPage() {
  const [snapshot, setSnapshot] = useState<FinancialAggregationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [cols, setCols] = useState({ items: true, paid: true, mode: true });
  const [topRange, setTopRange] = useState<"month" | "all">("month");
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<SupplierDueRow | null>(null);
  const [payingRow, setPayingRow] = useState<SupplierDueRow | null>(null);
  const [deletingRow, setDeletingRow] = useState<SupplierDueRow | null>(null);
  const [purchaseForm, setPurchaseForm] = useState<PurchaseFormState>({
    supplierName: "",
    invoiceNumber: "",
    amount: "",
    paid: "",
    paymentMode: "cash",
  });
  const [payMode, setPayMode] = useState("cash");
  const purchaseHydrationAttemptedRef = useRef(false);
  const { accessToken, isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const { width: panelWidth, isResizing, isDesktop, onResizeStart } = usePanelResize("kirana:purchases-panel-width", { defaultWidth: 440 });

  const reloadSnapshot = useCallback(async () => {
    const next = await FinancialAggregationService.buildSnapshot().catch(() => null);
    setSnapshot(next);
    return next;
  }, []);

  const reloadLocal = useCallback(async () => {
    const [productRows, supplierRows, movementRows] = await Promise.all([
      offlineDB.getAll<Product>("products").catch(() => []),
      offlineDB.getAll<Supplier>("suppliers").catch(() => []),
      offlineDB.getAll<MovementRow>("inventory_movements").catch(() => []),
    ]);
    setProducts(productRows.filter((p) => p?.name));
    setSuppliers(supplierRows.filter((s) => s?.name));
    setMovements(movementRows);
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      setLoading(true);
      const next = await FinancialAggregationService.buildSnapshot().catch(() => null);
      if (!active) return;

      if (
        !authLoading &&
        isAuthenticated &&
        accessToken &&
        !purchaseHydrationAttemptedRef.current
      ) {
        purchaseHydrationAttemptedRef.current = true;
        const imported = await hydratePurchaseHistoryFromSyncPull().catch(() => 0);
        if (!active) return;
        if (imported > 0) {
          const afterImport = await FinancialAggregationService.buildSnapshot().catch(() => next);
          if (!active) return;
          setSnapshot(afterImport);
          await reloadLocal();
          setLoading(false);
          return;
        }
      }

      setSnapshot(next);
      await reloadLocal();
      setLoading(false);
    };
    void refresh();
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      active = false;
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [accessToken, authLoading, isAuthenticated, reloadLocal]);

  const rows = useMemo(() => snapshot?.supplierDueRows ?? [], [snapshot]);

  const effectiveStatus = (row: SupplierDueRow) => (row.due > 0 ? row.status : "paid");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch = !q || [row.supplierName, row.invoiceNumber, row.status, row.paymentMode].join(" ").toLowerCase().includes(q);
      const matchesStatus = statusFilter === "all" || effectiveStatus(row) === statusFilter;
      const matchesMode = modeFilter === "all" || row.paymentMode === modeFilter;
      return matchesSearch && matchesStatus && matchesMode;
    });
  }, [rows, search, statusFilter, modeFilter]);

  useEffect(() => { setPage(1); }, [search, statusFilter, modeFilter, perPage]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * perPage, safePage * perPage);

  const totals = useMemo(() => rows.reduce(
    (sum, row) => { sum.amount += row.amount; sum.paid += row.paid; sum.due += row.due; return sum; },
    { amount: 0, paid: 0, due: 0 },
  ), [rows]);

  const monthStats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    const todayKey = now.toDateString();
    let thisMonth = 0, lastMonth = 0, todayAmount = 0, todayCount = 0, thisMonthCount = 0, lastMonthCount = 0;
    for (const row of rows) {
      const t = new Date(row.date).getTime();
      if (!Number.isFinite(t)) continue;
      if (t >= monthStart) { thisMonth += row.amount; thisMonthCount += 1; }
      else if (t >= lastMonthStart) { lastMonth += row.amount; lastMonthCount += 1; }
      if (new Date(row.date).toDateString() === todayKey) { todayAmount += row.amount; todayCount += 1; }
    }
    const delta = (now_: number, prev: number) => (prev > 0 ? Math.round(((now_ - prev) / prev) * 1000) / 10 : null);
    const avgThis = thisMonthCount ? thisMonth / thisMonthCount : 0;
    const avgLast = lastMonthCount ? lastMonth / lastMonthCount : 0;
    return {
      thisMonth, lastMonth, todayAmount, todayCount,
      totalDelta: delta(thisMonth, lastMonth),
      avg: avgThis, avgDelta: delta(avgThis, avgLast),
    };
  }, [rows]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Quantity for a purchase line, converted from base units (g/ml) to the product's display unit
  // so we show "5 litre" not "5000". Movements store quantity in base units.
  const movementDisplayQty = useCallback((m: MovementRow) => {
    const baseQty = Math.abs(Number(m.quantityDelta ?? m.quantity_delta ?? 0));
    if (baseQty <= 0) return 0;
    const product = productById.get(String((m as Record<string, unknown>).productId ?? (m as Record<string, unknown>).product_id ?? ""));
    return product ? fromBaseQty(baseQty, productDisplayUnit(product)) : baseQty;
  }, [productById]);

  const purchaseKey = (invoice: unknown, supplier: unknown) =>
    `${String(invoice ?? "").trim().toLowerCase()}|${String(supplier ?? "").trim().toLowerCase()}`;

  // A single purchase often exists as several movement rows (a pending local row + the synced /
  // hydrated copy). Collapse them by business signature so totals aren't double-counted.
  const purchaseMovements = useMemo(() => {
    const seen = new Set<string>();
    const out: MovementRow[] = [];
    for (const m of movements) {
      if (String(m.action ?? m.type ?? "").toLowerCase() !== "purchase") continue;
      const row = m as Record<string, unknown>;
      const baseQty = Math.abs(Number(m.quantityDelta ?? m.quantity_delta ?? 0));
      const sig = [
        String(row.invoiceNumber ?? row.invoice_number ?? "").trim().toLowerCase(),
        String(row.supplierName ?? row.supplier_name ?? row.supplierId ?? "").trim().toLowerCase(),
        String(row.productId ?? row.product_id ?? row.productName ?? "").trim().toLowerCase(),
        baseQty,
      ].join("|");
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(m);
    }
    return out;
  }, [movements]);

  // Map a purchase quantity by every identity key AND by an invoice+supplier business key. The
  // displayed rows are SupplierDueRows whose id is the purchase_bill id once synced (≠ movement
  // id), so an id-only lookup left the Items column blank after the first sync.
  const itemsByKey = useMemo(() => {
    const byId = new Map<string, number>();
    const byKey = new Map<string, number>();
    for (const m of purchaseMovements) {
      const qty = movementDisplayQty(m);
      if (qty <= 0) continue;
      const row = m as Record<string, unknown>;
      for (const id of [row.id, row.server_id, row.local_id]) { const k = String(id ?? ""); if (k) byId.set(k, qty); }
      const bizKey = purchaseKey(row.invoiceNumber ?? row.invoice_number, row.supplierName ?? row.supplier_name);
      if (bizKey !== "|") byKey.set(bizKey, (byKey.get(bizKey) ?? 0) + qty);
    }
    return { byId, byKey };
  }, [purchaseMovements, movementDisplayQty]);

  const rowItems = useCallback((row: SupplierDueRow): number | null => {
    const direct = itemsByKey.byId.get(row.id);
    if (direct != null) return direct;
    const byKey = itemsByKey.byKey.get(purchaseKey(row.invoiceNumber === "-" ? "" : row.invoiceNumber, row.supplierName));
    return byKey ?? null;
  }, [itemsByKey]);

  const mostPurchased = useMemo(() => {
    const agg = new Map<string, { name: string; qty: number }>();
    for (const m of purchaseMovements) {
      if (!m.productName) continue;
      const key = String((m as Record<string, unknown>).productId ?? m.productName);
      const cur = agg.get(key) ?? { name: m.productName, qty: 0 };
      cur.qty += movementDisplayQty(m);
      agg.set(key, cur);
    }
    const top = [...agg.values()].sort((a, b) => b.qty - a.qty)[0];
    return top && top.qty > 0 ? top : null;
  }, [purchaseMovements, movementDisplayQty]);

  const topSuppliers = useMemo(() => {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const source = topRange === "month" ? rows.filter((row) => new Date(row.date).getTime() >= monthStart) : rows;
    const base = source.reduce((sum, row) => sum + row.amount, 0);
    const map = new Map<string, { amount: number; count: number }>();
    for (const row of source) {
      const entry = map.get(row.supplierName) ?? { amount: 0, count: 0 };
      entry.amount += row.amount;
      entry.count += 1;
      map.set(row.supplierName, entry);
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v, share: base > 0 ? Math.round((v.amount / base) * 100) : 0 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [rows, topRange]);

  const recentRows = useMemo(
    () => [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 4),
    [rows],
  );

  const dueAlerts = useMemo(
    () => rows.filter((row) => row.due > 0).sort((a, b) => b.due - a.due).slice(0, 4),
    [rows],
  );

  function openEdit(row: SupplierDueRow) {
    setEditingRow(row);
    setPurchaseForm(purchaseFormFromRow(row));
  }

  function openPay(row: SupplierDueRow) {
    setPayingRow(row);
    setPayMode(row.paymentMode === "upi" ? "upi" : "cash");
  }

  async function saveEdit() {
    if (!editingRow || saving) return;
    const amount = money(purchaseForm.amount);
    const paid = money(purchaseForm.paid);
    if (amount <= 0) {
      toast({ title: "Enter purchase amount", variant: "destructive" });
      return;
    }
    if (paid < 0 || paid > amount) {
      toast({ title: "Invalid paid amount", description: "Paid amount cannot be more than purchase amount.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await updatePurchaseLocal(editingRow, {
        supplierName: purchaseForm.supplierName.trim() || "Supplier",
        invoiceNumber: purchaseForm.invoiceNumber.trim(),
        amount,
        paid,
        due: Math.max(0, amount - paid),
        paymentMode: purchaseForm.paymentMode,
        status: amount - paid <= 0 ? "paid" : paid > 0 ? "partial" : "due",
      });
      await reloadSnapshot();
      setEditingRow(null);
      toast({ title: "Purchase updated", description: "Supplier ledger totals were refreshed." });
    } catch (error) {
      toast({ title: "Could not update purchase", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function savePaid() {
    if (!payingRow || saving) return;
    setSaving(true);
    try {
      await markPurchasePaidLocal(payingRow, payMode);
      await reloadSnapshot();
      setPayingRow(null);
      toast({ title: "Purchase marked paid", description: "Supplier due is now cleared for this bill." });
    } catch (error) {
      toast({ title: "Could not mark paid", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deletingRow || saving) return;
    setSaving(true);
    try {
      await deletePurchaseLocal(deletingRow);
      await reloadSnapshot();
      setDeletingRow(null);
      toast({ title: "Purchase removed", description: "The purchase ledger row was removed from local finance views." });
    } catch (error) {
      toast({ title: "Could not remove purchase", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const header = ["Purchase No", "Supplier", "Date", "Items", "Total", "Paid", "Due", "Mode", "Status"];
    const lines = filtered.map((row) => [
      row.invoiceNumber === "-" ? "Local purchase" : row.invoiceNumber, row.supplierName, safeDate(row.date),
      rowItems(row) ?? "", row.amount, row.paid, row.due, row.paymentMode, STATUS_LABEL[effectiveStatus(row)] ?? row.status,
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "kirana-purchases.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className={cn("app-docked-page", isResizing ? "" : "transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]")}
      style={panelOpen && isDesktop ? { paddingRight: panelWidth + 24 } : undefined}
    >
      <div className="space-y-4">
        {/* KPI row — label left, icon top-right per reference */}
        <div className="grid grid-cols-1 gap-3.5 min-[460px]:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Total Purchase Value" value={fmt(totals.amount)} icon={<ShoppingBag size={16} />} iconBg="bg-[#e8f0fe] text-[#2563eb]"
            delta={monthStats.totalDelta} deltaSuffix="vs last month" fallbackSub={`${rows.length} purchase bills`} loading={loading} />
          <Kpi label="Unpaid Purchase Dues" value={fmt(totals.due)} icon={<AlertTriangle size={16} />} iconBg="bg-[#fdebeb] text-[#ef4444]"
            sub={totals.due > 0 ? `${rows.filter((r) => r.due > 0).length} bills pending` : "All bills settled"} subTone={totals.due > 0 ? "bad" : "good"} loading={loading} />
          <Kpi label="Today's Purchases" value={fmt(monthStats.todayAmount)} icon={<CalendarDays size={16} />} iconBg="bg-[#e8f0fe] text-[#2563eb]"
            sub={`${monthStats.todayCount} bill${monthStats.todayCount === 1 ? "" : "s"} today`} subTone="muted" loading={loading} />
          <Kpi label="Stock Added (This Month)" value={fmt(monthStats.thisMonth)} icon={<Box size={16} />} iconBg="bg-[#e8f0fe] text-[#2563eb]"
            delta={monthStats.totalDelta} deltaSuffix="vs last month" fallbackSub="first month of data" loading={loading} />
        </div>

        {/* Insight strip — one card, four cells */}
        <div className="grid grid-cols-1 divide-y divide-[#eef2f8] rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)] min-[560px]:grid-cols-2 xl:grid-cols-4 xl:divide-y-0 xl:divide-x">
          <Insight icon={<Crown size={15} />} iconBg="bg-[#e8f0fe] text-[#2563eb]" label="Top Supplier"
            value={topSuppliers[0]?.name ?? "—"} sub={topSuppliers[0] ? `${fmt(topSuppliers[0].amount)} (${topSuppliers[0].share}%)` : "No purchases yet"} />
          <Insight icon={<Package size={15} />} iconBg="bg-[#fdf3e1] text-[#d97706]" label="Most Purchased Item"
            value={mostPurchased?.name ?? "—"} sub={mostPurchased ? `${mostPurchased.qty.toLocaleString("en-IN")} units` : "No item data yet"} />
          <Insight icon={<ClipboardList size={15} />} iconBg="bg-[#e6f7ee] text-[#16a34a]" label="Avg. Bill Value"
            value={monthStats.avg ? fmt(monthStats.avg) : "—"}
            sub={monthStats.avgDelta != null ? `${monthStats.avgDelta >= 0 ? "↗" : "↓"} ${Math.abs(monthStats.avgDelta)}% vs last month` : "this month"}
            subTone={monthStats.avgDelta != null ? (monthStats.avgDelta >= 0 ? "good" : "bad") : "muted"} />
          <Insight icon={<RotateCcw size={15} />} iconBg="bg-[#fdebeb] text-[#ef4444]" label="Purchase Return Value"
            value={fmt(0)} sub="No returns recorded" />
        </div>

        {/* Purchase Bills table */}
        <div id="purchase-table" className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
          <div className="flex flex-col gap-3 border-b border-[#eef2f8] px-5 py-3.5 xl:flex-row xl:items-center xl:justify-between">
            <h3 className="font-display text-[14px] font-black tracking-tight text-[#102347]">Purchase Bills</h3>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                <Input className="h-9 pl-8 text-[12.5px]" placeholder="Search by bill no., supplier or product…" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <Button variant="outline" className={cn("h-9 gap-1.5 rounded-[9px] text-[12px] font-bold", showFilters && "border-[#2563eb] text-[#2563eb]")} onClick={() => setShowFilters((s) => !s)}>
                <Filter size={13} /> Filters
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold"><Columns3 size={13} /> Columns</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {([["items", "Items"], ["paid", "Paid Amount"], ["mode", "Payment Mode"]] as const).map(([key, label]) => (
                    <DropdownMenuItem key={key} onClick={(event) => { event.preventDefault(); setCols((c) => ({ ...c, [key]: !c[key] })); }}>
                      <span className="mr-2 grid h-4 w-4 place-items-center rounded border border-[#cbd5e1]">{cols[key] && <Check size={11} className="text-[#2563eb]" />}</span>
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={exportCsv} disabled={filtered.length === 0} style={{ background: "linear-gradient(180deg,#0057ff 0%,#0047e8 100%)" }} className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold text-white hover:opacity-95">
                <Upload size={13} className="rotate-180" /> Export
              </Button>
              <Button onClick={() => setPanelOpen(true)} style={{ background: "linear-gradient(180deg,#0057ff 0%,#0047e8 100%)" }} className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold text-white hover:opacity-95">
                <Plus size={14} /> Add Purchase
              </Button>
            </div>
          </div>
          {showFilters && (
            <div className="flex flex-wrap items-center gap-2 border-b border-[#eef2f8] bg-[#fafcff] px-5 py-2.5">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="due">Unpaid</SelectItem>
                </SelectContent>
              </Select>
              <Select value={modeFilter} onValueChange={setModeFilter}>
                <SelectTrigger className="h-9 w-[170px] text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Payment Modes</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                </SelectContent>
              </Select>
              <button onClick={() => { setStatusFilter("all"); setModeFilter("all"); }} className="text-[12px] font-bold text-[#2563eb] hover:underline">Reset</button>
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[#eef5ff] text-[#0057ff]"><Truck size={22} /></span>
              <p className="text-[13px] font-bold text-[#102347]">No purchase bills yet</p>
              <p className="text-[12px] text-[#64748b]">Click "Add Purchase" to record your first supplier bill.</p>
            </div>
          ) : (
            <>
              <div className="app-table-scroll overflow-x-auto">
                <table className="w-full min-w-[860px] text-[12.5px]">
                  <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-bold">Purchase No.</th>
                      <th className="px-4 py-2.5 text-left font-bold">Supplier</th>
                      <th className="px-4 py-2.5 text-left font-bold">Date</th>
                      {cols.items && <th className="px-4 py-2.5 text-right font-bold">Items</th>}
                      <th className="px-4 py-2.5 text-right font-bold">Total Amount</th>
                      {cols.paid && <th className="px-4 py-2.5 text-right font-bold">Paid Amount</th>}
                      <th className="px-4 py-2.5 text-right font-bold">Due Amount</th>
                      {cols.mode && <th className="px-4 py-2.5 text-left font-bold">Payment Mode</th>}
                      <th className="px-4 py-2.5 text-left font-bold">Status</th>
                      <th className="px-4 py-2.5 text-right font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row, i) => {
                      const status = effectiveStatus(row);
                      return (
                        <tr key={`${row.source}:${row.id}`} className={i < pageRows.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                          <td className="px-4 py-3">
                            <p className="font-bold text-[#102347]">{row.invoiceNumber === "-" ? "Local purchase" : row.invoiceNumber}</p>
                            <p className="text-[10px] text-[#94a3b8]">{row.source === "purchase_bill" ? "Purchase bill" : "Inventory movement"}</p>
                          </td>
                          <td className="px-4 py-3 font-semibold text-[#344668]">{row.supplierName}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-[#52627e]">{safeDate(row.date)}</td>
                          {cols.items && <td className="px-4 py-3 text-right text-[#52627e]">{(() => { const n = rowItems(row); return n != null ? n.toLocaleString("en-IN") : "—"; })()}</td>}
                          <td className="whitespace-nowrap px-4 py-3 text-right font-black text-[#102347]">{fmt(row.amount)}</td>
                          {cols.paid && <td className="whitespace-nowrap px-4 py-3 text-right text-[#344668]">{fmt(row.paid)}</td>}
                          <td className={cn("whitespace-nowrap px-4 py-3 text-right font-bold", row.due > 0 ? "text-[#ef4444]" : "text-[#344668]")}>{fmt(row.due)}</td>
                          {cols.mode && <td className="px-4 py-3"><span className={cn("whitespace-nowrap rounded-[7px] px-2 py-[3px] text-[11px] font-bold", MODE_CLS[row.paymentMode] ?? "bg-[#eef2f8] text-[#64748b]")}>{modeLabel(row.paymentMode)}</span></td>}
                          <td className="px-4 py-3"><span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", STATUS_CLS[status] ?? STATUS_CLS.due)}>{STATUS_LABEL[status] ?? status}</span></td>
                          <td className="px-4 py-3 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="grid h-7 w-7 place-items-center rounded-[7px] text-[#536583] hover:bg-[#eef2f8]" aria-label={`Actions for ${row.invoiceNumber}`}><MoreVertical size={15} /></button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem disabled={row.due <= 0 || saving} onClick={() => openPay(row)}><CheckCircle2 size={14} className="mr-2" /> Mark paid</DropdownMenuItem>
                                <DropdownMenuItem disabled={saving} onClick={() => openEdit(row)}><Pencil size={14} className="mr-2" /> Edit purchase</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-rose-600 focus:text-rose-700" disabled={saving} onClick={() => setDeletingRow(row)}><Trash2 size={14} className="mr-2" /> Delete purchase</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
                    Rows per page
                    <Select value={String(perPage)} onValueChange={(value) => setPerPage(Number(value))}>
                      <SelectTrigger className="h-7 w-[60px] text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{[10, 20, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Bottom insight row */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Top suppliers */}
          <div className="rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
            <div className="flex items-center justify-between border-b border-[#eef2f8] px-5 py-3">
              <h3 className="font-display text-[13.5px] font-black tracking-tight text-[#102347]">Top Suppliers</h3>
              <Select value={topRange} onValueChange={(value) => setTopRange(value as "month" | "all")}>
                <SelectTrigger className="h-7 w-[110px] text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="month">This Month</SelectItem><SelectItem value="all">All Time</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="px-5 py-2">
              {topSuppliers.length === 0 ? <EmptyHint text="No purchases in this period." /> : topSuppliers.map((s, i) => (
                <div key={s.name} className={cn("flex items-center gap-3 py-2.5", i < topSuppliers.length - 1 && "border-b border-[#eef2f8]")}>
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#eef5ff] text-[11px] font-black text-[#0057ff]">{i + 1}</span>
                  <p className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-[#102347]">{s.name}</p>
                  <span className="shrink-0 text-[11.5px] font-bold text-[#344668]">{fmt(s.amount)} <span className="text-[10px] font-semibold text-[#94a3b8]">({s.share}%)</span></span>
                </div>
              ))}
              <Link href="/suppliers" className="block py-2.5 text-[12px] font-bold text-[#2563eb] hover:underline">View all suppliers</Link>
            </div>
          </div>

          {/* Recent activity */}
          <div className="rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
            <div className="flex items-center justify-between border-b border-[#eef2f8] px-5 py-3">
              <h3 className="font-display text-[13.5px] font-black tracking-tight text-[#102347]">Recent Purchase Activity</h3>
              <a href="#purchase-table" className="text-[11.5px] font-bold text-[#2563eb] hover:underline">View all</a>
            </div>
            <div className="px-5 py-2">
              {recentRows.length === 0 ? <EmptyHint text="No purchases recorded yet." /> : recentRows.map((row, i) => (
                <div key={`${row.source}:${row.id}`} className={cn("flex items-center gap-3 py-2.5", i < recentRows.length - 1 && "border-b border-[#eef2f8]")}>
                  <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[8px]", row.due > 0 ? "bg-[#fdf3e1] text-[#d97706]" : "bg-[#e6f7ee] text-[#16a34a]")}><FileText size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-bold text-[#102347]">{row.invoiceNumber === "-" ? "Local purchase" : row.invoiceNumber} <span className="font-medium text-[#64748b]">from {row.supplierName}</span></p>
                    <p className="text-[10.5px] text-[#94a3b8]">{fmt(row.amount)} <span className="text-[#cbd5e1]">•</span> {STATUS_LABEL[effectiveStatus(row)]} <span className="text-[#cbd5e1]">•</span> {safeDate(row.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Due alerts */}
          <div className="rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
            <div className="flex items-center justify-between border-b border-[#eef2f8] px-5 py-3">
              <h3 className="font-display text-[13.5px] font-black tracking-tight text-[#102347]">Purchase Due Alerts</h3>
              <button onClick={() => { setShowFilters(true); setStatusFilter("due"); }} className="text-[11.5px] font-bold text-[#2563eb] hover:underline">View all</button>
            </div>
            <div className="px-5 py-2">
              {dueAlerts.length === 0 ? <EmptyHint text="No supplier dues — all settled. 🎉" /> : (
                <>
                  {dueAlerts.map((row, i) => (
                    <div key={`${row.source}:${row.id}`} className={cn("flex items-center gap-3 py-2.5", i < dueAlerts.length - 1 && "border-b border-[#eef2f8]")}>
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[#fdebeb] text-[#ef4444]"><AlertTriangle size={14} /></span>
                      <p className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-[#102347]">{row.supplierName}</p>
                      <div className="shrink-0 text-right">
                        <p className="text-[12.5px] font-black text-[#102347]">{fmt(row.due)}</p>
                        <p className="text-[10px] font-bold text-[#ef4444]">Due {daysSince(row.date)} day{daysSince(row.date) === 1 ? "" : "s"}</p>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-[#eef2f8] py-2.5">
                    <span className="text-[12px] font-bold text-[#344668]">Total Overdue</span>
                    <span className="text-[13px] font-black text-[#ef4444]">{fmt(totals.due)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <AddPurchasePanel
        open={panelOpen}
        width={panelWidth}
        onResizeStart={onResizeStart}
        products={products}
        suppliers={suppliers}
        onClose={() => setPanelOpen(false)}
        onSaved={async () => { setPanelOpen(false); await reloadSnapshot(); await reloadLocal(); }}
      />

      <Dialog open={Boolean(editingRow)} onOpenChange={(open) => !open && setEditingRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit purchase</DialogTitle>
            <DialogDescription>Update supplier bill details and payment status.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>Supplier</Label>
              <Input className="mt-1" value={purchaseForm.supplierName} onChange={(event) => setPurchaseForm((current) => ({ ...current, supplierName: event.target.value }))} />
            </div>
            <div>
              <Label>Bill number</Label>
              <Input className="mt-1" value={purchaseForm.invoiceNumber} onChange={(event) => setPurchaseForm((current) => ({ ...current, invoiceNumber: event.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" className="mt-1" value={purchaseForm.amount} onChange={(event) => setPurchaseForm((current) => ({ ...current, amount: event.target.value }))} />
              </div>
              <div>
                <Label>Paid</Label>
                <Input type="number" min="0" step="0.01" className="mt-1" value={purchaseForm.paid} onChange={(event) => setPurchaseForm((current) => ({ ...current, paid: event.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Payment mode</Label>
              <Select value={purchaseForm.paymentMode} onValueChange={(value) => setPurchaseForm((current) => ({ ...current, paymentMode: value }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI / bank</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRow(null)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void saveEdit()} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(payingRow)} onOpenChange={(open) => !open && setPayingRow(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark purchase paid</DialogTitle>
            <DialogDescription>Clear the remaining supplier due for this purchase.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Payment mode</Label>
            <Select value={payMode} onValueChange={setPayMode}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="upi">UPI / bank</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayingRow(null)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void savePaid()} disabled={saving}>{saving ? "Saving..." : "Mark paid"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deletingRow)} onOpenChange={(open) => !open && setDeletingRow(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete purchase</DialogTitle>
            <DialogDescription>This removes the purchase from local finance views while preserving stock history.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingRow(null)} disabled={saving}>Cancel</Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={saving}>{saving ? "Deleting..." : "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Add Purchase docked panel ── */
function AddPurchasePanel({ open, width, onResizeStart, products, suppliers, onClose, onSaved }: {
  open: boolean; width: number; onResizeStart: (e: React.MouseEvent) => void;
  products: Product[]; suppliers: Supplier[];
  onClose: () => void; onSaved: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [contact, setContact] = useState("");
  const [mobile, setMobile] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [purchaseNo, setPurchaseNo] = useState("");
  const [payMode, setPayMode] = useState("upi");
  const [payStatus, setPayStatus] = useState<"paid" | "partial" | "due">("due");
  const [paidInput, setPaidInput] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>([{ key: 1, productId: "", qty: "", cost: "" }]);
  const [notes, setNotes] = useState("");
  const [fileName, setFileName] = useState("");
  const keyRef = useRef(2);

  const selectedSupplier = suppliers.find((s) => s.id === supplierId);

  useEffect(() => {
    if (selectedSupplier) { setMobile(selectedSupplier.mobile ?? ""); setContact(selectedSupplier.name); }
  }, [selectedSupplier]);

  const lineTotal = (line: PurchaseLine) => (Number(line.qty) || 0) * (Number(line.cost) || 0);
  const totalAmount = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const totalItems = lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
  const paidAmount = payStatus === "paid" ? totalAmount : payStatus === "due" ? 0 : Math.min(Math.max(Number(paidInput) || 0, 0), totalAmount);
  const dueAmount = Math.max(0, totalAmount - paidAmount);

  function setLine(key: number, patch: Partial<PurchaseLine>) {
    setLines((prev) => prev.map((line) => {
      if (line.key !== key) return line;
      const next = { ...line, ...patch };
      // Picking a product seeds its last known cost as the default unit cost.
      if (patch.productId) {
        const product = products.find((p) => p.id === patch.productId);
        if (product && !line.cost) next.cost = String((product as { costPerRateUnit?: number }).costPerRateUnit ?? "");
      }
      return next;
    }));
  }

  function reset() {
    setSupplierId(""); setNewSupplierName(""); setContact(""); setMobile("");
    setDate(new Date().toISOString().slice(0, 10)); setPurchaseNo(""); setPayMode("upi"); setPayStatus("due");
    setPaidInput(""); setLines([{ key: keyRef.current++, productId: "", qty: "", cost: "" }]); setNotes(""); setFileName("");
  }

  async function save() {
    if (saving) return;
    const validLines = lines.filter((line) => line.productId && (Number(line.qty) || 0) > 0 && (Number(line.cost) || 0) > 0);
    const supplierName = supplierId === "new" ? newSupplierName.trim() : selectedSupplier?.name ?? "";
    if (!supplierName) { toast({ title: "Choose a supplier", description: "Pick an existing supplier or add a new one.", variant: "destructive" }); return; }
    if (validLines.length === 0) { toast({ title: "Add at least one product", description: "Each line needs a product, quantity, and cost.", variant: "destructive" }); return; }
    if (payStatus === "partial" && (paidAmount <= 0 || paidAmount >= totalAmount)) {
      toast({ title: "Enter partial paid amount", description: "Partial purchases need a paid amount greater than zero and less than the bill total.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      let resolvedSupplierId: string | undefined = supplierId !== "new" ? supplierId : undefined;
      if (supplierId === "new") {
        const created = await createSupplierLocalFirst({ name: supplierName, mobile: mobile.trim() || undefined });
        resolvedSupplierId = created.id;
      }
      const invoice = purchaseNo.trim() || `PUR-${format(new Date(), "yyMMdd-HHmmss")}`;
      for (const line of validLines) {
        const product = products.find((p) => p.id === line.productId);
        const amount = lineTotal(line);
        const share = totalAmount > 0 ? amount / totalAmount : 0;
        const linePaid = Math.round(paidAmount * share * 100) / 100;
        const lineDue = Math.max(0, Math.round((amount - linePaid) * 100) / 100);
        const lineStatus = lineDue <= 0 ? "paid" : linePaid > 0 ? "partial" : "due";
        await recordPurchaseLocalFirst({
          productId: line.productId,
          productName: product?.name,
          quantity: Number(line.qty) || 0,
          quantityDelta: Number(line.qty) || 0,
          enteredUnit: (product as { rateUnit?: string; displayUnit?: string } | undefined)?.rateUnit ?? (product as { displayUnit?: string } | undefined)?.displayUnit ?? "piece",
          supplierId: resolvedSupplierId,
          supplierName,
          invoiceNumber: invoice,
          billAmount: amount,
          costPerRateUnit: Number(line.cost) || 0,
          purchasePaymentStatus: lineStatus,
          purchasePaymentMode: linePaid > 0 ? payMode : undefined,
          purchasePaidAmount: linePaid,
          purchaseDueAmount: lineDue,
          purchaseDueDate: lineDue > 0 ? date : undefined,
          note: notes.trim() || undefined,
        });
      }
      toast({ title: `Purchase ${invoice} saved`, description: `${validLines.length} product${validLines.length === 1 ? "" : "s"} added to stock. ${dueAmount > 0 ? `${fmt(dueAmount)} due to ${supplierName}.` : "Fully paid."}` });
      reset();
      await onSaved();
    } catch (error) {
      toast({ title: "Could not save purchase", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside
      style={{ width }}
      className={`app-slide-panel fixed right-0 top-0 z-40 flex h-full w-full max-w-[100vw] flex-col border-l border-[#e6ecf4] bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[var(--app-desktop-topbar-height)] lg:h-[calc(100vh-var(--app-desktop-topbar-height))] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog" aria-label="Add purchase" aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[#0f1e3d]">Add Purchase</h2>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">Add a new purchase bill</p>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] hover:bg-[#f1f4f8]" aria-label="Close"><X size={18} /></button>
      </div>

      <div className="app-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
        {/* Supplier information */}
        <section className="space-y-3">
          <h3 className="text-[13px] font-black text-[#13274d]">Supplier Information</h3>
          <Fld label="Supplier *">
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                <SelectItem value="new">＋ Add new supplier…</SelectItem>
              </SelectContent>
            </Select>
          </Fld>
          {supplierId === "new" && (
            <Fld label="New supplier name *"><Input className="h-10" placeholder="Shree Balaji Distributors" value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} /></Fld>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Fld label="Contact Person"><Input className="h-10" placeholder="Ramesh Ji" value={contact} onChange={(e) => setContact(e.target.value)} /></Fld>
            <Fld label="Mobile"><Input className="h-10" placeholder="+91 98290 12345" value={mobile} onChange={(e) => setMobile(e.target.value)} /></Fld>
          </div>
        </section>

        {/* Bill details */}
        <section className="space-y-3">
          <h3 className="text-[13px] font-black text-[#13274d]">Bill Details</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Fld label="Purchase Date *"><Input className="h-10" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
            <Fld label="Purchase No."><Input className="h-10" placeholder="Auto if left blank" value={purchaseNo} onChange={(e) => setPurchaseNo(e.target.value)} /></Fld>
            <Fld label="Payment Mode *">
              <Select value={payMode} onValueChange={setPayMode}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </Fld>
            <Fld label="Due / Paid *">
              <Select value={payStatus} onValueChange={(v) => setPayStatus(v as typeof payStatus)}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid in Full</SelectItem>
                  <SelectItem value="partial">Partial Payment</SelectItem>
                  <SelectItem value="due">Full Credit (Unpaid)</SelectItem>
                </SelectContent>
              </Select>
            </Fld>
          </div>
          {payStatus === "partial" && (
            <Fld label="Paid Amount (₹)"><Input className="h-10" type="number" min="0" step="0.01" placeholder="3000" value={paidInput} onChange={(e) => setPaidInput(e.target.value)} /></Fld>
          )}
        </section>

        {/* Products */}
        <section className="app-table-scroll space-y-2 overflow-x-auto pb-1">
          <h3 className="text-[13px] font-black text-[#13274d]">Products</h3>
          <div className="grid min-w-[420px] grid-cols-[1fr_56px_76px_76px_24px] items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[#94a3b8]">
            <span>Product</span><span>Qty</span><span>Unit Cost</span><span className="text-right">Total</span><span />
          </div>
          {lines.map((line) => (
            <div key={line.key} className="grid min-w-[420px] grid-cols-[1fr_56px_76px_76px_24px] items-center gap-1.5">
              <Select value={line.productId} onValueChange={(v) => setLine(line.key, { productId: v })}>
                <SelectTrigger className="h-9 text-[12px]"><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input className="h-9 px-2 text-[12px]" type="number" min="0" placeholder="0" value={line.qty} onChange={(e) => setLine(line.key, { qty: e.target.value })} />
              <Input className="h-9 px-2 text-[12px]" type="number" min="0" step="0.01" placeholder="₹0" value={line.cost} onChange={(e) => setLine(line.key, { cost: e.target.value })} />
              <span className="truncate text-right text-[12px] font-bold text-[#102347]">{fmt(lineTotal(line))}</span>
              <button onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== line.key) : prev))} className="grid h-7 w-7 place-items-center rounded text-rose-400 hover:bg-rose-50" aria-label="Remove line"><Trash2 size={13} /></button>
            </div>
          ))}
          <div className="flex min-w-[420px] items-center justify-between pt-1">
            <button onClick={() => setLines((prev) => [...prev, { key: keyRef.current++, productId: "", qty: "", cost: "" }])} className="flex items-center gap-1 text-[12px] font-bold text-[#2563eb] hover:underline"><Plus size={13} /> Add Product</button>
            <Button variant="outline" className="h-8 gap-1.5 rounded-[8px] text-[11.5px] font-bold" onClick={() => toast({ title: "Barcode scanning coming soon", description: "Use the product dropdown for now." })}><Barcode size={13} /> Scan Barcode</Button>
          </div>

          {/* Totals strip */}
          <div className="grid grid-cols-2 gap-y-2 rounded-[10px] bg-[#f7f9fd] px-3.5 py-3 sm:grid-cols-4">
            <div><p className="text-[10px] font-semibold text-[#64748b]">Total Items</p><p className="text-[13px] font-black text-[#102347]">{totalItems.toLocaleString("en-IN")}</p></div>
            <div><p className="text-[10px] font-semibold text-[#64748b]">Total Amount</p><p className="text-[13px] font-black text-[#102347]">{fmt(totalAmount)}</p></div>
            <div><p className="text-[10px] font-semibold text-[#64748b]">Paid Amount</p><p className="text-[13px] font-black text-[#16a34a]">{fmt(paidAmount)}</p></div>
            <div><p className="text-[10px] font-semibold text-[#64748b]">Due Amount</p><p className="text-[13px] font-black text-[#ef4444]">{fmt(dueAmount)}</p></div>
          </div>
        </section>

        {/* Bill upload */}
        <section className="space-y-2">
          <h3 className="text-[13px] font-black text-[#13274d]">Bill Upload</h3>
          <label className="flex cursor-pointer flex-col items-center gap-1 rounded-[10px] border border-dashed border-[#c9d6ea] px-4 py-4 text-center hover:border-[#2563eb]">
            <Upload size={16} className="text-[#2563eb]" />
            <span className="text-[12px] font-bold text-[#2563eb]">Upload Bill / Invoice</span>
            <span className="text-[10.5px] text-[#94a3b8]">PNG, JPG or PDF up to 5MB · stored after cloud storage lands</span>
            <input type="file" accept=".png,.jpg,.jpeg,.pdf" className="hidden" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
          </label>
          {fileName && (
            <div className="flex items-center gap-2 rounded-[8px] border border-[#e7edf7] px-3 py-2">
              <FileText size={14} className="shrink-0 text-[#536583]" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#344668]">{fileName}</span>
              <button onClick={() => setFileName("")} className="text-[#94a3b8] hover:text-[#ef4444]" aria-label="Remove file"><X size={14} /></button>
            </div>
          )}
        </section>

        {/* Notes */}
        <section className="space-y-2">
          <h3 className="text-[13px] font-black text-[#13274d]">Notes <span className="font-semibold text-[#94a3b8]">(Optional)</span></h3>
          <textarea
            value={notes}
            maxLength={250}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Enter any notes about this purchase…"
            className="h-20 w-full resize-none rounded-[10px] border border-[#e2e8f0] px-3 py-2 text-[12.5px] text-[#102347] outline-none placeholder:text-[#9aa6bb] focus:border-[#2563eb]"
          />
          <p className="text-right text-[10px] text-[#94a3b8]">{notes.length}/250</p>
        </section>
      </div>

      <div className="shrink-0 border-t border-[#eef1f6] px-5 py-3.5">
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Button type="button" variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={saving} style={{ background: "linear-gradient(180deg,#0057ff 0%,#0047e8 100%)" }} className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95">
            {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><ClipboardList size={15} /> Save Purchase</>}
          </Button>
        </div>
      </div>
    </aside>
  );
}

function Kpi({ label, value, icon, iconBg, sub, subTone = "muted", delta, deltaSuffix, fallbackSub, loading }: {
  label: string; value: string; icon: React.ReactNode; iconBg: string;
  sub?: string; subTone?: "good" | "bad" | "muted"; delta?: number | null; deltaSuffix?: string; fallbackSub?: string; loading?: boolean;
}) {
  let line: React.ReactNode;
  if (delta != null) {
    line = <p className={cn("mt-1.5 text-[11px] font-bold", delta >= 0 ? "text-[#16a34a]" : "text-[#ef4444]")}>{delta >= 0 ? "↗" : "↓"} {Math.abs(delta)}% {deltaSuffix}</p>;
  } else if (sub) {
    const cls = subTone === "good" ? "text-[#16a34a]" : subTone === "bad" ? "text-[#ef4444]" : "text-[#94a3b8]";
    line = <p className={cn("mt-1.5 text-[11px] font-bold", cls)}>{sub}</p>;
  } else {
    line = <p className="mt-1.5 text-[11px] font-semibold text-[#94a3b8]">{fallbackSub ?? ""}</p>;
  }
  return (
    <div className="rounded-[14px] border border-[#e6ecf4] bg-white px-5 py-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11.5px] font-semibold leading-tight text-[#64748b]">{label}</p>
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[10px]", iconBg)}>{icon}</span>
      </div>
      <p className="truncate font-display text-[21px] font-black leading-none text-[#102347]">{loading ? "…" : value}</p>
      {line}
    </div>
  );
}

function Insight({ icon, iconBg, label, value, sub, subTone = "muted" }: { icon: React.ReactNode; iconBg: string; label: string; value: string; sub: string; subTone?: "good" | "bad" | "muted" }) {
  const cls = subTone === "good" ? "text-[#16a34a]" : subTone === "bad" ? "text-[#ef4444]" : "text-[#94a3b8]";
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", iconBg)}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[10.5px] font-semibold text-[#64748b]">{label}</p>
        <p className="truncate text-[13px] font-black text-[#102347]">{value}</p>
        <p className={cn("truncate text-[10.5px] font-bold", cls)}>{sub}</p>
      </div>
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

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{label}</Label>
      {children}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="py-6 text-center text-[12px] text-[#94a3b8]">{text}</p>;
}
