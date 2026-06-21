import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CreditCard, MessageCircle, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { loadCustomersWithLedger, formatDateTime, formatMoney, formatShortDate, type CustomerWithLedger } from "@/features/customers/customer-ledger-data";
import { buildLedgerStatement, dedupeLedgerEntries, ledgerEntryLabel, normaliseLedgerType, type CustomerLedgerEntry } from "@/features/ledger/accounting";
import { recordPaymentLocalFirst, reversePaymentWithOwnerPinLocalFirst } from "@/features/payments/local-actions";
import { sendUdharReminderOnWhatsapp } from "@/features/ledger/udhar-reminder";
import { useAuth } from "@/features/auth/useAuth";
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
  const { shop } = useAuth();
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

  useEffect(() => {
    const handler = (event: Event) => {
      const query = String((event as CustomEvent<{ query?: unknown }>).detail?.query ?? "").trim();
      if (!query) return;
      setSearch(query);
    };
    window.addEventListener("kirana:voice-udhar-search", handler);
    return () => window.removeEventListener("kirana:voice-udhar-search", handler);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const draft = (event as CustomEvent<{
        draft?: { customerName?: unknown; mobile?: unknown; amount?: unknown; mode?: unknown; note?: unknown };
      }>).detail?.draft;
      if (!draft) return;

      const name = String(draft.customerName ?? "").trim().toLowerCase();
      const mobile = String(draft.mobile ?? "").replace(/\D/g, "").slice(-10);
      const customer = customers.find((row) => {
        const rowMobile = String(row.mobile ?? "").replace(/\D/g, "").slice(-10);
        return Boolean(
          (mobile && rowMobile === mobile) ||
          (name && row.name.toLowerCase().includes(name)) ||
          (name && name.includes(row.name.toLowerCase())),
        );
      });

      if (name) setSearch(name);
      setPayment({
        customerId: customer?.id ?? "",
        amount: draft.amount !== undefined && Number.isFinite(Number(draft.amount)) ? String(draft.amount) : "",
        mode: String(draft.mode ?? "cash").toLowerCase() === "upi" ? "upi" : "cash",
        note: typeof draft.note === "string" ? draft.note : "",
      });
      setPaymentOpen(true);
      if (!customer) {
        toast({
          title: "Choose customer",
          description: "Voice filled the payment details. Select the matching customer before saving.",
        });
      }
    };
    window.addEventListener("kirana:voice-payment-draft", handler);
    return () => window.removeEventListener("kirana:voice-payment-draft", handler);
  }, [customers, toast]);

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
    // Mirror the offline overpayment guard (recordPaymentLocalFirst /
    // UDHAR_PAYMENT_EXCEEDS_OUTSTANDING): a collection can never exceed what the
    // customer owes. Catch it here for a clear message before any write/sync.
    const selectedCustomer = customers.find((customer) => customer.id === payment.customerId);
    const outstanding = Math.max(0, Number(selectedCustomer?.ledgerBalance ?? 0));
    if (amount > outstanding + 0.001) {
      toast({
        title: "Amount exceeds outstanding udhar",
        description: `${selectedCustomer?.name ?? "This customer"} owes ₹${outstanding.toLocaleString("en-IN")}. Enter that amount or less.`,
        variant: "destructive",
      });
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

      <div className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">

        {/* ── Panel 1: Outstanding Udhar (accounts-receivable list) ─────────── */}
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-destructive/10 text-destructive">
                <AlertTriangle size={17} />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-base font-black tracking-tight">Outstanding Udhar</h2>
                  <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-bold text-destructive">{filtered.length}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Customers who owe you money right now</p>
              </div>
            </div>
          </div>

          {isLoading && (
            <div className="px-5 py-8 text-sm text-muted-foreground">Loading local ledger…</div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
              <span className="grid h-14 w-14 place-items-center rounded-xl bg-muted">
                <AlertTriangle size={24} />
              </span>
              <p className="font-semibold text-foreground">All clear</p>
              <p className="text-sm">No outstanding udhar found.</p>
            </div>
          )}

          <div className="divide-y">
            {filtered.map((customer) => {
              const ageColor =
                customer.ledgerMetrics.ageing.thirtyPlus > 0
                  ? "border-l-red-500"
                  : customer.ledgerMetrics.ageing.sevenToThirty > 0
                    ? "border-l-amber-500"
                    : "border-l-emerald-500";
              return (
                <div key={customer.id} className={`border-l-[3px] px-5 py-4 ${ageColor}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-black text-foreground uppercase">
                        {customer.name[0] ?? "?"}
                      </div>
                      <div className="min-w-0">
                        <Link href={`/customers/${customer.id}`}>
                          <p className="truncate font-bold hover:underline cursor-pointer">{customer.name}</p>
                        </Link>
                        <p className="text-xs text-muted-foreground">{customer.mobile || "No phone"} · Due {formatShortDate(customer.dueDate)}</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-display text-xl font-black text-destructive tabular-nums">{formatMoney(customer.ledgerBalance)}</p>
                      {customer.ledgerMetrics.isBadCustomer
                        ? <span className="text-[11px] font-bold text-destructive">⚠ Warning</span>
                        : <span className="text-[11px] text-muted-foreground">Trust {customer.ledgerMetrics.trustScore}</span>
                      }
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {customer.ledgerMetrics.ageing.zeroToSeven > 0 && (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900">
                          0–7d: {formatMoney(customer.ledgerMetrics.ageing.zeroToSeven)}
                        </span>
                      )}
                      {customer.ledgerMetrics.ageing.sevenToThirty > 0 && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
                          7–30d: {formatMoney(customer.ledgerMetrics.ageing.sevenToThirty)}
                        </span>
                      )}
                      {customer.ledgerMetrics.ageing.thirtyPlus > 0 && (
                        <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200/60 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
                          30+d: {formatMoney(customer.ledgerMetrics.ageing.thirtyPlus)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300"
                        disabled={!customer.mobile}
                        title={customer.mobile ? "Send a WhatsApp reminder" : "No phone number on file"}
                        onClick={() => {
                          const { targetedCustomer } = sendUdharReminderOnWhatsapp({
                            customerName: customer.name,
                            customerMobile: customer.mobile ?? undefined,
                            amount: customer.ledgerBalance,
                            shopName: shop?.name,
                          });
                          toast({
                            title: "Opening WhatsApp…",
                            description: targetedCustomer ? `Reminder ready for ${customer.name}.` : "Pick a chat to send the reminder.",
                          });
                        }}
                      >
                        <MessageCircle size={14} className="mr-1" />Remind
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openPayment(customer)}>Collect</Button>
                      <Link href={`/customers/${customer.id}`}><Button size="sm">Ledger →</Button></Link>
                    </div>
                  </div>

                  {customer.ledgerMetrics.warning && (
                    <p className="mt-2 rounded-lg bg-destructive/8 px-3 py-2 text-xs text-destructive">
                      {customer.ledgerMetrics.warning}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Panel 2: Ledger Feed (timeline activity log) ──────────────────── */}
        <div className="overflow-hidden rounded-2xl border bg-muted/25 shadow-sm">
          <div className="flex items-center justify-between border-b bg-card/70 px-5 py-4 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <CreditCard size={17} />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-base font-black tracking-tight">Ledger Feed</h2>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">{Math.min(ledger.length, 80)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">All credit &amp; payment transactions</p>
              </div>
            </div>
          </div>

          <div className="max-h-[680px] overflow-auto p-4">
            {ledger.length === 0 ? (
              <p className="py-14 text-center text-sm text-muted-foreground">No ledger entries yet.</p>
            ) : (
              <div className="relative space-y-2 pl-6">
                <div className="absolute left-2 top-1 bottom-1 w-px bg-border" />
                {ledger.slice(0, 80).map((entry) => {
                  const type = normaliseLedgerType(entry.type, entry.source_type);
                  const isCredit = entry.signed_amount < 0;
                  const customer = customers.find((row) => row.id === entry.customerId || row.id === entry.customer_id);
                  const linkedPayment = payments.find((paymentRow) => String(paymentRow.id) === String(entry.paymentId ?? entry.payment_id ?? entry.source_id));
                  return (
                    <div key={entry.id} className="relative">
                      <div className={`absolute left-[-1.35rem] top-3.5 h-2.5 w-2.5 rounded-full ring-2 ring-muted/25 ${isCredit ? "bg-emerald-500" : "bg-orange-400"}`} />
                      <div className="rounded-xl border bg-card p-3 shadow-xs">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">{customer?.name ?? "Customer"}</p>
                            <p className="text-xs text-muted-foreground">
                              <span className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${isCredit ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-700"}`}>
                                {ledgerEntryLabel(type)}
                              </span>
                              {formatDateTime(entry.display_date)}
                            </p>
                            {entry.note ? <p className="mt-0.5 text-xs italic text-muted-foreground">"{entry.note}"</p> : null}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={`font-display text-base font-black tabular-nums ${isCredit ? "text-emerald-600" : "text-orange-600"}`}>
                              {isCredit ? "−" : "+"}{formatMoney(Math.abs(entry.signed_amount))}
                            </p>
                            <p className="text-[11px] text-muted-foreground">Bal {formatMoney(entry.running_balance)}</p>
                          </div>
                        </div>
                        {type === "PAYMENT" && linkedPayment && !linkedPayment.reversed_at && !linkedPayment.reversedAt ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2 h-7 text-xs"
                            onClick={() => {
                              if (!reversePaymentPermission.allowed) {
                                toast({ title: "Permission denied", description: reversePaymentPermission.reason, variant: "destructive" });
                                return;
                              }
                              setReverse({ paymentId: String(linkedPayment.id) });
                              setReverseOpen(true);
                            }}
                          >
                            <RotateCcw size={11} className="mr-1" />Reverse
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
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
