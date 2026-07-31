import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, CreditCard, FileText, Loader2, MessageCircle, RotateCcw, ShieldAlert, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { buildCustomerTimeline, loadCustomerDetail, reconcileCustomerWithAuthoritativeSummary, formatDateTime, formatMoney, formatShortDate, toLedgerDriftCandidates, type CustomerTimelineEvent } from "@/features/customers/customer-ledger-data";
import { isManualAdjustmentEntry, ledgerEntryLabel, normaliseLedgerType } from "@/features/ledger/accounting";
import { resolveAuthoritativeUdharSummary } from "@/features/ledger/authoritative-balances";
import { repairLedgerDriftFromServer } from "@/features/ledger/ledger-drift-repair";
import { recordPaymentLocalFirst, reversePaymentWithOwnerPinLocalFirst } from "@/features/payments/local-actions";
import { createLedgerAdjustmentLocalFirst } from "@/features/ledger/local-actions";
import { FeatureGate, UpgradePrompt } from "@/features/subscription";
import { usePermission } from "@/features/staff/permissions";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { apiRequest } from "@/lib/api/http";
import { moneyExceeds, roundMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

interface PaymentFormState { amount: string; mode: "cash" | "upi" | "bank"; note: string }
interface ReverseFormState { paymentId: string }
interface AdjustmentFormState { amount: string; ownerPin: string; note: string }

function useCustomerDetail(id: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["customer-detail", id] });
    window.addEventListener("kirana:local-data-changed", refresh);
    window.addEventListener("kirana:sync-queue-updated", refresh);
    return () => {
      window.removeEventListener("kirana:local-data-changed", refresh);
      window.removeEventListener("kirana:sync-queue-updated", refresh);
    };
  }, [id, queryClient]);
  return useQuery({
    queryKey: ["customer-detail", id],
    queryFn: async () => {
      const detail = await loadCustomerDetail(id);
      // Match the customers list: overlay the server's authoritative udhar summary
      // so "Current udhar" here can't drift from the value shown on the main page.
      // Offline we reuse the last summary this device saw, for the same reason —
      // the raw local ledger is the one source that can be silently wrong.
      if (!detail) return detail;
      const { summary, source } = await resolveAuthoritativeUdharSummary();
      if (!summary) return detail;
      if (source === "server") {
        const repaired = await repairLedgerDriftFromServer(
          toLedgerDriftCandidates([detail.customer]),
          summary,
        ).catch(() => false);
        if (repaired) {
          const refreshed = await loadCustomerDetail(id);
          if (refreshed) {
            return {
              ...refreshed,
              customer: reconcileCustomerWithAuthoritativeSummary(refreshed.customer, summary),
            };
          }
        }
      }
      return { ...detail, customer: reconcileCustomerWithAuthoritativeSummary(detail.customer, summary) };
    },
    enabled: id.length > 0,
    staleTime: 1_500,
  });
}

function readNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

const TIMELINE_META: Record<CustomerTimelineEvent["kind"], { icon: typeof ShoppingBag; tone: string; badge: string }> = {
  sale: { icon: ShoppingBag, tone: "text-foreground", badge: "bg-blue-50 text-blue-700" },
  estimate: { icon: FileText, tone: "text-foreground", badge: "bg-slate-100 text-slate-600" },
  return: { icon: RotateCcw, tone: "text-destructive", badge: "bg-red-50 text-red-600" },
  payment: { icon: CreditCard, tone: "text-emerald-600", badge: "bg-emerald-50 text-emerald-700" },
  payment_reversed: { icon: RotateCcw, tone: "text-amber-700", badge: "bg-amber-50 text-amber-700" },
  adjustment: { icon: ShieldAlert, tone: "text-foreground", badge: "bg-violet-50 text-violet-700" },
};

function TimelineRow({ event }: { event: CustomerTimelineEvent }) {
  const meta = TIMELINE_META[event.kind];
  const Icon = meta.icon;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${meta.badge}`}><Icon size={14} /></span>
        <div className="min-w-0">
          <p className="truncate font-medium">{event.title}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(event.at)}{event.detail ? ` • ${event.detail}` : ""}</p>
        </div>
      </div>
      <p className={`shrink-0 font-bold ${meta.tone}`}>{event.amount < 0 ? "−" : ""}{formatMoney(Math.abs(event.amount))}</p>
    </div>
  );
}

function billNumber(row: Record<string, unknown>): string {
  return String(row.billNumber ?? row.billNo ?? row.id ?? "Bill");
}

function printStatement(customerName: string, ledgerRows: Array<{ display_date: string; display_type: string; signed_amount: number; running_balance: number; note?: string | null }>) {
  const rows = ledgerRows.map((row) => `<tr><td>${formatDateTime(row.display_date)}</td><td>${row.display_type}</td><td>${row.note ?? ""}</td><td style="text-align:right">${formatMoney(row.signed_amount)}</td><td style="text-align:right">${formatMoney(Math.max(0, row.running_balance))}${row.running_balance < 0 ? " *" : ""}</td></tr>`).join("");
  const win = window.open("", "_blank", "width=720,height=840");
  if (!win) return false;
  win.document.write(`<!doctype html><html><head><title>${customerName} statement</title><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:8px;font-size:12px}h1{font-size:20px}</style></head><body><h1>${customerName} - Customer Statement</h1><table><thead><tr><th>Date</th><th>Type</th><th>Note</th><th>Amount</th><th>Balance</th></tr></thead><tbody>${rows}</tbody></table><script>window.print()</script></body></html>`);
  win.document.close();
  return true;
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";
  const { toast } = useToast();
  const reversePaymentPermission = usePermission("reverse_payment");
  const { data, isLoading, refetch } = useCustomerDetail(id);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [payment, setPayment] = useState<PaymentFormState>({ amount: "", mode: "cash", note: "" });
  const [reverse, setReverse] = useState<ReverseFormState>({ paymentId: "" });
  const [adjust, setAdjust] = useState<AdjustmentFormState>({ amount: "", ownerPin: "", note: "" });
  const [saving, setSaving] = useState(false);

  const customer = data?.customer;
  const ledger = data?.ledger ?? [];
  const payments = data?.payments ?? [];
  const bills = data?.bills ?? [];
  const activePayments = useMemo(() => payments.filter((row) => !row.reversed_at && !row.reversedAt), [payments]);
  const timeline = useMemo(() => buildCustomerTimeline({ bills, payments, ledger }), [bills, payments, ledger]);
  const hasNegativeLedgerHistory = useMemo(
    () => ledger.some((entry) => roundMoney(entry.running_balance) < 0),
    [ledger],
  );
  const reminder = useMutation({
    mutationFn: (customerId: string) => apiRequest<{
      status: string;
      code?: string;
      queued: boolean;
      providerConfigured: boolean;
    }>("/reminders/send", {
      method: "POST",
      body: JSON.stringify({ customerId, channel: "whatsapp" }),
    }),
    onSuccess: (result) => {
      const queued = result.queued || result.status === "queued";
      toast({
        title: queued ? "WhatsApp reminder queued" : "Reminder was not queued",
        description: queued
          ? "The reminder worker will update the delivery log after the provider responds."
          : result.code || "Review the provider and queue status in Notification settings.",
        variant: queued ? "default" : "destructive",
      });
    },
    onError: (error) => toast({
      title: "Reminder could not be sent",
      description: error instanceof Error ? error.message : "Review WhatsApp readiness in Notification settings.",
      variant: "destructive",
    }),
  });

  async function savePayment() {
    if (!customer) return;
    const amount = roundMoney(Number(payment.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Enter valid amount", variant: "destructive" });
      return;
    }
    // Mirror the offline overpayment guard (recordPaymentLocalFirst /
    // UDHAR_PAYMENT_EXCEEDS_OUTSTANDING): collection can't exceed what is owed.
    const outstanding = Math.max(0, roundMoney(Number(customer.ledgerBalance ?? 0)));
    if (moneyExceeds(amount, outstanding)) {
      toast({
        title: "Amount exceeds outstanding udhar",
        description: `${customer.name} owes ${formatMoney(outstanding)}. Enter that amount or less.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await recordPaymentLocalFirst(
        customer.id,
        { amount, mode: payment.mode, note: payment.note.trim() || undefined },
        // The displayed balance is the authoritative one; the device ledger can
        // be drifted and would otherwise reject a legitimate collection.
        { expectedOutstanding: outstanding },
      );
      toast({ title: "Payment recorded", description: "Ledger updated locally. Billing still works offline." });
      setPaymentOpen(false);
      setPayment({ amount: "", mode: "cash", note: "" });
      await refetch();
    } catch (error) {
      toast({ title: "Payment failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function saveReverse(ownerPin: string, reason: string) {
    if (!reverse.paymentId) return;
    setSaving(true);
    try {
      await reversePaymentWithOwnerPinLocalFirst({ paymentId: reverse.paymentId, ownerPin, reason });
      toast({ title: "Payment reversed", description: "Correction entry added. Original ledger is preserved." });
      setReverseOpen(false);
      setReverse({ paymentId: "" });
      await refetch();
    } catch (error) {
      toast({ title: "Reversal failed", description: error instanceof Error ? error.message : "Check owner PIN.", variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function saveAdjustment() {
    if (!customer) return;
    const amount = roundMoney(Number(adjust.amount));
    if (!Number.isFinite(amount) || amount === 0) {
      toast({ title: "Enter valid adjustment", description: "Use positive amount to increase udhar, negative to reduce.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createLedgerAdjustmentLocalFirst({ customerId: customer.id, amount, ownerPin: adjust.ownerPin, note: adjust.note, expectedOutstanding: Math.max(0, roundMoney(Number(customer.ledgerBalance ?? 0))) });
      toast({ title: "Ledger adjustment saved", description: "Append-only correction added locally." });
      setAdjustOpen(false);
      setAdjust({ amount: "", ownerPin: "", note: "" });
      await refetch();
    } catch (error) {
      toast({ title: "Adjustment failed", description: error instanceof Error ? error.message : "Check owner PIN.", variant: "destructive" });
    } finally { setSaving(false); }
  }

  if (isLoading) return <div className="app-page-shell"><div className="h-48 animate-pulse rounded-[18px] border border-[#e2e8f2] bg-white shadow-sm" /></div>;
  if (!customer) return <div className="app-page-shell space-y-4"><Link href="/customers"><Button variant="outline"><ArrowLeft size={15} className="mr-1" />Back</Button></Link><Card><CardContent className="py-14 text-center text-muted-foreground">Customer not found.</CardContent></Card></div>;

  return (
    <div className="app-page-shell w-full max-w-none space-y-5">
      <section className="overflow-hidden rounded-[18px] border border-[#e2e8f2] bg-white shadow-[0_10px_30px_rgba(15,35,80,0.05)]">
        <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between lg:p-5">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/customers"><Button size="icon" variant="outline" className="h-10 w-10 shrink-0 rounded-[12px]" aria-label="Back to customers"><ArrowLeft size={17} /></Button></Link>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-[var(--brand-soft)] text-sm font-black text-[var(--brand)]">{customer.name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase()}</span>
            <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#7b879b]">Customer account</p><h1 className="mt-1 truncate font-display text-[22px] font-black tracking-tight text-[#10224a]">{customer.name}</h1><p className="mt-1 truncate text-xs font-medium text-[#66758f]">{customer.mobile || "No phone"} {customer.address ? `• ${customer.address}` : ""}</p></div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <FeatureGate featureName="whatsapp_reminders" fallback={<UpgradePrompt compact featureName="whatsapp_reminders" description="Automated WhatsApp reminders require Pro." />}>
              <Button variant="outline" disabled={reminder.isPending || !customer.mobile || Number(customer.ledgerBalance || 0) <= 0} onClick={() => reminder.mutate(customer.id)} title={!customer.mobile ? "Add a customer mobile number first" : Number(customer.ledgerBalance || 0) <= 0 ? "No pending udhar to remind" : undefined}>{reminder.isPending ? <Loader2 size={15} className="mr-1 animate-spin" /> : <MessageCircle size={15} className="mr-1" />}WhatsApp reminder</Button>
            </FeatureGate>
            <Button variant="outline" onClick={() => { const ok = printStatement(customer.name, ledger); if (!ok) toast({ title: "Print blocked", variant: "destructive" }); }}><FileText size={15} className="mr-1" />Statement</Button>
            <Button variant="outline" onClick={() => setAdjustOpen(true)}><ShieldAlert size={15} className="mr-1" />Adjustment</Button>
            <Button disabled={customer.ledgerBalance <= 0} onClick={() => setPaymentOpen(true)} title={customer.ledgerBalance <= 0 ? "No pending udhar to collect" : undefined}><CreditCard size={15} className="mr-1" />Record payment</Button>
          </div>
        </div>
      </section>

      {customer.ledgerMetrics.warning ? <Card className="border-destructive"><CardContent className="py-3 text-sm text-destructive font-medium">{customer.ledgerMetrics.warning}</CardContent></Card> : null}
      {hasNegativeLedgerHistory ? <Card className="border-amber-300 bg-amber-50"><CardContent className="py-3 text-sm font-medium text-amber-900">Old overpayment data was detected in this ledger. Current udhar never goes below {formatMoney(0)}; affected historical balances are marked for reconciliation.</CardContent></Card> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Card className="border-t-2 border-t-rose-500"><CardHeader className="pb-2"><CardTitle className="text-sm">Current udhar</CardTitle></CardHeader><CardContent className="text-2xl font-black text-destructive">{formatMoney(Math.max(0, customer.ledgerBalance))}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Trust score</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{customer.ledgerMetrics.trustScore}/100</div><Badge variant={customer.ledgerMetrics.isBadCustomer ? "destructive" : "outline"}>{customer.ledgerMetrics.isBadCustomer ? "Bad customer warning" : "Acceptable"}</Badge></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Udhar limit</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{typeof customer.udharLimit === "number" ? formatMoney(customer.udharLimit) : "—"}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Due date</CardTitle></CardHeader><CardContent className="font-semibold"><CalendarClock size={15} className="inline mr-1" />{formatShortDate(customer.dueDate)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Promise date</CardTitle></CardHeader><CardContent className="font-semibold">{formatShortDate(customer.promiseToPayDate)}</CardContent></Card>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-t-2 border-t-emerald-500"><CardHeader className="pb-2"><CardTitle className="text-sm">0–7 days</CardTitle></CardHeader><CardContent className="text-xl font-black">{formatMoney(customer.ledgerMetrics.ageing.zeroToSeven)}</CardContent></Card>
        <Card className="border-t-2 border-t-amber-500"><CardHeader className="pb-2"><CardTitle className="text-sm">7–30 days</CardTitle></CardHeader><CardContent className="text-xl font-black">{formatMoney(customer.ledgerMetrics.ageing.sevenToThirty)}</CardContent></Card>
        <Card className="border-t-2 border-t-rose-500"><CardHeader className="pb-2"><CardTitle className="text-sm">30+ days</CardTitle></CardHeader><CardContent className="text-xl font-black text-destructive">{formatMoney(customer.ledgerMetrics.ageing.thirtyPlus)}</CardContent></Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>Activity timeline</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[420px] overflow-auto" data-testid="customer-timeline">
            {timeline.length === 0 ? <div className="text-center py-8 text-muted-foreground">No activity yet — bills, payments and adjustments will appear here.</div> : timeline.map((event) => {
              const inner = <TimelineRow event={event} />;
              return event.href
                ? <Link key={event.id} href={event.href}><div className="rounded-lg border p-3 hover:bg-muted/40 cursor-pointer">{inner}</div></Link>
                : <div key={event.id} className="rounded-lg border p-3">{inner}</div>;
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Full ledger / customer statement</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[560px] overflow-auto">
            {ledger.length === 0 ? <div className="text-center py-8 text-muted-foreground">No ledger entries yet.</div> : ledger.map((entry) => {
              const type = normaliseLedgerType(entry.type, entry.source_type);
              const label = isManualAdjustmentEntry(entry) ? "Manual adjustment" : ledgerEntryLabel(type);
              return <div key={entry.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-medium">{label}</p><p className="text-xs text-muted-foreground">{formatDateTime(entry.display_date)} {entry.note ? `• ${entry.note}` : ""}</p></div>
                  <div className="text-right"><p className={`font-bold ${entry.signed_amount < 0 ? "text-emerald-600" : "text-destructive"}`}>{entry.signed_amount < 0 ? "-" : "+"}{formatMoney(Math.abs(entry.signed_amount))}</p><p className={cn("text-xs", entry.running_balance < 0 ? "font-semibold text-amber-700" : "text-muted-foreground")}>Bal {formatMoney(Math.max(0, entry.running_balance))}{entry.running_balance < 0 ? " · Reconcile" : ""}</p></div>
                </div>
              </div>;
            })}
          </CardContent>
        </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Recent bills</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {bills.slice(0, 8).map((bill) => <Link key={String(bill.id)} href={`/bills/${String(bill.id)}`}><div className="rounded-lg border p-3 hover:bg-muted/40 cursor-pointer"><div className="flex justify-between"><span className="font-medium">{billNumber(bill)}</span><span className="font-semibold">{formatMoney(readNumber(bill.grandTotal ?? bill.totalAmount))}</span></div><p className="text-xs text-muted-foreground">{formatDateTime(bill.businessDate ?? bill.business_date ?? bill.createdAt ?? bill.created_at)} • {String(bill.status ?? bill.billType ?? "bill")}</p></div></Link>)}
              {bills.length === 0 ? <p className="text-sm text-muted-foreground">No bills linked.</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recent payments</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {payments.slice(0, 8).map((row) => <div key={String(row.id)} className="rounded-lg border p-3"><div className="flex justify-between gap-3"><div><p className="font-medium">{formatMoney(readNumber(row.amount))} • {String(row.mode ?? "payment").toUpperCase()}</p><p className="text-xs text-muted-foreground">{formatDateTime(row.paidAt ?? row.paid_at ?? row.createdAt ?? row.created_at)} {row.reversed_at || row.reversedAt ? "• Reversed" : ""}</p></div>{!row.reversed_at && !row.reversedAt && row.derived_from_ledger !== true ? <Button size="sm" variant="outline" onClick={() => { if (!reversePaymentPermission.allowed) { toast({ title: "Permission denied", description: reversePaymentPermission.reason, variant: "destructive" }); return; } setReverse({ paymentId: String(row.id) }); setReverseOpen(true); }}><RotateCcw size={13} className="mr-1" />Reverse</Button> : <Badge variant="secondary">{row.derived_from_ledger === true && !row.reversed_at && !row.reversedAt ? "Ledger" : "Reversed"}</Badge>}</div></div>)}
              {payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : null}
              {activePayments.length === 0 && payments.length > 0 ? <p className="text-xs text-muted-foreground">All visible payments are corrected/reversed.</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Customer-specific pricing</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">{customer.notes || "No special pricing notes saved. Add notes on customer edit screen."}</CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader><div className="space-y-4"><div><Label>Amount *</Label><Input type="number" inputMode="decimal" min="0" step="0.01" max={Math.max(0, customer.ledgerBalance)} className="mt-1" value={payment.amount} onChange={(event) => setPayment((form) => ({ ...form, amount: event.target.value }))} /></div><div><Label>Mode</Label><Select value={payment.mode} onValueChange={(value) => setPayment((form) => ({ ...form, mode: value as PaymentFormState["mode"] }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="upi">UPI</SelectItem><SelectItem value="bank">Bank</SelectItem></SelectContent></Select></div><div><Label>Note</Label><Input className="mt-1" value={payment.note} onChange={(event) => setPayment((form) => ({ ...form, note: event.target.value }))} /></div></div><div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void savePayment()}>{saving ? "Saving..." : "Save offline"}</Button></div></DialogContent></Dialog>
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
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Manual ledger adjustment</DialogTitle></DialogHeader><div className="space-y-4"><p className="text-sm text-muted-foreground">Positive amount increases udhar. Negative amount reduces udhar. This creates an append-only ledger correction.</p><div><Label>Amount *</Label><Input type="number" inputMode="decimal" step="0.01" className="mt-1" value={adjust.amount} onChange={(event) => setAdjust((form) => ({ ...form, amount: event.target.value }))} /></div><div><Label>Owner PIN *</Label><Input type="password" className="mt-1" value={adjust.ownerPin} onChange={(event) => setAdjust((form) => ({ ...form, ownerPin: event.target.value }))} /></div><div><Label>Reason</Label><Textarea className="mt-1" value={adjust.note} onChange={(event) => setAdjust((form) => ({ ...form, note: event.target.value }))} /></div></div><div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void saveAdjustment()}>{saving ? "Saving..." : "Save correction"}</Button></div></DialogContent></Dialog>
    </div>
  );
}
