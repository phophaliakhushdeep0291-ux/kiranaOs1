import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CreditCard, MessageCircle, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { loadCustomersWithLedger, formatDateTime, formatMoney, formatShortDate, type CustomerWithLedger } from "@/features/customers/customer-ledger-data";
import { buildLedgerStatement, dedupeLedgerEntries, ledgerEntryLabel, normaliseLedgerType, type CustomerLedgerEntry } from "@/features/ledger/accounting";
import { recordPaymentLocalFirst, reversePaymentWithOwnerPinLocalFirst } from "@/features/payments/local-actions";
import { offlineDB } from "@/lib/offline/db";
import { FeatureGate, UpgradePrompt } from "@/features/subscription";
import { usePermission } from "@/features/staff/permissions";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { DataTableCard, EmptyState, FilterBar, MoneyBadge, PageHeader, PageShell, SearchInputWithIcon, StatCard, StatsGrid } from "@/components/shared";

interface PaymentFormState { customerId: string; amount: string; mode: "cash" | "upi"; note: string }
interface ReverseFormState { paymentId: string }

async function loadUdharDashboard() {
  const customers = await loadCustomersWithLedger();
  const ledgerRaw = await offlineDB.getAll<CustomerLedgerEntry>("customer_ledger").catch(() => []);
  const payments = await offlineDB.getAll<Record<string, unknown>>("payments").catch(() => []);
  const ledger = buildLedgerStatement(dedupeLedgerEntries(ledgerRaw));
  return { customers, ledger, payments };
}

function useUdharDashboard() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["udhar-dashboard"] });
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [queryClient]);
  return useQuery({ queryKey: ["udhar-dashboard"], queryFn: loadUdharDashboard, staleTime: 1_500 });
}

function readNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

export default function UdharPage() {
  const { toast } = useToast();
  const reversePaymentPermission = usePermission("reverse_payment");
  const { data, isLoading, refetch } = useUdharDashboard();
  const customers = data?.customers ?? [];
  const ledger = data?.ledger ?? [];
  const payments = data?.payments ?? [];
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "0-7" | "7-30" | "30+" | "bad">("all");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [payment, setPayment] = useState<PaymentFormState>({ customerId: "", amount: "", mode: "cash", note: "" });
  const [reverse, setReverse] = useState<ReverseFormState>({ paymentId: "" });
  const [saving, setSaving] = useState(false);

  const udharCustomers = useMemo(() => customers.filter((customer) => customer.ledgerBalance > 0), [customers]);
  const totals = useMemo(() => udharCustomers.reduce((acc, customer) => {
    acc.total += customer.ledgerBalance;
    acc.zeroToSeven += customer.ledgerMetrics.ageing.zeroToSeven;
    acc.sevenToThirty += customer.ledgerMetrics.ageing.sevenToThirty;
    acc.thirtyPlus += customer.ledgerMetrics.ageing.thirtyPlus;
    if (customer.ledgerMetrics.isBadCustomer) acc.bad += 1;
    return acc;
  }, { total: 0, zeroToSeven: 0, sevenToThirty: 0, thirtyPlus: 0, bad: 0 }), [udharCustomers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return udharCustomers.filter((customer) => {
      const matchesSearch = !q || customer.name.toLowerCase().includes(q) || String(customer.mobile ?? "").includes(q);
      const matchesFilter =
        filter === "all" ? true :
        filter === "0-7" ? customer.ledgerMetrics.ageing.zeroToSeven > 0 :
        filter === "7-30" ? customer.ledgerMetrics.ageing.sevenToThirty > 0 :
        filter === "30+" ? customer.ledgerMetrics.ageing.thirtyPlus > 0 :
        filter === "bad" ? customer.ledgerMetrics.isBadCustomer : true;
      return matchesSearch && matchesFilter;
    });
  }, [filter, search, udharCustomers]);

  function openPayment(customer?: CustomerWithLedger) {
    setPayment({ customerId: customer?.id ?? "", amount: "", mode: "cash", note: "" });
    setPaymentOpen(true);
  }

  async function savePayment() {
    const amount = Number(payment.amount);
    if (!payment.customerId || !Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Select customer and valid amount", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await recordPaymentLocalFirst(payment.customerId, { amount, mode: payment.mode, note: payment.note.trim() || undefined });
      toast({ title: "Payment recorded", description: "Ledger updated locally. Cloud sync will retry safely." });
      setPaymentOpen(false);
      await refetch();
    } catch (error) {
      toast({ title: "Payment failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function saveReverse(ownerPin: string, reason: string) {
    setSaving(true);
    try {
      await reversePaymentWithOwnerPinLocalFirst({ paymentId: reverse.paymentId, ownerPin, reason });
      toast({ title: "Payment reversed", description: "Correction entry added. Original payment is preserved." });
      setReverseOpen(false);
      setReverse({ paymentId: "" });
      await refetch();
    } catch (error) {
      toast({ title: "Reversal failed", description: error instanceof Error ? error.message : "Check owner PIN.", variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Udhar / Customer Ledger"
        description="Append-only customer ledger, ageing, payments, corrections, and reminders."
        actions={(
          <>
            <FeatureGate featureName="whatsapp_reminders" fallback={<UpgradePrompt compact featureName="whatsapp_reminders" description="Automated WhatsApp reminders require Pro." />}>
              <Button variant="outline" onClick={() => toast({ title: "Reminder ready", description: "Connect WhatsApp provider to send automated reminders." })}><MessageCircle size={15} className="mr-1" />WhatsApp reminders</Button>
            </FeatureGate>
            <Button onClick={() => openPayment()}><CreditCard size={15} className="mr-1" />Record payment</Button>
          </>
        )}
      />

      <StatsGrid columns={5}>
        <StatCard label="Total udhar" value={<MoneyBadge amount={totals.total} tone="danger" />} tone="red" />
        <StatCard label="0–7 days" value={formatMoney(totals.zeroToSeven)} />
        <StatCard label="7–30 days" value={formatMoney(totals.sevenToThirty)} tone="amber" />
        <StatCard label="30+ days" value={formatMoney(totals.thirtyPlus)} tone="red" />
        <StatCard label="Bad warnings" value={totals.bad} tone="amber" />
      </StatsGrid>

      <FilterBar actions={<Button className="h-11" variant="outline" onClick={() => void refetch()}>Refresh</Button>}>
        <SearchInputWithIcon label="Search udhar customers" className="h-11" placeholder="Search udhar customer by name or mobile..." value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
          <SelectTrigger className="h-11 w-full sm:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All udhar</SelectItem>
            <SelectItem value="0-7">0–7 days</SelectItem>
            <SelectItem value="7-30">7–30 days</SelectItem>
            <SelectItem value="30+">30+ days</SelectItem>
            <SelectItem value="bad">Bad warning</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle>Customers with udhar</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? <p className="text-sm text-muted-foreground">Loading local ledger...</p> : null}
            {!isLoading && filtered.length === 0 ? <p className="text-center py-8 text-muted-foreground">No udhar customers found.</p> : null}
            {filtered.map((customer) => <div key={customer.id} className="rounded-xl border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><Link href={`/customers/${customer.id}`}><span className="font-semibold hover:underline cursor-pointer">{customer.name}</span></Link><Badge variant="destructive">{formatMoney(customer.ledgerBalance)}</Badge>{customer.ledgerMetrics.isBadCustomer ? <Badge variant="destructive"><AlertTriangle size={12} className="mr-1" />Warning</Badge> : <Badge variant="outline">Trust {customer.ledgerMetrics.trustScore}</Badge>}</div>
                  <p className="text-sm text-muted-foreground mt-1">{customer.mobile || "No phone"} • Due {formatShortDate(customer.dueDate)} • Promise {formatShortDate(customer.promiseToPayDate)}</p>
                  <p className="text-xs text-muted-foreground mt-1">0–7: {formatMoney(customer.ledgerMetrics.ageing.zeroToSeven)} • 7–30: {formatMoney(customer.ledgerMetrics.ageing.sevenToThirty)} • 30+: {formatMoney(customer.ledgerMetrics.ageing.thirtyPlus)}</p>
                </div>
                <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openPayment(customer)}>Pay</Button><Link href={`/customers/${customer.id}`}><Button size="sm">Ledger</Button></Link></div>
              </div>
              {customer.ledgerMetrics.warning ? <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{customer.ledgerMetrics.warning}</p> : null}
            </div>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Payment history / ledger feed</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[640px] overflow-auto">
            {ledger.slice(0, 80).map((entry) => {
              const type = normaliseLedgerType(entry.type, entry.source_type);
              const customer = customers.find((row) => row.id === entry.customerId || row.id === entry.customer_id);
              const linkedPayment = payments.find((paymentRow) => String(paymentRow.id) === String(entry.paymentId ?? entry.payment_id ?? entry.source_id));
              return <div key={entry.id} className="rounded-lg border p-3">
                <div className="flex justify-between gap-3">
                  <div><p className="font-medium">{customer?.name ?? "Customer"} • {ledgerEntryLabel(type)}</p><p className="text-xs text-muted-foreground">{formatDateTime(entry.display_date)} {entry.note ? `• ${entry.note}` : ""}</p></div>
                  <div className="text-right"><p className={`font-bold ${entry.signed_amount < 0 ? "text-emerald-600" : "text-destructive"}`}>{entry.signed_amount < 0 ? "-" : "+"}{formatMoney(Math.abs(entry.signed_amount))}</p><p className="text-xs text-muted-foreground">Bal {formatMoney(entry.running_balance)}</p></div>
                </div>
                {type === "PAYMENT" && linkedPayment && !linkedPayment.reversed_at && !linkedPayment.reversedAt ? <Button size="sm" variant="outline" className="mt-2" onClick={() => { if (!reversePaymentPermission.allowed) { toast({ title: "Permission denied", description: reversePaymentPermission.reason, variant: "destructive" }); return; } setReverse({ paymentId: String(linkedPayment.id) }); setReverseOpen(true); }}><RotateCcw size={13} className="mr-1" />Reverse with PIN</Button> : null}
              </div>;
            })}
            {ledger.length === 0 ? <p className="text-center py-8 text-muted-foreground">No ledger entries yet.</p> : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Record udhar payment</DialogTitle></DialogHeader><div className="space-y-4"><div><Label>Customer *</Label><Select value={payment.customerId} onValueChange={(value) => setPayment((form) => ({ ...form, customerId: value }))}><SelectTrigger className="mt-1"><SelectValue placeholder="Select customer" /></SelectTrigger><SelectContent>{customers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.name} • {formatMoney(customer.ledgerBalance)}</SelectItem>)}</SelectContent></Select></div><div><Label>Amount *</Label><Input type="number" className="mt-1" value={payment.amount} onChange={(event) => setPayment((form) => ({ ...form, amount: event.target.value }))} /></div><div><Label>Mode</Label><Select value={payment.mode} onValueChange={(value) => setPayment((form) => ({ ...form, mode: value as "cash" | "upi" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI</SelectItem></SelectContent></Select></div><div><Label>Note</Label><Input className="mt-1" value={payment.note} onChange={(event) => setPayment((form) => ({ ...form, note: event.target.value }))} /></div></div><div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void savePayment()}>{saving ? "Saving..." : "Save offline"}</Button></div></DialogContent></Dialog>
      <OwnerPinModal
        open={reverseOpen}
        title="Reverse payment"
        description="Owner PIN is required. The old payment is preserved and a correction ledger entry is appended."
        confirmLabel="Reverse payment"
        reasonRequired
        loading={saving}
        onCancel={() => setReverseOpen(false)}
        onConfirm={({ ownerPin, reason }) => void saveReverse(ownerPin, reason)}
      />
    </PageShell>
  );
}
