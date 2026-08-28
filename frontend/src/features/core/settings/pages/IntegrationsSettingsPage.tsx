import { useAppLanguage, type Translate } from "@/features/core/settings/i18n";
import { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Check, CheckCircle2, Clock3, Cloud, Copy, Download, ExternalLink, KeyRound, Link2, Loader2, Plug, RefreshCcw, RotateCcw, Send, ShieldCheck, ShoppingBag, Trash2, Webhook } from "lucide-react";
import { apiRequest } from "@/lib/api/http";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { SettingsShell } from "@/features/core/settings/SettingsShell";
import { Badge, Card, CardHead, Fld, Kpi, type Tone } from "@/features/core/settings/ui";
import { loadPrinterConfig } from "@/features/core/settings/printer-config";
import { postTallyViaHardwareBridge, type TallyPostResult } from "@/features/core/hardware/local-hardware-bridge";
import type { ReactNode } from "react";
import { PaymentProviderConnectionsCard } from "@/features/core/settings/PaymentProviderConnectionsCard";
import { RestaurantMarketplaceConnectionsCard } from "@/features/core/settings/RestaurantMarketplaceConnectionsCard";

type ProviderStatus = "ready" | "available" | "setup_required" | "sandbox_only" | "adapter_required" | "development_only" | "upgrade_required";
type Provider = { id: string; name: string; category: string; status: ProviderStatus; detail: string };
type Delivery = { id: string; endpointId?: string; eventType: string; status: "pending" | "delivered" | "failed"; attemptCount?: number; httpStatus?: number | null; durationMs?: number | null; lastError?: string | null; createdAt: string; lastAttemptAt?: string | null };
type DeliveryPage = { items: Delivery[]; hasMore: boolean; nextCursor: string | null };
type Overview = { maturityScore: number; activeKeys: number; activeWebhooks: number; providers: Provider[]; recentDeliveries: Delivery[]; supportedEvents: string[] };
type ApiKeyRow = { id: string; name: string; keyPrefix: string; scopes: string[]; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string };
type WebhookRow = { id: string; name: string; url: string; events: string[]; enabled: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null; createdAt: string; _count: { deliveries: number } };
type NewSecret = { title: string; value: string; note: string };
type TallyDocument = { type: string; id: string; voucherNumber: string; remoteId: string };
type FlipkartStatus = { enabled: boolean; configured: boolean; boundToCurrentShop: boolean; officialDocuments: boolean; orderSyncConfigured: boolean; mappedLocations: number };
type FlipkartSyncIssue = { shipmentId: string; code: string; locationId?: string | null; missingSkus?: string[]; ambiguousSkus?: string[]; invalidSkus?: string[] };
type FlipkartSyncResult = { fetched: number; created: number; updated: number; unchanged: number; skipped: number; truncated: boolean; issues: FlipkartSyncIssue[]; omittedIssueCount: number };
type Approval = { title: string; description: string; confirmLabel: string; run: (pin: string) => Promise<void> };

const apiScopes = (t: Translate) => [
  { id: "catalog:read", label: t("settings.integrations.scope.catalog"), detail: t("settings.integrations.scope.catalogHelp") },
  { id: "customers:read", label: t("settings.integrations.scope.customers"), detail: t("settings.integrations.scope.customersHelp") },
  { id: "bills:read", label: t("settings.integrations.scope.bills"), detail: t("settings.integrations.scope.billsHelp") },
];

// Exporting sales alone leaves the accountant re-keying every purchase and
// collection, so all five are on by default and narrowing is deliberate.
const tallyBooks = (t: Translate) => [
  { id: "sales", label: t("settings.integrations.book.sales"), detail: t("settings.integrations.book.salesHelp") },
  { id: "purchases", label: t("settings.integrations.book.purchases"), detail: t("settings.integrations.book.purchasesHelp") },
  { id: "returns", label: t("settings.integrations.book.returns"), detail: t("settings.integrations.book.returnsHelp") },
  { id: "receipts", label: t("settings.integrations.book.receipts"), detail: t("settings.integrations.book.receiptsHelp") },
  { id: "expenses", label: t("settings.integrations.book.expenses"), detail: t("settings.integrations.book.expensesHelp") },
  { id: "production", label: t("settings.integrations.book.production"), detail: t("settings.integrations.book.productionHelp") },
];

const providerStatus = (t: Translate): Record<ProviderStatus, { label: string; tone: Tone }> => ({
  ready: { label: t("settings.integrations.status.ready"), tone: "green" },
  available: { label: t("settings.integrations.status.available"), tone: "blue" },
  setup_required: { label: t("settings.integrations.status.setupRequired"), tone: "amber" },
  sandbox_only: { label: t("settings.integrations.status.sandboxOnly"), tone: "violet" },
  adapter_required: { label: t("settings.integrations.status.adapterRequired"), tone: "amber" },
  development_only: { label: t("settings.integrations.status.developmentOnly"), tone: "red" },
  upgrade_required: { label: t("settings.integrations.status.upgradeRequired"), tone: "amber" },
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

function readableDate(value?: string | null) {
  if (!value) return null;
  return DATE_TIME_FORMAT.format(new Date(value));
}

function errorMessage(t: Translate, error: unknown) {
  return error instanceof Error ? error.message : t("settings.integrations.genericError");
}

function flipkartIssueText(t: Translate, issue: FlipkartSyncIssue) {
  if (issue.code === "LOCATION_UNMAPPED") return t("settings.integrations.flipkartIssueLocation", { location: issue.locationId || "—" });
  if (issue.code === "SKU_UNMAPPED") return t("settings.integrations.flipkartIssueSku", { skus: issue.missingSkus?.join(", ") || "—" });
  if (issue.code === "SKU_AMBIGUOUS") return t("settings.integrations.flipkartIssueAmbiguous", { skus: issue.ambiguousSkus?.join(", ") || "—" });
  if (issue.code === "ITEM_INVALID") return t("settings.integrations.flipkartIssueInvalid", { skus: issue.invalidSkus?.join(", ") || "—" });
  return t("settings.integrations.flipkartIssueOther", { code: issue.code });
}

function downloadText(filename: string, value: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isKeyExpired(key: ApiKeyRow) {
  return Boolean(key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now());
}

export default function IntegrationsSettingsPage() {
  const { t } = useAppLanguage();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [keyOpen, setKeyOpen] = useState(false);
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [keyName, setKeyName] = useState("Back-office integration");
  const [keyTtlDays, setKeyTtlDays] = useState("90");
  const [scopes, setScopes] = useState(["catalog:read"]);
  const [webhookName, setWebhookName] = useState("Primary endpoint");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [events, setEvents] = useState(["bill.created", "payment.recorded"]);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [secret, setSecret] = useState<NewSecret | null>(null);
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [tallyInventory, setTallyInventory] = useState(false);
  const [tallyDocs, setTallyDocs] = useState<string[]>(tallyBooks(t).map((document) => document.id));
  const [flipkartFrom, setFlipkartFrom] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [flipkartTo, setFlipkartTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [flipkartResult, setFlipkartResult] = useState<FlipkartSyncResult | null>(null);

  const overviewQ = useQuery({ queryKey: ["integrations", "overview"], queryFn: () => apiRequest<Overview>("/integrations/overview"), retry: 1 });
  const keysQ = useQuery({ queryKey: ["integrations", "keys"], queryFn: () => apiRequest<ApiKeyRow[]>("/integrations/api-keys"), retry: 1 });
  const webhooksQ = useQuery({ queryKey: ["integrations", "webhooks"], queryFn: () => apiRequest<WebhookRow[]>("/integrations/webhooks"), retry: 1 });
  const flipkartQ = useQuery({ queryKey: ["integrations", "flipkart", "status"], queryFn: () => apiRequest<FlipkartStatus>("/integrations/flipkart/status"), retry: 1 });
  const deliveriesQ = useInfiniteQuery({
    queryKey: ["integrations", "deliveries"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiRequest<DeliveryPage>(`/integrations/deliveries?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
    retry: 1,
  });
  const tallyM = useMutation({
    mutationFn: () => apiRequest<string>(`/integrations/exports/tally?from=${from}&to=${to}&inventory=${tallyInventory ? "1" : "0"}&include=${tallyDocs.join(",")}`),
    onSuccess: (xml) => { downloadText(`artha-tally-${from}-${to}.xml`, xml, "application/xml;charset=utf-8"); toast({ title: t("settings.integrations.tallyDownloaded"), description: t("settings.integrations.tallyDownloadedHelp") }); },
    onError: (error) => toast({ title: t("settings.integrations.exportFailed"), description: errorMessage(t, error), variant: "destructive" }),
  });

  /**
   * Send straight into the TallyPrime running on this counter.
   *
   * The order matters and is not interchangeable: ask only for what has not
   * been sent, let Tally accept it, and only then record it as sent. Recording
   * first would lose vouchers Tally never received; the way round it is, a
   * crash in between costs a re-send that Tally recognises by REMOTEID.
   */
  const tallyPushM = useMutation({
    mutationFn: async () => {
      const printer = await loadPrinterConfig();
      const envelope = await apiRequest<{ xml: string; count: number; skipped: number; documents: TallyDocument[] }>(
        `/integrations/exports/tally/envelope?from=${from}&to=${to}&inventory=${tallyInventory ? "1" : "0"}&include=${tallyDocs.join(",")}&unsent=1`,
      );
      if (envelope.count === 0) return { sent: 0, skipped: envelope.skipped, result: null as TallyPostResult | null };
      const result = await postTallyViaHardwareBridge(printer.bridgeUrl, envelope.xml);
      await apiRequest("/integrations/exports/tally/posted", { method: "POST", body: JSON.stringify({ documents: envelope.documents }) });
      return { sent: envelope.count, skipped: envelope.skipped, result };
    },
    onSuccess: ({ sent, skipped, result }) => {
      if (sent === 0) {
        toast({ title: t("settings.integrations.tallyUpToDate"), description: skipped > 0 ? `${skipped} voucher${skipped === 1 ? "" : "s"} in this range had already been sent.` : "Nothing new in this date range." });
        return;
      }
      const already = skipped > 0 ? ` ${skipped} already sent, skipped.` : "";
      toast({ title: `Sent ${sent} voucher${sent === 1 ? "" : "s"} to Tally`, description: `Tally created ${result?.created ?? 0} and updated ${result?.altered ?? 0}.${already}` });
    },
    onError: (error) => toast({ title: t("settings.integrations.tallySendFailed"), description: errorMessage(t, error), variant: "destructive" }),
  });

  const overview = overviewQ.data;
  const developerPlanEnabled = Boolean(overview) && overview?.providers.find((provider) => provider.id === "api")?.status !== "upgrade_required";
  const tallyPlanEnabled = Boolean(overview) && overview?.providers.find((provider) => provider.id === "tally")?.status !== "upgrade_required";
  const flipkartReady = Boolean(flipkartQ.data?.orderSyncConfigured && developerPlanEnabled);
  const flipkartRangeDays = flipkartFrom && flipkartTo ? Math.floor((new Date(`${flipkartTo}T00:00:00Z`).getTime() - new Date(`${flipkartFrom}T00:00:00Z`).getTime()) / 86400000) + 1 : 0;
  const flipkartRangeValid = flipkartRangeDays >= 1 && flipkartRangeDays <= 31;
  const activeKeys = developerPlanEnabled ? (keysQ.data ?? []).filter((key) => !key.revokedAt && !isKeyExpired(key)) : [];
  const activeWebhooks = developerPlanEnabled ? (webhooksQ.data ?? []).filter((endpoint) => endpoint.enabled) : [];
  const deliveries = useMemo(() => deliveriesQ.data?.pages.flatMap((page) => page.items) ?? [], [deliveriesQ.data]);
  const delivered = deliveries.filter((item) => item.status === "delivered").length;
  const failed = deliveries.filter((item) => item.status === "failed").length;
  const deliveryRate = delivered + failed ? Math.round((delivered / (delivered + failed)) * 100) : null;
  const lastActivity = useMemo(() => {
    const sorted = deliveries.map((item) => item.lastAttemptAt || item.createdAt).sort();
    return sorted.length ? sorted[sorted.length - 1] : undefined;
  }, [deliveries]);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    toast({ title: t("settings.integrations.statusRefreshed") });
  }

  function requestApproval(next: Approval) {
    setApprovalError(null);
    setApproval(next);
  }

  async function confirmApproval(ownerPin: string) {
    if (!approval) return;
    setApproving(true);
    setApprovalError(null);
    try {
      await approval.run(ownerPin);
      setApproval(null);
      await queryClient.invalidateQueries({ queryKey: ["integrations"] });
    } catch (error) { setApprovalError(errorMessage(t, error)); }
    finally { setApproving(false); }
  }

  function createKey() {
    if (keyName.trim().length < 2 || !scopes.length) return toast({ title: t("settings.integrations.nameAndScope"), variant: "destructive" });
    setKeyOpen(false);
    requestApproval({ title: t("settings.integrations.approveCreateKey"), description: t("settings.integrations.approveCreateKeyHelp"), confirmLabel: t("settings.integrations.createSecureKey"), run: async (ownerPin) => {
      const ttlDays = Number(keyTtlDays);
      const expiresAt = ttlDays > 0 ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString() : null;
      const result = await apiRequest<ApiKeyRow & { secret: string }>("/integrations/api-keys", { method: "POST", ownerPin, body: JSON.stringify({ name: keyName.trim(), scopes, expiresAt }) });
      setSecret({ title: t("settings.integrations.keyCreatedTitle"), value: result.secret, note: t("settings.integrations.copyKeyNow") });
      toast({ title: t("settings.integrations.keyCreated") });
    } });
  }

  function createWebhook() {
    if (webhookName.trim().length < 2 || !webhookUrl.trim() || !events.length) return toast({ title: t("settings.integrations.completeEndpoint"), variant: "destructive" });
    setWebhookOpen(false);
    requestApproval({ title: t("settings.integrations.approveCreateWebhook"), description: t("settings.integrations.approveCreateWebhookHelp"), confirmLabel: t("settings.integrations.createEndpoint"), run: async (ownerPin) => {
      const result = await apiRequest<WebhookRow & { secret: string }>("/integrations/webhooks", { method: "POST", ownerPin, body: JSON.stringify({ name: webhookName.trim(), url: webhookUrl.trim(), events }) });
      setSecret({ title: t("settings.integrations.webhookSecretTitle"), value: result.secret, note: t("settings.integrations.verifySignature") });
      setWebhookUrl("");
      toast({ title: t("settings.integrations.webhookCreated") });
    } });
  }

  function syncFlipkart() {
    if (!flipkartReady || !flipkartRangeValid) return;
    requestApproval({
      title: t("settings.integrations.flipkartApproveTitle"),
      description: t("settings.integrations.flipkartApproveHelp", { from: flipkartFrom, to: flipkartTo }),
      confirmLabel: t("settings.integrations.flipkartSyncAction"),
      run: async (ownerPin) => {
        const result = await apiRequest<FlipkartSyncResult>("/integrations/flipkart/orders/sync", {
          method: "POST",
          ownerPin,
          body: JSON.stringify({ from: flipkartFrom, to: flipkartTo, maxShipments: 100 }),
        });
        setFlipkartResult(result);
        await queryClient.invalidateQueries({ queryKey: ["orders"] });
        toast({
          title: t("settings.integrations.flipkartSyncComplete"),
          description: t("settings.integrations.flipkartSyncSummary", { created: result.created, updated: result.updated, skipped: result.skipped }),
        });
      },
    });
  }

  function protectedAction(action: "revoke" | "delete" | "test" | "retry" | "toggle", id: string, enabled?: boolean) {
    const config = {
      revoke: ["Revoke API key", "Existing clients using this key will immediately lose access.", "Revoke key", `/integrations/api-keys/${id}`, "DELETE", undefined],
      delete: ["Archive webhook endpoint", "New deliveries will stop, while historical delivery evidence remains available for audit.", "Archive endpoint", `/integrations/webhooks/${id}`, "DELETE", undefined],
      test: ["Send webhook test", "A signed integration.test event will be sent and recorded in delivery history.", "Send test", `/integrations/webhooks/${id}/test`, "POST", undefined],
      retry: ["Retry webhook delivery", "The original event id and payload will be sent again with a new signature timestamp.", "Retry delivery", `/integrations/deliveries/${id}/retry`, "POST", undefined],
      toggle: [enabled ? "Pause webhook" : "Enable webhook", enabled ? "No events will be delivered until this endpoint is enabled again." : "New matching events can be delivered to this endpoint.", enabled ? "Pause endpoint" : "Enable endpoint", `/integrations/webhooks/${id}`, "PATCH", JSON.stringify({ enabled: !enabled })],
    }[action] as [string, string, string, string, string, string | undefined];
    requestApproval({ title: config[0], description: config[1], confirmLabel: config[2], run: async (ownerPin) => {
      const result = await apiRequest<Delivery | { revoked?: boolean; deleted?: boolean }>(config[3], { method: config[4], ownerPin, body: config[5] });
      if ("status" in result) toast({ title: result.status === "delivered" ? "Webhook delivered" : "Webhook attempt recorded", description: result.status === "failed" ? "Open delivery activity for the failure details." : undefined });
      else toast({ title: `${config[0]} complete` });
    } });
  }

  if (overviewQ.isLoading && keysQ.isLoading) return <SettingsShell><div className="grid min-h-[420px] place-items-center rounded-[14px] border border-[#e7edf7] bg-white"><div className="text-center"><Loader2 className="mx-auto animate-spin text-[var(--brand)]" /><p className="mt-3 text-sm font-bold text-[#344668]">{t("settings.integrations.loading")}</p></div></div></SettingsShell>;

  if (overviewQ.isError) return <SettingsShell><Card><div className="flex flex-col items-center px-6 py-14 text-center"><AlertTriangle className="text-amber-500" /><p className="mt-3 font-bold text-[var(--brand-ink)]">{t("settings.integrations.notReady")}</p><p className="mt-1 max-w-md text-sm text-[#64748b]">{t("settings.integrations.migrationHint", { reason: errorMessage(t, overviewQ.error) })}</p><Button className="mt-5" variant="outline" onClick={refresh}><RefreshCcw size={14} /> {t("settings.integrations.retry")}</Button></div></Card></SettingsShell>;

  return (
    <SettingsShell>
      <Card className="relative overflow-hidden border-[#dfe8f7] bg-[linear-gradient(135deg,#07152f_0%,#0e2c63_58%,#075d68_100%)] text-white shadow-[0_18px_45px_rgba(7,25,61,0.18)]">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="relative grid gap-6 p-6 md:grid-cols-[1fr_270px] md:items-center">
          <div><Badge tone="blue" className="bg-white/10 text-cyan-100"><ShieldCheck size={12} /> {t("settings.integrations.eyebrow")}</Badge><h2 className="mt-3 font-display text-2xl font-black tracking-tight">{t("settings.integrations.title")}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{t("settings.integrations.subtitle")}</p><div className="mt-4 flex flex-wrap gap-2"><Badge className="bg-emerald-400/15 text-emerald-200"><Check size={11} /> {t("settings.integrations.tenantIsolated")}</Badge><Badge className="bg-cyan-400/15 text-cyan-100"><Check size={11} /> {t("settings.integrations.hmacSigned")}</Badge><Badge className="bg-violet-400/15 text-violet-100"><Check size={11} /> {t("settings.integrations.auditLogged")}</Badge></div></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur"><div className="flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{t("settings.integrations.readiness")}</p><p className="mt-1 font-display text-4xl font-black">{overview?.maturityScore ?? 0}<span className="text-lg text-slate-400">/100</span></p></div><Cloud className="text-cyan-300" /></div><Progress className="mt-4 bg-white/10 [&>div]:bg-cyan-300" value={overview?.maturityScore ?? 0} /><p className="mt-3 text-[11px] leading-5 text-slate-300">{t("settings.integrations.readinessHelp")}</p></div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("settings.integrations.kpiKeys")} value={activeKeys.length} sub={developerPlanEnabled ? t("settings.integrations.kpiKeysSub") : t("settings.integrations.planSuspended")} tone={developerPlanEnabled ? "blue" : "amber"} icon={<KeyRound size={15} />} />
        <Kpi label={t("settings.integrations.kpiWebhooks")} value={activeWebhooks.length} sub={developerPlanEnabled ? `${webhooksQ.data?.length ?? 0} total configured` : t("settings.integrations.planSuspended")} tone={developerPlanEnabled ? "violet" : "amber"} icon={<Webhook size={15} />} />
        <Kpi label={t("settings.integrations.kpiDelivery")} value={deliveryRate === null ? "—" : `${deliveryRate}%`} sub={deliveryRate === null ? t("settings.integrations.noAttempts") : `${delivered} delivered · ${failed} failed`} tone={failed ? "amber" : "green"} icon={<Activity size={15} />} />
        <Kpi label={t("settings.integrations.kpiActivity")} value={readableDate(lastActivity)?.split(",")[0] ?? "—"} sub={readableDate(lastActivity) ?? t("settings.integrations.noEvents")} tone="gray" icon={<Clock3 size={15} />} />
      </div>

      <Card>
        <CardHead icon={<Plug size={15} />} title={t("settings.integrations.providersTitle")} sub={t("settings.integrations.providersSub")} action={<Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs font-bold text-[var(--brand)]" onClick={refresh}><RefreshCcw size={13} /> {t("settings.integrations.refresh")}</Button>} />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
          {(overview?.providers ?? []).map((provider) => { const status = providerStatus(t)[provider.status]; return <div key={provider.id} className="group rounded-xl border border-[#e4ebf6] bg-[linear-gradient(180deg,#fff,#fbfdff)] p-4 transition hover:-translate-y-0.5 hover:border-[#cbdaf2] hover:shadow-[0_10px_25px_rgba(20,55,110,.08)]"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><Plug size={17} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-[var(--brand-ink)]">{provider.name}</p><Badge tone={status.tone}>{status.label}</Badge></div><p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-[#9aa6bb]">{provider.category}</p><p className="mt-2 text-xs leading-5 text-[#64748b]">{provider.detail}</p></div></div></div>; })}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHead icon={<KeyRound size={15} />} title={t("settings.integrations.keysTitle")} sub={t("settings.integrations.keysSub")} action={<Button size="sm" className="h-8 gap-1.5 rounded-lg text-xs font-bold" disabled={!developerPlanEnabled} title={developerPlanEnabled ? undefined : t("settings.integrations.upgradeForKeys")} onClick={() => setKeyOpen(true)}><KeyRound size={13} /> {t("settings.integrations.createKey")}</Button>} />
          <div className="space-y-2 px-5 pb-5">
            {keysQ.isLoading ? <LoadingRows /> : keysQ.isError ? <QueryFailure message={errorMessage(t, keysQ.error)} retry={() => void keysQ.refetch()} /> : (keysQ.data?.length ? keysQ.data.map((key) => { const expired = isKeyExpired(key); const planLocked = !developerPlanEnabled && !key.revokedAt && !expired; const inactive = Boolean(key.revokedAt) || expired || planLocked; return <div key={key.id} className={`rounded-xl border p-3.5 ${inactive ? "border-[#edf0f5] bg-[#f8fafc] opacity-70" : "border-[#e4ebf6]"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[var(--brand-ink)]">{key.name}</p><Badge tone={key.revokedAt ? "gray" : expired || planLocked ? "amber" : "green"}>{key.revokedAt ? t("settings.integrations.keyRevoked") : expired ? t("settings.integrations.keyExpired") : planLocked ? t("settings.integrations.planLocked") : t("settings.integrations.keyActive")}</Badge></div><p className="mt-1 font-mono text-xs text-[#64748b]">{key.keyPrefix}••••••••</p></div>{!key.revokedAt && <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500 hover:bg-rose-50" aria-label={`Revoke ${key.name}`} onClick={() => protectedAction("revoke", key.id)}><Trash2 size={14} /></Button>}</div><div className="mt-3 flex flex-wrap gap-1.5">{key.scopes.map((scope) => <Badge key={scope} tone="blue">{scope}</Badge>)}</div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#94a3b8]"><span>{t("settings.integrations.createdOn", { when: readableDate(key.createdAt) ?? t("settings.integrations.neverValue") })}</span><span>{t("settings.integrations.expiresOn", { when: (key.expiresAt ? readableDate(key.expiresAt) : null) ?? t("settings.integrations.neverValue") })}</span><span>{t("settings.integrations.lastUsed", { when: readableDate(key.lastUsedAt) ?? t("settings.integrations.neverValue") })}</span></div></div>; }) : <Empty icon={<KeyRound size={18} />} title={t("settings.integrations.noKeys")} detail={t("settings.integrations.noKeysHelp")} />)}
          </div>
        </Card>

        <Card>
          <CardHead icon={<Webhook size={15} />} title={t("settings.integrations.kpiWebhooks")} sub={t("settings.integrations.webhooksSub")} action={<Button size="sm" className="h-8 gap-1.5 rounded-lg text-xs font-bold" disabled={!developerPlanEnabled} title={developerPlanEnabled ? undefined : t("settings.integrations.upgradeForWebhooks")} onClick={() => setWebhookOpen(true)}><Link2 size={13} /> {t("settings.integrations.addEndpoint")}</Button>} />
          <div className="space-y-2 px-5 pb-5">
            {webhooksQ.isLoading ? <LoadingRows /> : webhooksQ.isError ? <QueryFailure message={errorMessage(t, webhooksQ.error)} retry={() => void webhooksQ.refetch()} /> : (webhooksQ.data?.length ? webhooksQ.data.map((endpoint) => <div key={endpoint.id} className="rounded-xl border border-[#e4ebf6] p-3.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[var(--brand-ink)]">{endpoint.name}</p><Badge tone={!developerPlanEnabled ? "amber" : endpoint.enabled ? endpoint.lastError ? "amber" : "green" : "gray"}>{!developerPlanEnabled ? t("settings.integrations.planLocked") : endpoint.enabled ? endpoint.lastError ? t("settings.integrations.hookAttention") : t("settings.integrations.hookEnabled") : t("settings.integrations.hookPaused")}</Badge></div><p className="mt-1 truncate font-mono text-xs text-[#64748b]" title={endpoint.url}>{endpoint.url}</p></div><div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" className="h-8 w-8 text-[var(--brand)]" disabled={!developerPlanEnabled} aria-label={`Test ${endpoint.name}`} onClick={() => protectedAction("test", endpoint.id)}><Send size={14} /></Button><Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600" disabled={!developerPlanEnabled} aria-label={endpoint.enabled ? `Pause ${endpoint.name}` : `Enable ${endpoint.name}`} onClick={() => protectedAction("toggle", endpoint.id, endpoint.enabled)}>{endpoint.enabled ? <Clock3 size={14} /> : <CheckCircle2 size={14} />}</Button><Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" aria-label={`Archive ${endpoint.name}`} onClick={() => protectedAction("delete", endpoint.id)}><Trash2 size={14} /></Button></div></div><div className="mt-3 flex flex-wrap gap-1.5">{endpoint.events.map((event) => <Badge key={event} tone="violet">{event}</Badge>)}</div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#94a3b8]"><span>{t("settings.integrations.deliveryCount", { count: endpoint._count.deliveries })}</span><span>{t("settings.integrations.lastSuccess", { when: readableDate(endpoint.lastSuccessAt) ?? t("settings.integrations.neverValue") })}</span></div>{endpoint.lastError && <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">{endpoint.lastError}</p>}</div>) : <Empty icon={<Webhook size={18} />} title={t("settings.integrations.noWebhooks")} detail={t("settings.integrations.noWebhooksHelp")} />)}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <Card>
          <CardHead icon={<Activity size={15} />} title={t("settings.integrations.activityTitle")} sub={t("settings.integrations.activitySub")} />
          <div className="px-5 pb-5">
            {deliveriesQ.isLoading ? <LoadingRows /> : deliveriesQ.isError ? <QueryFailure message={errorMessage(t, deliveriesQ.error)} retry={() => void deliveriesQ.refetch()} /> : deliveries.length ? <div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left"><thead><tr className="border-b border-[#e8edf5] text-[10px] font-bold uppercase tracking-wider text-[#94a3b8]"><th className="pb-2">{t("settings.integrations.event")}</th><th className="pb-2">{t("settings.integrations.status")}</th><th className="pb-2">{t("settings.integrations.http")}</th><th className="pb-2">{t("settings.integrations.latency")}</th><th className="pb-2">{t("settings.integrations.attempted")}</th><th className="pb-2 text-right">{t("settings.integrations.action")}</th></tr></thead><tbody>{deliveries.map((item) => <tr key={item.id} className="border-b border-[#f0f3f8] text-xs last:border-0"><td className="py-3"><p className="font-mono font-semibold text-[#344668]">{item.eventType}</p>{item.lastError && <p className="mt-1 max-w-[260px] truncate text-[10px] font-medium text-rose-600" title={item.lastError}>{item.lastError}</p>}</td><td className="py-3"><Badge tone={item.status === "delivered" ? "green" : item.status === "failed" ? "red" : "amber"}>{item.status}</Badge></td><td className="py-3 text-[#64748b]">{item.httpStatus ?? "—"}</td><td className="py-3 text-[#64748b]">{item.durationMs == null ? "—" : `${item.durationMs} ms`}</td><td className="py-3 text-[#64748b]">{readableDate(item.lastAttemptAt || item.createdAt)}</td><td className="py-3 text-right">{item.status === "failed" && <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px] font-bold text-[var(--brand)]" onClick={() => protectedAction("retry", item.id)}><RotateCcw size={12} /> {t("settings.integrations.retry")}</Button>}</td></tr>)}</tbody></table></div>{deliveriesQ.hasNextPage && <div className="mt-3 flex justify-center"><Button variant="outline" size="sm" disabled={deliveriesQ.isFetchingNextPage} onClick={() => void deliveriesQ.fetchNextPage()}>{deliveriesQ.isFetchingNextPage ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />} Load older deliveries</Button></div>}</div> : <Empty icon={<Activity size={18} />} title={t("settings.integrations.noDeliveries")} detail={t("settings.integrations.noDeliveriesHelp")} />}
          </div>
        </Card>

        <Card>
          <CardHead icon={<Download size={15} />} title={t("settings.integrations.tallyTitle")} sub={t("settings.integrations.tallySub")} action={<Badge tone={tallyPlanEnabled ? "green" : "amber"}>{tallyPlanEnabled ? t("settings.integrations.tallyOperational") : t("settings.integrations.tallyProPlan")}</Badge>} />
          <div className="space-y-4 px-5 pb-5"><div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-xs leading-5 text-emerald-900"><div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0" /><p>{tallyPlanEnabled ? t("settings.integrations.tallyReady") : t("settings.integrations.tallyLocked")}</p></div></div><div className="grid grid-cols-2 gap-3"><Fld label={t("inventory.transfers.from")}><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Fld><Fld label={t("settings.integrations.dateTo")}><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Fld></div><div><p className="mb-1.5 text-[12px] font-semibold text-[#45577a]">{t("settings.integrations.booksToExport")}</p><div className="grid gap-2 sm:grid-cols-2">{tallyBooks(t).map((document) => <label key={document.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[#e4ebf6] p-2.5"><Checkbox checked={tallyDocs.includes(document.id)} disabled={!tallyPlanEnabled} onCheckedChange={(checked) => setTallyDocs((current) => checked ? [...new Set([...current, document.id])] : current.filter((item) => item !== document.id))} /><span><span className="block text-xs font-bold text-[var(--brand-ink)]">{document.label}</span><span className="block text-[11px] leading-4 text-[#64748b]">{document.detail}</span></span></label>)}</div></div><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#e4ebf6] p-3"><Checkbox checked={tallyInventory} onCheckedChange={(checked) => setTallyInventory(checked === true)} disabled={!tallyPlanEnabled || !tallyDocs.includes("sales")} /><span><span className="block text-sm font-bold text-[var(--brand-ink)]">{t("settings.integrations.includeStock")}</span><span className="block text-xs leading-5 text-[#64748b]">{t("settings.integrations.includeStockHelp")}</span></span></label><div className="grid gap-2 sm:grid-cols-2"><Button className="w-full gap-2" disabled={!tallyPlanEnabled || tallyPushM.isPending || tallyM.isPending || !from || !to || from > to || tallyDocs.length === 0} onClick={() => tallyPushM.mutate()}>{tallyPushM.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {tallyPushM.isPending ? t("settings.integrations.sendingToTally") : t("settings.integrations.sendToTally")}</Button><Button variant="outline" className="w-full gap-2" disabled={!tallyPlanEnabled || tallyM.isPending || tallyPushM.isPending || !from || !to || from > to || tallyDocs.length === 0} onClick={() => tallyM.mutate()}>{tallyM.isPending ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} {tallyPlanEnabled ? t("settings.integrations.downloadXml") : t("settings.integrations.upgradeToExport")}</Button></div><p className="text-[11px] leading-4 text-[#64748b]">{t("settings.integrations.sendVsDownload")}</p><a className="inline-flex items-center gap-1 text-xs font-bold text-[var(--brand)] hover:underline" href="https://help.tallysolutions.com/import-data-in-tallyprime/" target="_blank" rel="noreferrer">{t("settings.integrations.tallyInstructions")} <ExternalLink size={12} /></a></div>
        </Card>
      </div>

      <Card>
        <CardHead
          icon={<ShoppingBag size={15} />}
          title={t("settings.integrations.flipkartTitle")}
          sub={t("settings.integrations.flipkartSub")}
          action={<Badge tone={flipkartReady ? "green" : "amber"}>{flipkartReady ? t("settings.integrations.flipkartConnected") : developerPlanEnabled ? t("settings.integrations.flipkartSetupRequired") : t("settings.integrations.tallyProPlan")}</Badge>}
        />
        <div className="grid gap-5 px-5 pb-5 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-4">
            <div className={`rounded-xl border p-3 text-xs leading-5 ${flipkartReady ? "border-emerald-100 bg-emerald-50/60 text-emerald-900" : "border-amber-100 bg-amber-50/70 text-amber-900"}`}>
              <div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0" /><p>{flipkartReady ? t("settings.integrations.flipkartReady", { count: flipkartQ.data?.mappedLocations ?? 0 }) : t("settings.integrations.flipkartNotReady")}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Fld label={t("inventory.transfers.from")}><Input type="date" value={flipkartFrom} onChange={(event) => setFlipkartFrom(event.target.value)} /></Fld>
              <Fld label={t("settings.integrations.dateTo")}><Input type="date" value={flipkartTo} onChange={(event) => setFlipkartTo(event.target.value)} /></Fld>
            </div>
            {!flipkartRangeValid && <p className="text-xs font-semibold text-rose-600">{t("settings.integrations.flipkartRangeInvalid")}</p>}
            <Button className="w-full gap-2" disabled={!flipkartReady || !flipkartRangeValid || approving} onClick={syncFlipkart}>
              {approving && approval?.title === t("settings.integrations.flipkartApproveTitle") ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />}
              {t("settings.integrations.flipkartSyncAction")}
            </Button>
            <p className="text-[11px] leading-5 text-[#64748b]">{t("settings.integrations.flipkartSafetyHelp")}</p>
            <a className="inline-flex items-center gap-1 text-xs font-bold text-[var(--brand)] hover:underline" href="https://seller.flipkart.com/api-docs/order-api-docs/OMAPIOverview.html" target="_blank" rel="noreferrer">{t("settings.integrations.flipkartDocs")} <ExternalLink size={12} /></a>
          </div>

          <div className="rounded-xl border border-[#e4ebf6] bg-[#fbfcfe] p-4">
            {!flipkartResult ? <Empty icon={<ShoppingBag size={18} />} title={t("settings.integrations.flipkartNoRun")} detail={t("settings.integrations.flipkartNoRunHelp")} /> : <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  [t("settings.integrations.flipkartFetched"), flipkartResult.fetched, "text-slate-700"],
                  [t("settings.integrations.flipkartCreated"), flipkartResult.created, "text-emerald-700"],
                  [t("settings.integrations.flipkartUpdated"), flipkartResult.updated, "text-blue-700"],
                  [t("settings.integrations.flipkartUnchanged"), flipkartResult.unchanged, "text-slate-600"],
                  [t("settings.integrations.flipkartSkipped"), flipkartResult.skipped, flipkartResult.skipped ? "text-amber-700" : "text-slate-600"],
                ].map(([label, value, tone]) => <div key={String(label)} className="rounded-lg border border-[#e6ebf3] bg-white p-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-[#94a3b8]">{label}</p><p className={`mt-1 text-xl font-black ${tone}`}>{value}</p></div>)}
              </div>
              {flipkartResult.truncated && <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{t("settings.integrations.flipkartTruncated")}</p>}
              {flipkartResult.issues.length > 0 ? <div><p className="text-xs font-bold text-[var(--brand-ink)]">{t("settings.integrations.flipkartReviewTitle")}</p><div className="mt-2 space-y-2">{flipkartResult.issues.slice(0, 5).map((issue) => <div key={`${issue.shipmentId}-${issue.code}`} className="flex items-start gap-2 rounded-lg border border-amber-100 bg-white px-3 py-2 text-xs"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" /><div><p className="font-mono font-bold text-[#344668]">{issue.shipmentId}</p><p className="mt-0.5 leading-5 text-[#64748b]">{flipkartIssueText(t, issue)}</p></div></div>)}</div>{flipkartResult.issues.length > 5 || flipkartResult.omittedIssueCount > 0 ? <p className="mt-2 text-[11px] text-[#64748b]">{t("settings.integrations.flipkartMoreIssues", { count: Math.max(0, flipkartResult.issues.length - 5) + flipkartResult.omittedIssueCount })}</p> : null}</div> : <div className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 size={14} className="mt-0.5 shrink-0" /><p>{t("settings.integrations.flipkartNoIssues")}</p></div>}
            </div>}
          </div>
        </div>
      </Card>

      <PaymentProviderConnectionsCard />
      <RestaurantMarketplaceConnectionsCard />

      <Dialog open={keyOpen} onOpenChange={setKeyOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{t("settings.integrations.createScopedKey")}</DialogTitle><DialogDescription>{t("settings.integrations.createScopedKeyHelp")}</DialogDescription></DialogHeader><div className="space-y-4"><Fld label={t("settings.integrations.credentialName")}><Input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder={t("settings.integrations.credentialNamePlaceholder")} /></Fld><Fld label={t("settings.integrations.autoExpiry")} hint={t("settings.integrations.autoExpiryHelp")}><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={keyTtlDays} onChange={(event) => setKeyTtlDays(event.target.value)}><option value="30">{t("settings.integrations.days30")}</option><option value="90">{t("settings.integrations.days90")}</option><option value="365">{t("settings.integrations.year1")}</option><option value="0">{t("settings.integrations.neverValue")}</option></select></Fld><div><p className="mb-1.5 text-[12px] font-semibold text-[#45577a]">{t("settings.integrations.permissions")}</p><div className="space-y-2">{apiScopes(t).map((scope) => <label key={scope.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#e4ebf6] p-3"><Checkbox checked={scopes.includes(scope.id)} onCheckedChange={(checked) => setScopes((current) => checked ? [...new Set([...current, scope.id])] : current.filter((item) => item !== scope.id))} /><span><span className="block text-sm font-bold text-[var(--brand-ink)]">{scope.label}</span><span className="block text-xs text-[#64748b]">{scope.detail}</span></span></label>)}</div></div></div><DialogFooter><Button variant="outline" onClick={() => setKeyOpen(false)}>{t("settings.integrations.cancel")}</Button><Button onClick={createKey}>{t("settings.integrations.continueSecurely")}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={webhookOpen} onOpenChange={setWebhookOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{t("settings.integrations.addWebhook")}</DialogTitle><DialogDescription>{t("settings.integrations.addWebhookHelp")}</DialogDescription></DialogHeader><div className="space-y-4"><Fld label={t("settings.integrations.endpointName")}><Input value={webhookName} onChange={(event) => setWebhookName(event.target.value)} /></Fld><Fld label={t("settings.integrations.httpsUrl")}><Input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/webhooks/kiranaos" /></Fld><div><p className="mb-1.5 text-[12px] font-semibold text-[#45577a]">{t("settings.integrations.events")}</p><div className="grid gap-2 sm:grid-cols-2">{(overview?.supportedEvents ?? []).filter((event) => event !== "integration.test").map((event) => <label key={event} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#e4ebf6] p-2.5 font-mono text-xs text-[#344668]"><Checkbox checked={events.includes(event)} onCheckedChange={(checked) => setEvents((current) => checked ? [...new Set([...current, event])] : current.filter((item) => item !== event))} />{event}</label>)}</div></div></div><DialogFooter><Button variant="outline" onClick={() => setWebhookOpen(false)}>{t("settings.integrations.cancel")}</Button><Button onClick={createWebhook}>{t("settings.integrations.continueSecurely")}</Button></DialogFooter></DialogContent></Dialog>

      <OwnerPinModal open={Boolean(approval)} title={approval?.title ?? t("settings.integrations.approveAction")} description={approval?.description} confirmLabel={approval?.confirmLabel} loading={approving} error={approvalError} onCancel={() => { if (!approving) setApproval(null); }} onConfirm={({ ownerPin }) => confirmApproval(ownerPin)} />

      <Dialog open={Boolean(secret)} onOpenChange={(open) => { if (!open) setSecret(null); }}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck size={18} className="text-emerald-600" />{secret?.title}</DialogTitle><DialogDescription>{secret?.note}</DialogDescription></DialogHeader><div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="break-all font-mono text-sm font-semibold leading-6 text-amber-950">{secret?.value}</p></div><DialogFooter><Button variant="outline" className="gap-2" onClick={() => { if (secret?.value) void navigator.clipboard.writeText(secret.value); toast({ title: t("settings.integrations.secretCopied") }); }}><Copy size={14} /> {t("settings.integrations.copySecret")}</Button><Button onClick={() => setSecret(null)}>{t("settings.integrations.savedIt")}</Button></DialogFooter></DialogContent></Dialog>
    </SettingsShell>
  );
}

function LoadingRows() { return <div className="space-y-2">{[1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-[#f2f5fa]" />)}</div>; }
function Empty({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) { return <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-[#d8e1ef] bg-[#fbfcfe] p-6 text-center"><div><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#edf3fb] text-[#64748b]">{icon}</span><p className="mt-2 text-sm font-bold text-[#344668]">{title}</p><p className="mt-1 max-w-sm text-xs leading-5 text-[#94a3b8]">{detail}</p></div></div>; }
function QueryFailure({ message, retry }: { message: string; retry: () => void }) {
  const { t } = useAppLanguage();
  return <div className="rounded-xl border border-rose-100 bg-rose-50/70 p-4"><div className="flex items-start gap-3"><AlertTriangle size={17} className="mt-0.5 shrink-0 text-rose-500" /><div className="min-w-0 flex-1"><p className="text-sm font-bold text-rose-900">{t("settings.integrations.loadFailed")}</p><p className="mt-1 break-words text-xs leading-5 text-rose-700">{message}</p></div><Button variant="outline" size="sm" className="h-8 shrink-0 gap-1 bg-white text-xs" onClick={retry}><RefreshCcw size={12} /> {t("settings.integrations.retry")}</Button></div></div>;
}
