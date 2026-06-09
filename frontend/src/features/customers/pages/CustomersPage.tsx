import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeIndianRupee, CalendarClock, ChevronRight, CreditCard, Plus, Search, ShieldAlert, Star, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { createCustomerLocalFirst, deleteCustomerLocalFirst, updateCustomerLocalFirst } from "@/features/customers/local-actions";
import { recordPaymentLocalFirst } from "@/features/payments/local-actions";
import { loadCustomersWithLedger, formatMoney, formatShortDate, type CustomerWithLedger } from "@/features/customers/customer-ledger-data";
import type { CustomerInput } from "@/types/api";
import { FilterBar, MoneyBadge, PageHeader, PageShell, SearchInputWithIcon, StatCard, StatsGrid } from "@/components/shared";

interface CustomerFormState {
  name: string;
  mobile: string;
  address: string;
  type: "regular" | "udhar";
  dueDate: string;
  promiseToPayDate: string;
  udharLimit: string;
  notes: string;
}

interface PaymentFormState {
  customerId: string;
  amount: string;
  mode: "cash" | "upi";
  note: string;
}

function blankCustomerForm(): CustomerFormState {
  return { name: "", mobile: "", address: "", type: "regular", dueDate: "", promiseToPayDate: "", udharLimit: "", notes: "" };
}

function useCustomersLedgerList() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["customers-ledger-list"] });
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [queryClient]);
  return useQuery({ queryKey: ["customers-ledger-list"], queryFn: loadCustomersWithLedger, staleTime: 1_500 });
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

function trustBadge(customer: CustomerWithLedger) {
  const score = customer.ledgerMetrics.trustScore;
  if (score >= 75) return <Badge variant="outline" className="text-emerald-600"><Star size={12} className="mr-1" />Trusted {score}</Badge>;
  if (score >= 45) return <Badge variant="secondary">Watch {score}</Badge>;
  return <Badge variant="destructive"><ShieldAlert size={12} className="mr-1" />Risk {score}</Badge>;
}

export default function CustomersPage() {
  const { toast } = useToast();
  const { data: customers = [], isLoading, refetch } = useCustomersLedgerList();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "udhar" | "bad" | "due" | "promise">("all");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerWithLedger | null>(null);
  const [customerForm, setCustomerForm] = useState<CustomerFormState>(blankCustomerForm());
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>({ customerId: "", amount: "", mode: "cash", note: "" });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomerWithLedger | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const dedupedCustomers = useMemo(() => {
    const map = new Map<string, CustomerWithLedger>();
    for (const customer of customers) {
      if (customer.deletedAt || (customer as { deleted_at?: unknown }).deleted_at) continue;
      const key = customerDedupeKey(customer);
      const existing = map.get(key);
      map.set(key, existing ? chooseBestCustomer(existing, customer) : customer);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [customers]);

  const totals = useMemo(() => {
    const totalUdhar = dedupedCustomers.reduce((sum, customer) => sum + Math.max(0, customer.ledgerBalance), 0);
    return {
      customers: dedupedCustomers.length,
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
        filter === "due" ? Boolean(customer.dueDate) :
        filter === "promise" ? Boolean(customer.promiseToPayDate) : true;
      return matchesSearch && matchesFilter;
    });
  }, [dedupedCustomers, filter, search]);

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
        type: draft.type === "udhar" || existing?.type === "udhar" ? "udhar" : "regular",
        dueDate: draft.dueDate ?? existing?.dueDate ?? "",
        promiseToPayDate: draft.promiseToPayDate ?? existing?.promiseToPayDate ?? "",
        udharLimit: draft.udharLimit !== undefined ? String(draft.udharLimit) : typeof existing?.udharLimit === "number" ? String(existing.udharLimit) : "",
        notes: draft.notes ?? existing?.notes ?? "",
      });
      setCustomerOpen(true);
      toast({ title: existing ? "Customer edit prepared" : "Customer draft prepared", description: "Voice assistant filled the form. Review and save locally." });
    };
    window.addEventListener("kirana:voice-customer-draft", handler);
    return () => window.removeEventListener("kirana:voice-customer-draft", handler);
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
      type: customer.type === "udhar" ? "udhar" : "regular",
      dueDate: customer.dueDate ?? "",
      promiseToPayDate: customer.promiseToPayDate ?? "",
      udharLimit: typeof customer.udharLimit === "number" ? String(customer.udharLimit) : "",
      notes: customer.notes ?? "",
    });
    setCustomerOpen(true);
  }

  function openPayment(customer?: CustomerWithLedger) {
    setPaymentForm({ customerId: customer?.id ?? "", amount: "", mode: "cash", note: "" });
    setPaymentOpen(true);
  }

  async function saveCustomer() {
    if (!customerForm.name.trim()) {
      toast({ title: "Customer name required", variant: "destructive" });
      return;
    }
    if (!customerForm.mobile.trim()) {
      toast({ title: "Mobile/number required", description: "Use phone, shop number, or local identity number.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const data: CustomerInput = {
        name: customerForm.name.trim(),
        mobile: customerForm.mobile.trim(),
        address: customerForm.address.trim() || undefined,
        type: customerForm.type,
        dueDate: customerForm.dueDate || undefined,
        promiseToPayDate: customerForm.promiseToPayDate || undefined,
        udharLimit: customerForm.udharLimit ? Number(customerForm.udharLimit) : undefined,
        notes: customerForm.notes.trim() || undefined,
      };
      if (editing) await updateCustomerLocalFirst(editing.id, data);
      else await createCustomerLocalFirst(data);
      toast({ title: editing ? "Customer updated" : "Customer added", description: "Data safe locally. Cloud backup will happen during sync." });
      setCustomerOpen(false);
      await refetch();
    } catch (error) {
      toast({ title: "Could not save customer", description: error instanceof Error ? error.message : "Please check details.", variant: "destructive" });
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
      toast({ title: "Customer moved to recycle bin", description: "This is a soft delete. Ledger and bills are not hard deleted." });
      setDeleteTarget(null);
      await refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Try again.";
      setDeleteError(message);
      toast({ title: "Could not delete customer", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function recordPayment() {
    const amount = Number(paymentForm.amount);
    if (!paymentForm.customerId || !Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Select customer and amount", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await recordPaymentLocalFirst(paymentForm.customerId, { amount, mode: paymentForm.mode, note: paymentForm.note.trim() || undefined });
      toast({ title: "Payment recorded", description: "Ledger updated locally. Sync will upload this safely." });
      setPaymentOpen(false);
      await refetch();
    } catch (error) {
      toast({ title: "Payment failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Customers"
        description="Customer records, udhar balance, trust score, due dates, and payment history."
        actions={(
          <>
            <Button variant="outline" onClick={() => openPayment()}><CreditCard size={15} className="mr-1" />Record payment</Button>
            <Button onClick={openCreate}><Plus size={15} className="mr-1" />Add customer</Button>
          </>
        )}
      />

      <StatsGrid>
        <StatCard label="Customers" value={totals.customers} />
        <StatCard label="Total udhar" value={<MoneyBadge amount={totals.totalUdhar} tone="danger" />} tone="red" />
        <StatCard label="Bad customer warning" value={totals.bad} tone="amber" />
        <StatCard label="Due / promise set" value={totals.dueSoon} tone="blue" />
      </StatsGrid>

      <FilterBar actions={<Button className="h-11" variant="outline" onClick={() => void refetch()}>Refresh</Button>}>
        <SearchInputWithIcon label="Search customers" className="h-11" placeholder="Search customer by name, mobile, address..." value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
          <SelectTrigger className="h-11 w-full sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All customers</SelectItem>
            <SelectItem value="udhar">Udhar customers</SelectItem>
            <SelectItem value="bad">Bad customer warning</SelectItem>
            <SelectItem value="due">Due date set</SelectItem>
            <SelectItem value="promise">Promise-to-pay set</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      <Card>
        <CardHeader><CardTitle className="text-base">{filteredCustomers.length} customers found</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? <div className="text-sm text-muted-foreground">Loading customers from local database...</div> : null}
          {!isLoading && filteredCustomers.length === 0 ? <div className="py-8 text-center text-muted-foreground">No customers found.</div> : null}
          {filteredCustomers.map((customer) => (
            <div key={customer.id} className="rounded-xl border p-4 hover:bg-muted/30">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold truncate">{customer.name}</h3>
                    {customer.ledgerBalance > 0 ? <Badge variant="destructive">Udhar {formatMoney(customer.ledgerBalance)}</Badge> : <Badge variant="outline">No udhar</Badge>}
                    {trustBadge(customer)}
                    {customer.ledgerMetrics.warning ? <Badge variant="destructive"><AlertTriangle size={12} className="mr-1" />Warning</Badge> : null}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                    <span><Users size={13} className="inline mr-1" />{customer.mobile || "No phone"}</span>
                    <span>{customer.address || "No address"}</span>
                    <span><CalendarClock size={13} className="inline mr-1" />Due: {formatShortDate(customer.dueDate)}</span>
                    <span>Promise: {formatShortDate(customer.promiseToPayDate)}</span>
                    {typeof customer.udharLimit === "number" ? <span>Limit: {formatMoney(customer.udharLimit)}</span> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openPayment(customer)}><BadgeIndianRupee size={14} className="mr-1" />Pay</Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(customer)}>Edit</Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => requestDeleteCustomer(customer)} disabled={saving}><Trash2 size={14} className="mr-1" />Delete</Button>
                  <Link href={`/customers/${customer.id}`}><Button size="sm"><ChevronRight size={14} className="mr-1" />Open</Button></Link>
                </div>
              </div>
              {customer.ledgerMetrics.warning ? <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{customer.ledgerMetrics.warning}</p> : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={customerOpen} onOpenChange={setCustomerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit customer" : "Add customer"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div><Label>Name *</Label><Input className="mt-1" value={customerForm.name} onChange={(event) => setCustomerForm((form) => ({ ...form, name: event.target.value }))} /></div>
            <div><Label>Phone / number *</Label><Input className="mt-1" value={customerForm.mobile} onChange={(event) => setCustomerForm((form) => ({ ...form, mobile: event.target.value }))} /></div>
            <div className="md:col-span-2"><Label>Address</Label><Input className="mt-1" value={customerForm.address} onChange={(event) => setCustomerForm((form) => ({ ...form, address: event.target.value }))} /></div>
            <div><Label>Customer type</Label><Select value={customerForm.type} onValueChange={(value) => setCustomerForm((form) => ({ ...form, type: value as "regular" | "udhar" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="regular">Regular</SelectItem><SelectItem value="udhar">Udhar allowed</SelectItem></SelectContent></Select></div>
            <div><Label>Udhar limit</Label><Input type="number" className="mt-1" value={customerForm.udharLimit} onChange={(event) => setCustomerForm((form) => ({ ...form, udharLimit: event.target.value }))} /></div>
            <div><Label>Due date</Label><Input type="date" className="mt-1" value={customerForm.dueDate} onChange={(event) => setCustomerForm((form) => ({ ...form, dueDate: event.target.value }))} /></div>
            <div><Label>Promise-to-pay date</Label><Input type="date" className="mt-1" value={customerForm.promiseToPayDate} onChange={(event) => setCustomerForm((form) => ({ ...form, promiseToPayDate: event.target.value }))} /></div>
            <div className="md:col-span-2"><Label>Notes / pricing rule</Label><Textarea className="mt-1" value={customerForm.notes} onChange={(event) => setCustomerForm((form) => ({ ...form, notes: event.target.value }))} placeholder="Example: gives wholesale price for 10kg+" /></div>
          </div>
          <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setCustomerOpen(false)}>Cancel</Button><Button onClick={() => void saveCustomer()} disabled={saving}>{saving ? "Saving..." : "Save locally"}</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record customer payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Customer *</Label><Select value={paymentForm.customerId} onValueChange={(value) => setPaymentForm((form) => ({ ...form, customerId: value }))}><SelectTrigger className="mt-1"><SelectValue placeholder="Select customer" /></SelectTrigger><SelectContent>{dedupedCustomers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.name} • {formatMoney(customer.ledgerBalance)}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Amount *</Label><Input type="number" className="mt-1" value={paymentForm.amount} onChange={(event) => setPaymentForm((form) => ({ ...form, amount: event.target.value }))} /></div>
            <div><Label>Mode</Label><Select value={paymentForm.mode} onValueChange={(value) => setPaymentForm((form) => ({ ...form, mode: value as "cash" | "upi" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI</SelectItem></SelectContent></Select></div>
            <div><Label>Note</Label><Input className="mt-1" value={paymentForm.note} onChange={(event) => setPaymentForm((form) => ({ ...form, note: event.target.value }))} placeholder="Optional" /></div>
          </div>
          <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button onClick={() => void recordPayment()} disabled={saving}>{saving ? "Saving..." : "Record offline"}</Button></div>
        </DialogContent>
      </Dialog>

      <OwnerPinModal
        open={Boolean(deleteTarget)}
        title="Owner PIN required"
        description={`Delete ${deleteTarget?.name ?? "this customer"}? This only moves the customer to recycle bin. Bills, ledger, and payments stay safe.`}
        confirmLabel="Move to recycle bin"
        reasonRequired
        loading={saving}
        error={deleteError}
        onCancel={() => { if (!saving) setDeleteTarget(null); }}
        onConfirm={({ ownerPin, reason }) => void confirmDeleteCustomer(ownerPin, reason)}
      />
    </PageShell>
  );
}
