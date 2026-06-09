import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { ArrowLeft, CheckCircle2, ClipboardList, Pencil, Plus, Search, Trash2, Truck, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTableCard, EmptyState, MoneyBadge, PageHeader, PageShell, StatCard, StatsGrid } from "@/components/shared";
import {
  FinancialAggregationService,
  type FinancialAggregationSnapshot,
  type SupplierDueRow,
} from "@/features/finance/services/FinancialAggregationService";
import { hydratePurchaseHistoryFromSyncPull } from "@/features/sync/cloud-hydration";
import { useAuth } from "@/features/auth/AuthContext";
import { deletePurchaseLocal, markPurchasePaidLocal, updatePurchaseLocal } from "@/features/purchases/local-actions";
import { useToast } from "@/hooks/use-toast";

function money(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function fmt(value: number | undefined | null) {
  return `Rs ${money(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function safeDate(value: string) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "Date not set";
  return format(date, "d MMM yyyy");
}

function statusVariant(row: SupplierDueRow) {
  if (row.due > 0 && row.paid > 0) return "outline" as const;
  if (row.due > 0) return "destructive" as const;
  return "secondary" as const;
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
    <PageShell>
      <PageHeader
        title="Purchase Bills"
        description="Supplier dues, paid purchases, and inventory purchase bill history."
        eyebrow={<Badge variant="secondary">Local-first finance</Badge>}
        actions={(
          <>
            <Link href="/dashboard">
              <Button variant="outline">
                <ArrowLeft size={16} aria-hidden="true" />
                Dashboard
              </Button>
            </Link>
            <Link href="/inventory">
              <Button>
                <Plus size={16} aria-hidden="true" />
                Add purchase
              </Button>
            </Link>
          </>
        )}
      />

      <StatsGrid columns={3} className="mb-6">
        <StatCard label="Total Purchases" value={fmt(totals.amount)} description={`${rows.length} purchase rows`} icon={<ClipboardList size={20} aria-hidden="true" />} loading={loading} />
        <StatCard label="Paid" value={fmt(totals.paid)} description="Cash, UPI, or bank paid to suppliers" icon={<Wallet size={20} aria-hidden="true" />} loading={loading} tone="green" />
        <StatCard label="Supplier Due" value={fmt(totals.due)} description="Pending purchase bill amount" icon={<Truck size={20} aria-hidden="true" />} loading={loading} tone={totals.due > 0 ? "red" : "green"} />
      </StatsGrid>

      <DataTableCard
        title="Supplier purchase ledger"
        description="Rows are built from purchase bills and inventory purchase movements."
        loading={loading}
        empty={!loading && filtered.length === 0}
        emptyState={<EmptyState title="No purchase bills yet" description="Record a purchase from Inventory to start supplier due tracking." />}
        actions={(
          <div className="relative w-full sm:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-9" placeholder="Search supplier or bill" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        )}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Bill</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Due</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={`${row.source}:${row.id}`} className="border-b last:border-0">
                  <td className="px-3 py-3">
                    <p className="font-semibold">{row.invoiceNumber === "-" ? "Local purchase" : row.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">{row.source === "purchase_bill" ? "Purchase bill" : "Inventory movement"}</p>
                  </td>
                  <td className="px-3 py-3">{row.supplierName}</td>
                  <td className="px-3 py-3 text-muted-foreground">{safeDate(row.date)}</td>
                  <td className="px-3 py-3 text-right font-medium">{fmt(row.amount)}</td>
                  <td className="px-3 py-3 text-right">{fmt(row.paid)}</td>
                  <td className="px-3 py-3 text-right">
                    <MoneyBadge amount={row.due} tone={row.due > 0 ? "danger" : "success"} compact />
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant={statusVariant(row)}>{row.due > 0 ? row.status : "paid"}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="Mark paid"
                        aria-label="Mark purchase paid"
                        disabled={row.due <= 0 || saving}
                        onClick={() => openPay(row)}
                      >
                        <CheckCircle2 size={15} aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="Edit purchase"
                        aria-label="Edit purchase"
                        disabled={saving}
                        onClick={() => openEdit(row)}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        title="Delete purchase"
                        aria-label="Delete purchase"
                        disabled={saving}
                        onClick={() => setDeletingRow(row)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataTableCard>

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
    </PageShell>
  );
}
