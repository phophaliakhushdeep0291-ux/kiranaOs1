import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, Crown, Loader2, Pencil, Plus, Search, Trash2, Truck, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FinancialAggregationService,
  type FinancialAggregationSnapshot,
  type SupplierDueRow,
} from "@/features/finance/services/FinancialAggregationService";
import { hydratePurchaseHistoryFromSyncPull } from "@/features/sync/cloud-hydration";
import { useAuth } from "@/features/auth/AuthContext";
import { deletePurchaseLocal, markPurchasePaidLocal, updatePurchaseLocal } from "@/features/purchases/local-actions";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function money(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function fmt(value: number | undefined | null) {
  return `₹${money(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function safeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "dd MMM yyyy");
}

const STATUS_CLS: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700",
  partial: "bg-amber-100 text-amber-700",
  due: "bg-rose-100 text-rose-700",
};
const MODE_CLS: Record<string, string> = {
  cash: "bg-emerald-50 text-emerald-700",
  upi: "bg-violet-50 text-violet-700",
  bank: "bg-[#eef5ff] text-[#0057ff]",
  credit: "bg-amber-50 text-amber-700",
};

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

export default function PurchaseBillsPage() {
  const [snapshot, setSnapshot] = useState<FinancialAggregationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
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

  const reloadSnapshot = useCallback(async () => {
    const next = await FinancialAggregationService.buildSnapshot().catch(() => null);
    setSnapshot(next);
    return next;
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
          setLoading(false);
          return;
        }
      }

      setSnapshot(next);
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
  }, [accessToken, authLoading, isAuthenticated]);

  const rows = snapshot?.supplierDueRows ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.supplierName, row.invoiceNumber, row.status, row.paymentMode]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    return rows.reduce(
      (sum, row) => {
        sum.amount += row.amount;
        sum.paid += row.paid;
        sum.due += row.due;
        return sum;
      },
      { amount: 0, paid: 0, due: 0 },
    );
  }, [rows]);

  const today = useMemo(() => {
    const key = new Date().toDateString();
    return rows.reduce(
      (sum, row) => {
        if (new Date(row.date).toDateString() === key) { sum.amount += row.amount; sum.count += 1; }
        return sum;
      },
      { amount: 0, count: 0 },
    );
  }, [rows]);

  const topSuppliers = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const row of rows) {
      const entry = map.get(row.supplierName) ?? { amount: 0, count: 0 };
      entry.amount += row.amount;
      entry.count += 1;
      map.set(row.supplierName, entry);
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v, share: totals.amount > 0 ? Math.round((v.amount / totals.amount) * 100) : 0 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [rows, totals.amount]);

  const recentRows = useMemo(
    () => [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5),
    [rows],
  );

  const dueAlerts = useMemo(
    () => rows.filter((row) => row.due > 0).sort((a, b) => b.due - a.due).slice(0, 5),
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

  return (
    <div className="min-h-full bg-[#f7f9fd] px-4 py-4">
      <div className="space-y-4">
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <Kpi icon={<ClipboardList size={16} />} iconBg="bg-[#eef5ff] text-[#0057ff]" label="Total Purchase Value" value={fmt(totals.amount)} sub={`${rows.length} purchase bill${rows.length === 1 ? "" : "s"}`} loading={loading} />
          <Kpi icon={<AlertTriangle size={16} />} iconBg="bg-rose-50 text-rose-600" label="Unpaid Purchase Dues" value={fmt(totals.due)} sub={totals.due > 0 ? `${dueAlerts.length}+ supplier${dueAlerts.length === 1 ? "" : "s"} to pay` : "All bills settled"} subTone={totals.due > 0 ? "bad" : "good"} loading={loading} />
          <Kpi icon={<CalendarDays size={16} />} iconBg="bg-violet-50 text-violet-600" label="Today's Purchases" value={fmt(today.amount)} sub={`${today.count} bill${today.count === 1 ? "" : "s"} today`} loading={loading} />
          <Kpi icon={<Wallet size={16} />} iconBg="bg-emerald-50 text-emerald-600" label="Paid to Suppliers" value={fmt(totals.paid)} sub="Cash, UPI & bank combined" loading={loading} />
        </div>

        {/* Insight strip */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Insight icon={<Crown size={14} />} label="Top Supplier" value={topSuppliers[0]?.name ?? "—"} sub={topSuppliers[0] ? `${fmt(topSuppliers[0].amount)} (${topSuppliers[0].share}%)` : "No purchases yet"} />
          <Insight icon={<ClipboardList size={14} />} label="Avg. Bill Value" value={rows.length ? fmt(totals.amount / rows.length) : "—"} sub={`across ${rows.length} bills`} />
          <Insight icon={<Truck size={14} />} label="Suppliers" value={String(new Set(rows.map((r) => r.supplierName)).size)} sub="with purchase history" />
          <Insight icon={<AlertTriangle size={14} />} label="Bills with Due" value={String(rows.filter((r) => r.due > 0).length)} sub={totals.due > 0 ? `${fmt(totals.due)} outstanding` : "nothing pending"} />
        </div>

        {/* Purchase bills table */}
        <div className="overflow-hidden rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
          <div className="flex flex-col gap-3 border-b border-[#eef2f8] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="font-display text-[14px] font-black tracking-tight text-[#102347]">Purchase Bills</h3>
            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                <Input className="h-9 pl-8 text-[12.5px]" placeholder="Search by bill no. or supplier…" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <Link href="/inventory">
                <Button style={{ background: "linear-gradient(180deg,#0057ff 0%,#0047e8 100%)" }} className="h-9 gap-1.5 rounded-[9px] font-bold text-white hover:opacity-95">
                  <Plus size={15} /> Add Purchase
                </Button>
              </Link>
            </div>
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[#eef5ff] text-[#0057ff]"><Truck size={22} /></span>
              <p className="text-[13px] font-bold text-[#102347]">No purchase bills yet</p>
              <p className="text-[12px] text-[#64748b]">Record a purchase from Inventory to start supplier due tracking.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[12.5px]">
                <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-bold">Purchase No.</th>
                    <th className="px-4 py-2.5 text-left font-bold">Supplier</th>
                    <th className="px-4 py-2.5 text-left font-bold">Date</th>
                    <th className="px-4 py-2.5 text-right font-bold">Total Amount</th>
                    <th className="px-4 py-2.5 text-right font-bold">Paid Amount</th>
                    <th className="px-4 py-2.5 text-right font-bold">Due Amount</th>
                    <th className="px-4 py-2.5 text-left font-bold">Payment Mode</th>
                    <th className="px-4 py-2.5 text-left font-bold">Status</th>
                    <th className="px-4 py-2.5 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, i) => {
                    const status = row.due > 0 ? row.status : "paid";
                    return (
                      <tr key={`${row.source}:${row.id}`} className={i < filtered.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                        <td className="px-4 py-3">
                          <p className="font-bold text-[#102347]">{row.invoiceNumber === "-" ? "Local purchase" : row.invoiceNumber}</p>
                          <p className="text-[10px] text-[#94a3b8]">{row.source === "purchase_bill" ? "Purchase bill" : "Inventory movement"}</p>
                        </td>
                        <td className="px-4 py-3 font-semibold text-[#344668]">{row.supplierName}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-[#52627e]">{safeDate(row.date)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-black text-[#102347]">{fmt(row.amount)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-[#344668]">{fmt(row.paid)}</td>
                        <td className={cn("whitespace-nowrap px-4 py-3 text-right font-bold", row.due > 0 ? "text-rose-600" : "text-emerald-600")}>{fmt(row.due)}</td>
                        <td className="px-4 py-3"><span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold capitalize", MODE_CLS[row.paymentMode] ?? "bg-[#eef2f8] text-[#64748b]")}>{row.paymentMode === "upi" ? "UPI" : row.paymentMode}</span></td>
                        <td className="px-4 py-3"><span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold capitalize", STATUS_CLS[status] ?? STATUS_CLS.due)}>{status}</span></td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <button title="Mark paid" aria-label="Mark purchase paid" disabled={row.due <= 0 || saving} onClick={() => openPay(row)}
                              className="grid h-7 w-7 place-items-center rounded-[7px] text-emerald-600 hover:bg-emerald-50 disabled:opacity-30 disabled:hover:bg-transparent"><CheckCircle2 size={14} /></button>
                            <button title="Edit purchase" aria-label="Edit purchase" disabled={saving} onClick={() => openEdit(row)}
                              className="grid h-7 w-7 place-items-center rounded-[7px] text-[#536583] hover:bg-[#eef2f8]"><Pencil size={13} /></button>
                            <button title="Delete purchase" aria-label="Delete purchase" disabled={saving} onClick={() => setDeletingRow(row)}
                              className="grid h-7 w-7 place-items-center rounded-[7px] text-rose-500 hover:bg-rose-50"><Trash2 size={13} /></button>
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

        {/* Bottom insight row */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Top suppliers */}
          <BottomCard icon={<Crown size={15} />} title="Top Suppliers">
            {topSuppliers.length === 0 ? <EmptyHint text="No suppliers yet." /> : topSuppliers.map((s, i) => (
              <div key={s.name} className={cn("flex items-center gap-3 py-2.5", i < topSuppliers.length - 1 && "border-b border-[#eef2f8]")}>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#eef5ff] text-[11px] font-black text-[#0057ff]">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-bold text-[#102347]">{s.name}</p>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#eef2f8]"><div className="h-full rounded-full bg-[#0057ff]" style={{ width: `${Math.max(6, s.share)}%` }} /></div>
                </div>
                <span className="shrink-0 text-[11.5px] font-bold text-[#344668]">{fmt(s.amount)} <span className="text-[10px] font-semibold text-[#94a3b8]">({s.share}%)</span></span>
              </div>
            ))}
          </BottomCard>

          {/* Recent activity */}
          <BottomCard icon={<ClipboardList size={15} />} title="Recent Purchase Activity">
            {recentRows.length === 0 ? <EmptyHint text="No purchases recorded yet." /> : recentRows.map((row, i) => (
              <div key={`${row.source}:${row.id}`} className={cn("flex items-center gap-3 py-2.5", i < recentRows.length - 1 && "border-b border-[#eef2f8]")}>
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", row.due > 0 ? "bg-amber-500" : "bg-emerald-500")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-bold text-[#102347]">{row.invoiceNumber === "-" ? "Local purchase" : row.invoiceNumber} <span className="font-medium text-[#64748b]">from {row.supplierName}</span></p>
                  <p className="text-[10.5px] text-[#94a3b8]">{fmt(row.amount)} · {row.due > 0 ? row.status : "paid"} · {safeDate(row.date)}</p>
                </div>
              </div>
            ))}
          </BottomCard>

          {/* Due alerts */}
          <BottomCard icon={<AlertTriangle size={15} />} title="Purchase Due Alerts" tone="rose">
            {dueAlerts.length === 0 ? <EmptyHint text="No supplier dues — all settled. 🎉" /> : (
              <>
                {dueAlerts.map((row, i) => (
                  <div key={`${row.source}:${row.id}`} className={cn("flex items-center gap-3 py-2.5", i < dueAlerts.length - 1 && "border-b border-rose-100/70")}>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-rose-50 text-rose-500"><AlertTriangle size={13} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-bold text-[#102347]">{row.supplierName}</p>
                      <p className="text-[10.5px] text-[#94a3b8]">{row.invoiceNumber === "-" ? "Local purchase" : row.invoiceNumber}</p>
                    </div>
                    <span className="shrink-0 text-[12.5px] font-black text-rose-600">{fmt(row.due)}</span>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between border-t border-rose-100 pt-2.5">
                  <span className="text-[12px] font-bold text-[#344668]">Total Overdue</span>
                  <span className="text-[13px] font-black text-rose-600">{fmt(totals.due)}</span>
                </div>
              </>
            )}
          </BottomCard>
        </div>
      </div>

      <Dialog open={Boolean(editingRow)} onOpenChange={(open) => !open && setEditingRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit purchase</DialogTitle>
            <DialogDescription>Update supplier bill details and payment status.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>Supplier</Label>
              <Input
                className="mt-1"
                value={purchaseForm.supplierName}
                onChange={(event) => setPurchaseForm((current) => ({ ...current, supplierName: event.target.value }))}
              />
            </div>
            <div>
              <Label>Bill number</Label>
              <Input
                className="mt-1"
                value={purchaseForm.invoiceNumber}
                onChange={(event) => setPurchaseForm((current) => ({ ...current, invoiceNumber: event.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="mt-1"
                  value={purchaseForm.amount}
                  onChange={(event) => setPurchaseForm((current) => ({ ...current, amount: event.target.value }))}
                />
              </div>
              <div>
                <Label>Paid</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="mt-1"
                  value={purchaseForm.paid}
                  onChange={(event) => setPurchaseForm((current) => ({ ...current, paid: event.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Payment mode</Label>
              <Select value={purchaseForm.paymentMode} onValueChange={(value) => setPurchaseForm((current) => ({ ...current, paymentMode: value }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
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
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
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

function Kpi({ icon, iconBg, label, value, sub, subTone = "muted", loading }: { icon: React.ReactNode; iconBg: string; label: string; value: string; sub: string; subTone?: "good" | "bad" | "muted"; loading?: boolean }) {
  const subClass = subTone === "good" ? "text-emerald-600" : subTone === "bad" ? "text-rose-500" : "text-[#94a3b8]";
  return (
    <div className="rounded-[14px] border border-[#e6ecf4] bg-white px-5 py-4 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="flex items-center gap-2.5">
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[10px]", iconBg)}>{icon}</span>
        <p className="text-[11.5px] font-semibold text-[#64748b]">{label}</p>
      </div>
      <p className="mt-2 truncate font-display text-[22px] font-black leading-none text-[#102347]">{loading ? "…" : value}</p>
      <p className={cn("mt-1.5 text-[11px] font-bold", subClass)}>{sub}</p>
    </div>
  );
}

function Insight({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-[#e6ecf4] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#f4f7fb] text-[#536583]">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10.5px] font-semibold text-[#64748b]">{label}</p>
        <p className="truncate text-[13px] font-black text-[#102347]">{value} <span className="text-[10.5px] font-semibold text-[#94a3b8]">{sub}</span></p>
      </div>
    </div>
  );
}

function BottomCard({ icon, title, tone, children }: { icon: React.ReactNode; title: string; tone?: "rose"; children: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-[#e6ecf4] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">
      <div className="flex items-center gap-2 border-b border-[#eef2f8] px-5 py-3">
        <span className={cn("grid h-7 w-7 place-items-center rounded-[8px]", tone === "rose" ? "bg-rose-50 text-rose-500" : "bg-[#eef5ff] text-[#0057ff]")}>{icon}</span>
        <h3 className="font-display text-[13.5px] font-black tracking-tight text-[#102347]">{title}</h3>
      </div>
      <div className="px-5 py-2.5">{children}</div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="py-6 text-center text-[12px] text-[#94a3b8]">{text}</p>;
}
