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
import { buildCustomerTimeline, loadCustomerDetail, projectCustomerOutstanding, reconcileCustomerWithAuthoritativeSummary, formatDateTime, formatMoney, formatShortDate, toLedgerDriftCandidates, type CustomerDetailData, type CustomerTimelineEvent, type CustomerWithLedger } from "@/features/core/customers/customer-ledger-data";
import { isManualAdjustmentEntry, ledgerEntryLabel, normaliseLedgerType } from "@/features/core/ledger/accounting";
import { loadCachedAuthoritativeSummary, resolveAuthoritativeUdharSummary } from "@/features/core/ledger/authoritative-balances";
import { repairLedgerDriftFromServer } from "@/features/core/ledger/ledger-drift-repair";
import { recordPaymentLocalFirst, reversePaymentWithOwnerPinLocalFirst } from "@/features/core/payments/local-actions";
import { createLedgerAdjustmentLocalFirst } from "@/features/core/ledger/local-actions";
import { FeatureGate, UpgradePrompt } from "@/features/core/subscription";
import { usePermission } from "@/features/core/staff/permissions";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { apiRequest } from "@/lib/api/http";
import { moneyExceeds, roundMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useAppLanguage, type Translate } from "@/features/core/settings/i18n";
import { escapeHtml } from "@/lib/escape-html";

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
  const detailQuery = useQuery({
    queryKey: ["customer-detail", id],
    queryFn: async () => {
      // First paint must depend only on local storage. Waiting for the live
      // summary here kept the entire page behind a loading skeleton whenever
      // the browser had internet but the API was slow or unreachable.
      const [detail, cached] = await Promise.all([
        loadCustomerDetail(id),
        loadCachedAuthoritativeSummary(),
      ]);
      if (!detail) return detail;
      return cached?.summary
        ? { ...detail, customer: reconcileCustomerWithAuthoritativeSummary(detail.customer, cached.summary) }
        : detail;
    },
    enabled: id.length > 0,
    staleTime: 1_500,
  });

  const authoritativeQuery = useQuery({
    queryKey: ["customer-detail-authoritative-summary"],
    queryFn: resolveAuthoritativeUdharSummary,
    enabled: id.length > 0,
    staleTime: 10_000,
    retry: false,
  });

  useEffect(() => {
    const detail = detailQuery.data;
    const resolved = authoritativeQuery.data;
    if (!detail || !resolved?.summary) return;
    queryClient.setQueryData<CustomerDetailData | null>(["customer-detail", id], (current) =>
      current
        ? { ...current, customer: reconcileCustomerWithAuthoritativeSummary(current.customer, resolved.summary!) }
        : current);
    if (resolved.source !== "server") return;
    void repairLedgerDriftFromServer(
      toLedgerDriftCandidates([detail.customer]),
      resolved.summary,
    ).then((repaired) => {
      if (repaired) return queryClient.invalidateQueries({ queryKey: ["customer-detail", id] });
      return undefined;
    }).catch(() => undefined);
  }, [authoritativeQuery.data, detailQuery.data, id, queryClient]);

  return detailQuery;
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
  const { t } = useAppLanguage();
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

/**
 * The printed statement is a generated HTML document, so its headings have to be
 * INTERPOLATED — `${t(...)}` and not `{t(...)}`. A bare JSX-style call here printed
 * the string `{t("customers.ledger.date")}` onto real customers' statements; the
 * translator is passed in so the document is written in the shop's language.
 */
function printStatement(
  customerName: string,
  customerMobile: string | null | undefined,
  currentBalance: number,
  ledgerRows: Array<{ display_date: string; display_type: string; signed_amount: number; running_balance: number; note?: string | null }>,
  t: Translate,
) {
  const rows = ledgerRows.map((row) => `<tr><td>${escapeHtml(formatDateTime(row.display_date))}</td><td>${escapeHtml(row.display_type)}</td><td>${escapeHtml(row.note)}</td><td style="text-align:right">${escapeHtml(formatMoney(row.signed_amount))}</td><td style="text-align:right">${escapeHtml(formatMoney(Math.max(0, row.running_balance)))}${row.running_balance < 0 ? " *" : ""}</td></tr>`).join("");
  const win = window.open("", "_blank", "width=720,height=840");
  if (!win) return false;
  const safeCustomerName = escapeHtml(customerName);
  const statementTitle = escapeHtml(t("customers.statement.title"));
  win.document.write(`<!doctype html><html><head><title>${safeCustomerName} ${statementTitle}</title><style>@page{margin:12mm}*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;padding:24px;color:#102247}.head{border-radius:16px;background:#f4f8ff;padding:18px}h1{font-size:22px;margin:0}.meta{margin:6px 0 0;color:#64748b;font-size:12px}.due{margin-top:12px;font-size:20px;font-weight:900;color:#e11d48}table{width:100%;border-collapse:collapse;margin-top:18px}td,th{border-bottom:1px solid #e2e8f0;padding:9px 6px;font-size:11px}th{background:#f8faff;text-transform:uppercase;letter-spacing:.04em;text-align:left}</style></head><body><header class="head"><h1>${safeCustomerName} · ${statementTitle}</h1><p class="meta">${escapeHtml(customerMobile || "—")}</p><p class="meta">${escapeHtml(t("customers.print.asOn", { date: formatShortDate(new Date().toISOString()) }))}</p><p class="due">${escapeHtml(formatMoney(Math.max(0, currentBalance)))}</p></header><table><thead><tr><th>${escapeHtml(t("customers.ledger.date"))}</th><th>${escapeHtml(t("customers.ledger.type"))}</th><th>${escapeHtml(t("customers.statement.note"))}</th><th>${escapeHtml(t("customers.statement.amount"))}</th><th>${escapeHtml(t("customers.ledger.balance"))}</th></tr></thead><tbody>${rows}</tbody></table><script>setTimeout(function(){window.print()},300)</script></body></html>`);
  win.document.close();
  return true;
}

function printPaymentReceipt(
  customerName: string,
  customerMobile: string | null | undefined,
  payment: Record<string, unknown>,
  currentBalance: number,
  t: Translate,
) {
  const win = window.open("", "_blank", "width=480,height=720");
  if (!win) return false;
  const amount = formatMoney(readNumber(payment.amount));
  const mode = String(payment.mode ?? "payment").toUpperCase();
  const paidAt = formatDateTime(payment.paidAt ?? payment.paid_at ?? payment.createdAt ?? payment.created_at);
  const reference = String(payment.server_id ?? payment.id ?? payment.local_id ?? "—");
  const reversed = Boolean(payment.reversed_at || payment.reversedAt);
  const activeBrand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim();
  const receiptBrand = /^#[0-9a-f]{6}$/i.test(activeBrand) ? activeBrand : "#1746a2";
  win.document.write(`<!doctype html><html><head><title>${escapeHtml(t("customers.receipt.title"))}</title><style>:root{--receipt-brand:${receiptBrand}}@page{margin:12mm}*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;margin:0;color:#102247;background:#fff}.sheet{max-width:420px;margin:0 auto;border:1px solid #dfe7f2;border-radius:18px;overflow:hidden}.head{padding:22px;background:linear-gradient(135deg,var(--receipt-brand),color-mix(in srgb,var(--receipt-brand),#000 18%));color:#fff}.eyebrow{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;opacity:.8}h1{font-size:22px;margin:7px 0 0}.body{padding:20px}.amount{font-size:32px;font-weight:900;color:var(--receipt-brand);margin:3px 0 18px}.row{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid #edf1f6;font-size:12px}.row span{color:#64748b}.row strong{text-align:right;word-break:break-word}.status{margin:0 0 14px;padding:10px 12px;border-radius:10px;background:${reversed ? "#fff7ed" : "#ecfdf5"};color:${reversed ? "#c2410c" : "#047857"};font-size:11px;font-weight:800}.foot{padding:14px 20px;background:#f8faff;color:#64748b;font-size:10px;line-height:1.5}@media print{.sheet{border:0}}</style></head><body><main class="sheet"><header class="head"><div class="eyebrow">${escapeHtml(t("customers.receipt.title"))}</div><h1>${escapeHtml(customerName)}</h1></header><section class="body"><p class="status">${escapeHtml(reversed ? t("customers.receipt.reversed") : t("customers.receipt.recorded"))}</p><div class="eyebrow" style="color:#64748b">${escapeHtml(t("customers.receipt.amount"))}</div><div class="amount">${escapeHtml(amount)}</div><div class="row"><span>${escapeHtml(t("customers.receipt.mobile"))}</span><strong>${escapeHtml(customerMobile || "—")}</strong></div><div class="row"><span>${escapeHtml(t("customers.receipt.mode"))}</span><strong>${escapeHtml(mode)}</strong></div><div class="row"><span>${escapeHtml(t("customers.receipt.date"))}</span><strong>${escapeHtml(paidAt)}</strong></div><div class="row"><span>${escapeHtml(t("customers.receipt.reference"))}</span><strong>${escapeHtml(reference)}</strong></div><div class="row"><span>${escapeHtml(t("customers.receipt.currentBalance"))}</span><strong>${escapeHtml(formatMoney(Math.max(0, currentBalance)))}</strong></div></section><footer class="foot">${escapeHtml(t("customers.receipt.footer"))}</footer></main><script>setTimeout(function(){window.print()},300)</script></body></html>`);
  win.document.close();
  return true;
}

export default function CustomerDetailPage() {
  const { t } = useAppLanguage();
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";
  const { toast } = useToast();
  const queryClient = useQueryClient();
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

  function projectVisibleBalance(nextBalance: number) {
    if (!customer) return;
    queryClient.setQueryData<CustomerDetailData | null>(["customer-detail", id], (current) => {
      if (!current) return current;
      const projected = projectCustomerOutstanding([current.customer], customer.id, nextBalance)[0];
      return projected ? { ...current, customer: projected } : current;
    });
    queryClient.setQueryData<CustomerWithLedger[]>(["customers-ledger-list"], (current) =>
      projectCustomerOutstanding(current ?? [], customer.id, nextBalance));
  }
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
        title: queued ? t("customers.toast.reminderQueued") : t("customers.toast.reminderNotQueued"),
        description: queued
          ? t("customers.toast.reminderWorkerNote")
          : result.code || t("customers.toast.reviewProvider"),
        variant: queued ? "default" : "destructive",
      });
    },
    onError: (error) => toast({
      title: t("customers.toast.reminderFailed"),
      description: error instanceof Error ? error.message : t("customers.toast.reviewWhatsapp"),
      variant: "destructive",
    }),
  });

  async function savePayment() {
    if (!customer) return;
    const amount = roundMoney(Number(payment.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: t("customers.toast.enterValidAmount"), variant: "destructive" });
      return;
    }
    // Mirror the offline overpayment guard (recordPaymentLocalFirst /
    // UDHAR_PAYMENT_EXCEEDS_OUTSTANDING): collection can't exceed what is owed.
    const outstanding = Math.max(0, roundMoney(Number(customer.ledgerBalance ?? 0)));
    if (moneyExceeds(amount, outstanding)) {
      toast({
        title: t("customers.toast.amountExceeds"),
        description: `${customer.name} owes ${formatMoney(outstanding)}. Enter that amount or less.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const result = await recordPaymentLocalFirst(
        customer.id,
        { amount, mode: payment.mode, note: payment.note.trim() || undefined },
        // The displayed balance is the authoritative one; the device ledger can
        // be drifted and would otherwise reject a legitimate collection.
        { expectedOutstanding: outstanding },
      );
      // The local transaction already knows the exact remaining balance. Put it
      // on screen before any server refresh so an older response can never leave
      // the operator looking at ₹0/the pre-payment amount until a manual reload.
      projectVisibleBalance(result.nextBalance);
      toast({ title: t("customers.toast.paymentRecorded"), description: t("customers.toast.ledgerOffline") });
      setPaymentOpen(false);
      setPayment({ amount: "", mode: "cash", note: "" });
      // Refresh the new ledger row in the background; payment acknowledgement
      // and the corrected balance must not wait for the network.
      void refetch();
    } catch (error) {
      toast({ title: t("customers.toast.paymentFailed"), description: error instanceof Error ? error.message : t("customers.toast.tryAgain"), variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function saveReverse(ownerPin: string, reason: string) {
    if (!reverse.paymentId) return;
    setSaving(true);
    try {
      const result = await reversePaymentWithOwnerPinLocalFirst({ paymentId: reverse.paymentId, ownerPin, reason });
      projectVisibleBalance(result.nextBalance);
      toast({ title: t("customers.toast.paymentReversed"), description: t("customers.toast.correctionAdded") });
      setReverseOpen(false);
      setReverse({ paymentId: "" });
      void refetch();
    } catch (error) {
      toast({ title: t("customers.toast.reversalFailed"), description: error instanceof Error ? error.message : t("customers.toast.checkOwnerPin"), variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function saveAdjustment() {
    if (!customer) return;
    const amount = roundMoney(Number(adjust.amount));
    if (!Number.isFinite(amount) || amount === 0) {
      toast({ title: t("customers.toast.enterValidAdjustment"), description: t("customers.detail.adjustmentHint"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const entry = await createLedgerAdjustmentLocalFirst({ customerId: customer.id, amount, ownerPin: adjust.ownerPin, note: adjust.note, expectedOutstanding: Math.max(0, roundMoney(Number(customer.ledgerBalance ?? 0))) });
      projectVisibleBalance(Number(entry.balance_after ?? customer.ledgerBalance));
      toast({ title: t("customers.toast.adjustmentSaved"), description: t("customers.toast.correctionLocal") });
      setAdjustOpen(false);
      setAdjust({ amount: "", ownerPin: "", note: "" });
      void refetch();
    } catch (error) {
      toast({ title: t("customers.toast.adjustmentFailed"), description: error instanceof Error ? error.message : t("customers.toast.checkOwnerPin"), variant: "destructive" });
    } finally { setSaving(false); }
  }

  if (isLoading) return <div className="app-page-shell"><div className="h-48 animate-pulse rounded-[18px] border border-[#e2e8f2] bg-white shadow-sm" /></div>;
  if (!customer) return <div className="app-page-shell space-y-4"><Link href="/customers"><Button variant="outline"><ArrowLeft size={15} className="mr-1" />{t("customers.account.back")}</Button></Link><Card><CardContent className="py-14 text-center text-muted-foreground">{t("customers.account.notFound")}</CardContent></Card></div>;

  return (
    <div className="app-page-shell w-full max-w-none space-y-5">
      <section className="overflow-hidden rounded-[20px] border border-[#dce6f4] bg-[linear-gradient(135deg,#ffffff_0%,#f4f8ff_100%)] shadow-[0_14px_36px_rgba(15,35,80,0.07)]">
        <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between lg:p-5">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/customers"><Button size="icon" variant="outline" className="h-11 w-11 shrink-0 rounded-[12px] bg-white" aria-label={t("customers.action.backToCustomers")}><ArrowLeft size={17} /></Button></Link>
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[16px] bg-[var(--brand-soft)] text-base font-black text-[var(--brand)] shadow-inner">{customer.name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase()}</span>
            <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#7b879b]">{t("customers.account.title")}</p><h1 className="mt-1 truncate font-display text-[22px] font-black tracking-tight text-[var(--brand-ink)]">{customer.name}</h1><p className="mt-1 truncate text-xs font-medium text-[#66758f]">{customer.mobile || t("customers.detail.noPhone")} {customer.address ? `• ${customer.address}` : ""}</p></div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:justify-end [&_button]:w-full sm:[&_button]:w-auto">
            <FeatureGate featureName="whatsapp_reminders" fallback={<UpgradePrompt compact featureName="whatsapp_reminders" description={t("customers.toast.whatsappNeedsPro")} />}>
              <Button variant="outline" className="bg-white" disabled={reminder.isPending || !customer.mobile || Number(customer.ledgerBalance || 0) <= 0} onClick={() => reminder.mutate(customer.id)} title={!customer.mobile ? t("customers.toast.needMobileFirst") : Number(customer.ledgerBalance || 0) <= 0 ? t("customers.toast.noPendingRemind") : undefined}>{reminder.isPending ? <Loader2 size={15} className="mr-1 animate-spin" /> : <MessageCircle size={15} className="mr-1" />}{t("customers.action.whatsapp")}</Button>
            </FeatureGate>
            <Button variant="outline" className="bg-white" onClick={() => { const ok = printStatement(customer.name, customer.mobile, customer.ledgerBalance, ledger, t); if (!ok) toast({ title: t("customers.toast.printBlocked"), variant: "destructive" }); }}><FileText size={15} className="mr-1" />{t("customers.action.statement")}</Button>
            <Button variant="outline" className="bg-white" onClick={() => setAdjustOpen(true)}><ShieldAlert size={15} className="mr-1" />{t("customers.detail.adjustment")}</Button>
            <Button disabled={customer.ledgerBalance <= 0} onClick={() => setPaymentOpen(true)} title={customer.ledgerBalance <= 0 ? t("customers.toast.noPendingCollect") : undefined}><CreditCard size={15} className="mr-1" />{t("customers.account.recordPayment")}</Button>
          </div>
        </div>
      </section>

      {customer.ledgerMetrics.warning ? <Card className="border-destructive"><CardContent className="py-3 text-sm text-destructive font-medium">{customer.ledgerMetrics.warning}</CardContent></Card> : null}
      {hasNegativeLedgerHistory ? <Card className="border-amber-300 bg-amber-50"><CardContent className="py-3 text-sm font-medium text-amber-900">{t("customers.detail.overpaymentNote", { floor: formatMoney(0) })}</CardContent></Card> : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Card className="col-span-2 overflow-hidden border-0 bg-[linear-gradient(135deg,#fff1f2_0%,#ffffff_72%)] shadow-[0_10px_28px_rgba(190,24,93,0.09)] xl:col-span-1"><CardHeader className="px-4 pb-2 pt-4"><CardTitle className="text-sm text-rose-700">{t("customers.account.currentUdhar")}</CardTitle></CardHeader><CardContent className="px-4 pb-4 text-[28px] font-black tracking-tight text-rose-600">{formatMoney(Math.max(0, customer.ledgerBalance))}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{t("customers.account.trustScore")}</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{customer.ledgerMetrics.trustScore}/100</div><Badge variant={customer.ledgerMetrics.isBadCustomer ? "destructive" : "outline"}>{customer.ledgerMetrics.isBadCustomer ? t("customers.detail.badCustomerWarning") : t("customers.detail.acceptable")}</Badge></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{t("customers.account.udharLimit")}</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{typeof customer.udharLimit === "number" ? formatMoney(customer.udharLimit) : "—"}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{t("customers.account.dueDate")}</CardTitle></CardHeader><CardContent className="font-semibold"><CalendarClock size={15} className="inline mr-1" />{formatShortDate(customer.dueDate)}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{t("customers.account.promiseDate")}</CardTitle></CardHeader><CardContent className="font-semibold">{formatShortDate(customer.promiseToPayDate)}</CardContent></Card>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Card className="border-t-2 border-t-emerald-500"><CardHeader className="px-3 pb-1 pt-3 sm:px-6 sm:pt-6"><CardTitle className="text-[11px] sm:text-sm">{t("customers.account.aging0to7")}</CardTitle></CardHeader><CardContent className="px-3 pb-3 text-sm font-black sm:px-6 sm:pb-6 sm:text-xl">{formatMoney(customer.ledgerMetrics.ageing.zeroToSeven)}</CardContent></Card>
        <Card className="border-t-2 border-t-amber-500"><CardHeader className="px-3 pb-1 pt-3 sm:px-6 sm:pt-6"><CardTitle className="text-[11px] sm:text-sm">{t("customers.account.aging7to30")}</CardTitle></CardHeader><CardContent className="px-3 pb-3 text-sm font-black sm:px-6 sm:pb-6 sm:text-xl">{formatMoney(customer.ledgerMetrics.ageing.sevenToThirty)}</CardContent></Card>
        <Card className="border-t-2 border-t-rose-500"><CardHeader className="px-3 pb-1 pt-3 sm:px-6 sm:pt-6"><CardTitle className="text-[11px] sm:text-sm">{t("customers.account.aging30plus")}</CardTitle></CardHeader><CardContent className="px-3 pb-3 text-sm font-black text-destructive sm:px-6 sm:pb-6 sm:text-xl">{formatMoney(customer.ledgerMetrics.ageing.thirtyPlus)}</CardContent></Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>{t("customers.account.timeline")}</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[420px] overflow-auto" data-testid="customer-timeline">
            {timeline.length === 0 ? <div className="text-center py-8 text-muted-foreground">{t("customers.account.timelineEmpty")}</div> : timeline.map((event) => {
              const inner = <TimelineRow event={event} />;
              return event.href
                ? <Link key={event.id} href={event.href}><div className="rounded-lg border p-3 hover:bg-muted/40 cursor-pointer">{inner}</div></Link>
                : <div key={event.id} className="rounded-lg border p-3">{inner}</div>;
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("customers.account.fullLedger")}</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[560px] overflow-auto">
            {ledger.length === 0 ? <div className="text-center py-8 text-muted-foreground">{t("customers.ledger.emptyYet")}</div> : ledger.map((entry) => {
              const type = normaliseLedgerType(entry.type, entry.source_type);
              const label = isManualAdjustmentEntry(entry) ? t("customers.detail.manualAdjustment") : ledgerEntryLabel(type);
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
            <CardHeader><CardTitle>{t("customers.account.recentBills")}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {bills.slice(0, 8).map((bill) => <Link key={String(bill.id)} href={`/bills/${String(bill.id)}`}><div className="rounded-lg border p-3 hover:bg-muted/40 cursor-pointer"><div className="flex justify-between"><span className="font-medium">{billNumber(bill)}</span><span className="font-semibold">{formatMoney(readNumber(bill.grandTotal ?? bill.totalAmount))}</span></div><p className="text-xs text-muted-foreground">{formatDateTime(bill.businessDate ?? bill.business_date ?? bill.createdAt ?? bill.created_at)} • {String(bill.status ?? bill.billType ?? "bill")}</p></div></Link>)}
              {bills.length === 0 ? <p className="text-sm text-muted-foreground">{t("customers.account.noBills")}</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("customers.account.recentPayments")}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {payments.slice(0, 8).map((row) => <div key={String(row.id)} className="rounded-xl border border-[#e3eaf4] bg-white p-3 shadow-[0_5px_16px_rgba(15,35,80,0.04)]"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-[var(--brand-ink)]">{formatMoney(readNumber(row.amount))} • {String(row.mode ?? "payment").toUpperCase()}</p><p className="mt-1 text-xs text-muted-foreground">{formatDateTime(row.paidAt ?? row.paid_at ?? row.createdAt ?? row.created_at)} {row.reversed_at || row.reversedAt ? `• ${t("customers.detail.reversed")}` : ""}</p></div><div className="grid grid-cols-2 gap-2 sm:flex"><Button size="sm" variant="outline" onClick={() => { const ok = printPaymentReceipt(customer.name, customer.mobile, row, customer.ledgerBalance, t); if (!ok) toast({ title: t("customers.toast.printBlocked"), variant: "destructive" }); }}><FileText size={13} className="mr-1" />{t("customers.account.receipt")}</Button>{!row.reversed_at && !row.reversedAt && row.derived_from_ledger !== true ? <Button size="sm" variant="outline" onClick={() => { if (!reversePaymentPermission.allowed) { toast({ title: t("customers.toast.permissionDenied"), description: reversePaymentPermission.reason, variant: "destructive" }); return; } setReverse({ paymentId: String(row.id) }); setReverseOpen(true); }}><RotateCcw size={13} className="mr-1" />{t("customers.account.reverse")}</Button> : <Badge variant="secondary" className="min-h-11 justify-center">{row.derived_from_ledger === true && !row.reversed_at && !row.reversedAt ? t("customers.tab.ledger") : t("customers.detail.reversed")}</Badge>}</div></div></div>)}
              {payments.length === 0 ? <p className="text-sm text-muted-foreground">{t("customers.account.noPayments")}</p> : null}
              {activePayments.length === 0 && payments.length > 0 ? <p className="text-xs text-muted-foreground">{t("customers.account.allReversed")}</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("customers.account.customerPricing")}</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">{customer.notes || t("customers.notes.noPricing")}</CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}><DialogContent className="max-h-[92vh] max-w-md gap-0 overflow-y-auto border-0 bg-[#f8faff] p-0 shadow-2xl sm:rounded-[22px]"><DialogHeader className="bg-[linear-gradient(135deg,var(--brand),var(--brand-strong))] px-5 pb-5 pt-6 text-left text-white"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/70">{customer.name}</p><DialogTitle className="mt-1 pr-12 text-xl font-black">{t("customers.account.recordPayment")}</DialogTitle><div className="mt-4 rounded-[14px] border border-white/20 bg-white/10 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-white/70">{t("customers.account.currentUdhar")}</p><p className="mt-1 text-2xl font-black">{formatMoney(Math.max(0, customer.ledgerBalance))}</p></div></DialogHeader><div className="space-y-4 p-5"><div><Label htmlFor="customer-detail-payment-amount">{t("customers.account.amountRequired")}</Label><Input id="customer-detail-payment-amount" autoFocus type="number" inputMode="decimal" min="0" step="0.01" max={Math.max(0, customer.ledgerBalance)} className="mt-1.5 h-12 rounded-xl bg-white text-lg font-black" value={payment.amount} onChange={(event) => setPayment((form) => ({ ...form, amount: event.target.value }))} /></div><div><Label>{t("customers.account.mode")}</Label><Select value={payment.mode} onValueChange={(value) => setPayment((form) => ({ ...form, mode: value as PaymentFormState["mode"] }))}><SelectTrigger className="mt-1.5 h-12 rounded-xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">{t("customers.account.modeCash")}</SelectItem><SelectItem value="upi">{t("customers.account.modeUpi")}</SelectItem><SelectItem value="bank">{t("customers.account.modeBank")}</SelectItem></SelectContent></Select></div><div><Label htmlFor="customer-detail-payment-note">{t("customers.account.note")}</Label><Input id="customer-detail-payment-note" className="mt-1.5 h-12 rounded-xl bg-white" value={payment.note} onChange={(event) => setPayment((form) => ({ ...form, note: event.target.value }))} /></div><p className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-medium leading-5 text-blue-800">{t("customers.toast.ledgerOffline")}</p></div><div className="sticky bottom-0 grid grid-cols-2 gap-3 border-t border-[#e3eaf4] bg-white/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur"><Button variant="outline" onClick={() => setPaymentOpen(false)}>{t("customers.account.cancel")}</Button><Button disabled={saving} onClick={() => void savePayment()}>{saving ? t("customers.detail.saving") : t("customers.detail.saveOffline")}</Button></div></DialogContent></Dialog>
      <OwnerPinModal
        open={reverseOpen}
        title={t("customers.detail.reversePayment")}
        description={t("customers.pinReversalPreserved")}
        confirmLabel={t("customers.detail.reversePayment")}
        reasonRequired
        loading={saving}
        onCancel={() => setReverseOpen(false)}
        onConfirm={({ ownerPin, reason }) => void saveReverse(ownerPin, reason)}
      />
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}><DialogContent className="max-h-[92vh] max-w-md"><DialogHeader><DialogTitle>{t("customers.account.manualAdjustment")}</DialogTitle></DialogHeader><div className="space-y-4"><p className="rounded-xl bg-amber-50 p-3 text-sm font-medium leading-5 text-amber-900">{t("customers.account.adjustmentHint")}</p><div><Label>{t("customers.account.amountRequired")}</Label><Input type="number" inputMode="decimal" step="0.01" className="mt-1" value={adjust.amount} onChange={(event) => setAdjust((form) => ({ ...form, amount: event.target.value }))} /></div><div><Label>{t("customers.account.ownerPinRequired")}</Label><Input type="password" inputMode="numeric" autoComplete="off" className="mt-1" value={adjust.ownerPin} onChange={(event) => setAdjust((form) => ({ ...form, ownerPin: event.target.value }))} /></div><div><Label>{t("customers.account.reason")}</Label><Textarea className="mt-1" value={adjust.note} onChange={(event) => setAdjust((form) => ({ ...form, note: event.target.value }))} /></div></div><div className="grid grid-cols-2 gap-2 pt-2"><Button variant="outline" onClick={() => setAdjustOpen(false)}>{t("customers.account.cancel")}</Button><Button disabled={saving} onClick={() => void saveAdjustment()}>{saving ? t("customers.detail.saving") : t("customers.detail.saveCorrection")}</Button></div></DialogContent></Dialog>
    </div>
  );
}
