import { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Check, CheckCircle2, Clock3, Cloud, Copy, Download, ExternalLink, KeyRound, Link2, Loader2, Plug, RefreshCcw, RotateCcw, Send, ShieldCheck, Trash2, Webhook } from "lucide-react";
import { apiRequest } from "@/lib/api/http";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { useToast } from "@/hooks/use-toast";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Badge, Card, CardHead, Fld, Kpi, type Tone } from "@/features/settings/ui";
import type { ReactNode } from "react";

type ProviderStatus = "ready" | "available" | "setup_required" | "sandbox_only" | "adapter_required" | "development_only" | "upgrade_required";
type Provider = { id: string; name: string; category: string; status: ProviderStatus; detail: string };
type Delivery = { id: string; endpointId?: string; eventType: string; status: "pending" | "delivered" | "failed"; attemptCount?: number; httpStatus?: number | null; durationMs?: number | null; lastError?: string | null; createdAt: string; lastAttemptAt?: string | null };
type DeliveryPage = { items: Delivery[]; hasMore: boolean; nextCursor: string | null };
type Overview = { maturityScore: number; activeKeys: number; activeWebhooks: number; providers: Provider[]; recentDeliveries: Delivery[]; supportedEvents: string[] };
type ApiKeyRow = { id: string; name: string; keyPrefix: string; scopes: string[]; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string };
type WebhookRow = { id: string; name: string; url: string; events: string[]; enabled: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null; createdAt: string; _count: { deliveries: number } };
type NewSecret = { title: string; value: string; note: string };
type Approval = { title: string; description: string; confirmLabel: string; run: (pin: string) => Promise<void> };

const SCOPES = [
  { id: "catalog:read", label: "Catalog", detail: "Products, price and stock" },
  { id: "customers:read", label: "Customers", detail: "Customer and balance data" },
  { id: "bills:read", label: "Bills", detail: "Sales and payment totals" },
];

const STATUS: Record<ProviderStatus, { label: string; tone: Tone }> = {
  ready: { label: "Operational", tone: "green" },
  available: { label: "Ready to configure", tone: "blue" },
  setup_required: { label: "Setup required", tone: "amber" },
  sandbox_only: { label: "Sandbox only", tone: "violet" },
  adapter_required: { label: "Adapter required", tone: "amber" },
  development_only: { label: "Development only", tone: "red" },
  upgrade_required: { label: "Upgrade required", tone: "amber" },
};

function readableDate(value?: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
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

  const overviewQ = useQuery({ queryKey: ["integrations", "overview"], queryFn: () => apiRequest<Overview>("/integrations/overview"), retry: 1 });
  const keysQ = useQuery({ queryKey: ["integrations", "keys"], queryFn: () => apiRequest<ApiKeyRow[]>("/integrations/api-keys"), retry: 1 });
  const webhooksQ = useQuery({ queryKey: ["integrations", "webhooks"], queryFn: () => apiRequest<WebhookRow[]>("/integrations/webhooks"), retry: 1 });
  const deliveriesQ = useInfiniteQuery({
    queryKey: ["integrations", "deliveries"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiRequest<DeliveryPage>(`/integrations/deliveries?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
    retry: 1,
  });
  const tallyM = useMutation({
    mutationFn: () => apiRequest<string>(`/integrations/exports/tally?from=${from}&to=${to}`),
    onSuccess: (xml) => { downloadText(`artha-tally-${from}-${to}.xml`, xml, "application/xml;charset=utf-8"); toast({ title: "Tally export downloaded", description: "Import it from TallyPrime > Import Data > Vouchers." }); },
    onError: (error) => toast({ title: "Export failed", description: errorMessage(error), variant: "destructive" }),
  });

  const overview = overviewQ.data;
  const developerPlanEnabled = Boolean(overview) && overview?.providers.find((provider) => provider.id === "api")?.status !== "upgrade_required";
  const tallyPlanEnabled = Boolean(overview) && overview?.providers.find((provider) => provider.id === "tally")?.status !== "upgrade_required";
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
    toast({ title: "Integration status refreshed" });
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
    } catch (error) { setApprovalError(errorMessage(error)); }
    finally { setApproving(false); }
  }

  function createKey() {
    if (keyName.trim().length < 2 || !scopes.length) return toast({ title: "Add a name and at least one scope", variant: "destructive" });
    setKeyOpen(false);
    requestApproval({ title: "Create API credential", description: "The full key is shown once. Artha stores only an irreversible SHA-256 hash.", confirmLabel: "Create secure key", run: async (ownerPin) => {
      const ttlDays = Number(keyTtlDays);
      const expiresAt = ttlDays > 0 ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString() : null;
      const result = await apiRequest<ApiKeyRow & { secret: string }>("/integrations/api-keys", { method: "POST", ownerPin, body: JSON.stringify({ name: keyName.trim(), scopes, expiresAt }) });
      setSecret({ title: "API key created", value: result.secret, note: "Copy this key now. It cannot be viewed again after you close this window." });
      toast({ title: "Scoped API key created" });
    } });
  }

  function createWebhook() {
    if (webhookName.trim().length < 2 || !webhookUrl.trim() || !events.length) return toast({ title: "Complete the endpoint details", variant: "destructive" });
    setWebhookOpen(false);
    requestApproval({ title: "Create webhook endpoint", description: "Artha validates the destination, blocks private networks and signs every request.", confirmLabel: "Create endpoint", run: async (ownerPin) => {
      const result = await apiRequest<WebhookRow & { secret: string }>("/integrations/webhooks", { method: "POST", ownerPin, body: JSON.stringify({ name: webhookName.trim(), url: webhookUrl.trim(), events }) });
      setSecret({ title: "Webhook signing secret", value: result.secret, note: "Use this secret to verify the x-kiranaos-signature header. It is shown only now." });
      setWebhookUrl("");
      toast({ title: "Signed webhook endpoint created" });
    } });
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

  if (overviewQ.isLoading && keysQ.isLoading) return <SettingsShell><div className="grid min-h-[420px] place-items-center rounded-[14px] border border-[#e7edf7] bg-white"><div className="text-center"><Loader2 className="mx-auto animate-spin text-[var(--brand)]" /><p className="mt-3 text-sm font-bold text-[#344668]">Loading integration control plane…</p></div></div></SettingsShell>;

  if (overviewQ.isError) return <SettingsShell><Card><div className="flex flex-col items-center px-6 py-14 text-center"><AlertTriangle className="text-amber-500" /><p className="mt-3 font-bold text-[#102347]">Integration service is not ready</p><p className="mt-1 max-w-md text-sm text-[#64748b]">{errorMessage(overviewQ.error)}. Apply the latest database migration and restart the backend.</p><Button className="mt-5" variant="outline" onClick={refresh}><RefreshCcw size={14} /> Retry</Button></div></Card></SettingsShell>;

  return (
    <SettingsShell>
      <Card className="relative overflow-hidden border-[#dfe8f7] bg-[linear-gradient(135deg,#07152f_0%,#0e2c63_58%,#075d68_100%)] text-white shadow-[0_18px_45px_rgba(7,25,61,0.18)]">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="relative grid gap-6 p-6 md:grid-cols-[1fr_270px] md:items-center">
          <div><Badge tone="blue" className="bg-white/10 text-cyan-100"><ShieldCheck size={12} /> Production control plane</Badge><h2 className="mt-3 font-display text-2xl font-black tracking-tight">Integrations you can operate, audit and trust</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Scoped credentials, signed webhooks, SSRF protection, delivery evidence and accounting exports—managed from one place without browser-stored secrets.</p><div className="mt-4 flex flex-wrap gap-2"><Badge className="bg-emerald-400/15 text-emerald-200"><Check size={11} /> Tenant isolated</Badge><Badge className="bg-cyan-400/15 text-cyan-100"><Check size={11} /> HMAC signed</Badge><Badge className="bg-violet-400/15 text-violet-100"><Check size={11} /> Audit logged</Badge></div></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur"><div className="flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Deployment readiness</p><p className="mt-1 font-display text-4xl font-black">{overview?.maturityScore ?? 0}<span className="text-lg text-slate-400">/100</span></p></div><Cloud className="text-cyan-300" /></div><Progress className="mt-4 bg-white/10 [&>div]:bg-cyan-300" value={overview?.maturityScore ?? 0} /><p className="mt-3 text-[11px] leading-5 text-slate-300">Score reflects configured providers in this environment. The security control plane itself is active.</p></div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Active API keys" value={activeKeys.length} sub={developerPlanEnabled ? "Scoped and revocable" : "Suspended by current plan"} tone={developerPlanEnabled ? "blue" : "amber"} icon={<KeyRound size={15} />} />
        <Kpi label="Webhook endpoints" value={activeWebhooks.length} sub={developerPlanEnabled ? `${webhooksQ.data?.length ?? 0} total configured` : "Suspended by current plan"} tone={developerPlanEnabled ? "violet" : "amber"} icon={<Webhook size={15} />} />
        <Kpi label="Recent delivery success" value={deliveryRate === null ? "—" : `${deliveryRate}%`} sub={deliveryRate === null ? "No attempts yet" : `${delivered} delivered · ${failed} failed`} tone={failed ? "amber" : "green"} icon={<Activity size={15} />} />
        <Kpi label="Last activity" value={lastActivity ? readableDate(lastActivity).split(",")[0] : "—"} sub={lastActivity ? readableDate(lastActivity) : "No events yet"} tone="gray" icon={<Clock3 size={15} />} />
      </div>

      <Card>
        <CardHead icon={<Plug size={15} />} title="Provider readiness" sub="Live capability status from backend configuration" action={<Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs font-bold text-[var(--brand)]" onClick={refresh}><RefreshCcw size={13} /> Refresh</Button>} />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
          {(overview?.providers ?? []).map((provider) => { const status = STATUS[provider.status]; return <div key={provider.id} className="group rounded-xl border border-[#e4ebf6] bg-[linear-gradient(180deg,#fff,#fbfdff)] p-4 transition hover:-translate-y-0.5 hover:border-[#cbdaf2] hover:shadow-[0_10px_25px_rgba(20,55,110,.08)]"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><Plug size={17} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-[#102347]">{provider.name}</p><Badge tone={status.tone}>{status.label}</Badge></div><p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-[#9aa6bb]">{provider.category}</p><p className="mt-2 text-xs leading-5 text-[#64748b]">{provider.detail}</p></div></div></div>; })}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHead icon={<KeyRound size={15} />} title="API credentials" sub="Least-privilege access for trusted systems" action={<Button size="sm" className="h-8 gap-1.5 rounded-lg text-xs font-bold" disabled={!developerPlanEnabled} title={developerPlanEnabled ? undefined : "Upgrade to Pro to create API credentials"} onClick={() => setKeyOpen(true)}><KeyRound size={13} /> Create key</Button>} />
          <div className="space-y-2 px-5 pb-5">
            {keysQ.isLoading ? <LoadingRows /> : keysQ.isError ? <QueryFailure message={errorMessage(keysQ.error)} retry={() => void keysQ.refetch()} /> : (keysQ.data?.length ? keysQ.data.map((key) => { const expired = isKeyExpired(key); const planLocked = !developerPlanEnabled && !key.revokedAt && !expired; const inactive = Boolean(key.revokedAt) || expired || planLocked; return <div key={key.id} className={`rounded-xl border p-3.5 ${inactive ? "border-[#edf0f5] bg-[#f8fafc] opacity-70" : "border-[#e4ebf6]"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[#102347]">{key.name}</p><Badge tone={key.revokedAt ? "gray" : expired || planLocked ? "amber" : "green"}>{key.revokedAt ? "Revoked" : expired ? "Expired" : planLocked ? "Plan locked" : "Active"}</Badge></div><p className="mt-1 font-mono text-xs text-[#64748b]">{key.keyPrefix}••••••••</p></div>{!key.revokedAt && <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500 hover:bg-rose-50" aria-label={`Revoke ${key.name}`} onClick={() => protectedAction("revoke", key.id)}><Trash2 size={14} /></Button>}</div><div className="mt-3 flex flex-wrap gap-1.5">{key.scopes.map((scope) => <Badge key={scope} tone="blue">{scope}</Badge>)}</div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#94a3b8]"><span>Created {readableDate(key.createdAt)}</span><span>Expires {key.expiresAt ? readableDate(key.expiresAt) : "Never"}</span><span>Last used {readableDate(key.lastUsedAt)}</span></div></div>; }) : <Empty icon={<KeyRound size={18} />} title="No API keys" detail="Create a scoped credential for an ERP, marketplace or analytics system." />)}
          </div>
        </Card>

        <Card>
          <CardHead icon={<Webhook size={15} />} title="Webhook endpoints" sub="Signed real-time events with delivery evidence" action={<Button size="sm" className="h-8 gap-1.5 rounded-lg text-xs font-bold" disabled={!developerPlanEnabled} title={developerPlanEnabled ? undefined : "Upgrade to Pro to add webhook endpoints"} onClick={() => setWebhookOpen(true)}><Link2 size={13} /> Add endpoint</Button>} />
          <div className="space-y-2 px-5 pb-5">
            {webhooksQ.isLoading ? <LoadingRows /> : webhooksQ.isError ? <QueryFailure message={errorMessage(webhooksQ.error)} retry={() => void webhooksQ.refetch()} /> : (webhooksQ.data?.length ? webhooksQ.data.map((endpoint) => <div key={endpoint.id} className="rounded-xl border border-[#e4ebf6] p-3.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[#102347]">{endpoint.name}</p><Badge tone={!developerPlanEnabled ? "amber" : endpoint.enabled ? endpoint.lastError ? "amber" : "green" : "gray"}>{!developerPlanEnabled ? "Plan locked" : endpoint.enabled ? endpoint.lastError ? "Attention" : "Enabled" : "Paused"}</Badge></div><p className="mt-1 truncate font-mono text-xs text-[#64748b]" title={endpoint.url}>{endpoint.url}</p></div><div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" className="h-8 w-8 text-[var(--brand)]" disabled={!developerPlanEnabled} aria-label={`Test ${endpoint.name}`} onClick={() => protectedAction("test", endpoint.id)}><Send size={14} /></Button><Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600" disabled={!developerPlanEnabled} aria-label={endpoint.enabled ? `Pause ${endpoint.name}` : `Enable ${endpoint.name}`} onClick={() => protectedAction("toggle", endpoint.id, endpoint.enabled)}>{endpoint.enabled ? <Clock3 size={14} /> : <CheckCircle2 size={14} />}</Button><Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" aria-label={`Archive ${endpoint.name}`} onClick={() => protectedAction("delete", endpoint.id)}><Trash2 size={14} /></Button></div></div><div className="mt-3 flex flex-wrap gap-1.5">{endpoint.events.map((event) => <Badge key={event} tone="violet">{event}</Badge>)}</div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#94a3b8]"><span>{endpoint._count.deliveries} deliveries</span><span>Last success {readableDate(endpoint.lastSuccessAt)}</span></div>{endpoint.lastError && <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">{endpoint.lastError}</p>}</div>) : <Empty icon={<Webhook size={18} />} title="No webhook endpoints" detail="Add an HTTPS endpoint to receive signed business events." />)}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <Card>
          <CardHead icon={<Activity size={15} />} title="Delivery activity" sub="HTTP status, latency and retry evidence" />
          <div className="px-5 pb-5">
            {deliveriesQ.isLoading ? <LoadingRows /> : deliveriesQ.isError ? <QueryFailure message={errorMessage(deliveriesQ.error)} retry={() => void deliveriesQ.refetch()} /> : deliveries.length ? <div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left"><thead><tr className="border-b border-[#e8edf5] text-[10px] font-bold uppercase tracking-wider text-[#94a3b8]"><th className="pb-2">Event</th><th className="pb-2">Status</th><th className="pb-2">HTTP</th><th className="pb-2">Latency</th><th className="pb-2">Attempted</th><th className="pb-2 text-right">Action</th></tr></thead><tbody>{deliveries.map((item) => <tr key={item.id} className="border-b border-[#f0f3f8] text-xs last:border-0"><td className="py-3"><p className="font-mono font-semibold text-[#344668]">{item.eventType}</p>{item.lastError && <p className="mt-1 max-w-[260px] truncate text-[10px] font-medium text-rose-600" title={item.lastError}>{item.lastError}</p>}</td><td className="py-3"><Badge tone={item.status === "delivered" ? "green" : item.status === "failed" ? "red" : "amber"}>{item.status}</Badge></td><td className="py-3 text-[#64748b]">{item.httpStatus ?? "—"}</td><td className="py-3 text-[#64748b]">{item.durationMs == null ? "—" : `${item.durationMs} ms`}</td><td className="py-3 text-[#64748b]">{readableDate(item.lastAttemptAt || item.createdAt)}</td><td className="py-3 text-right">{item.status === "failed" && <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px] font-bold text-[var(--brand)]" onClick={() => protectedAction("retry", item.id)}><RotateCcw size={12} /> Retry</Button>}</td></tr>)}</tbody></table></div>{deliveriesQ.hasNextPage && <div className="mt-3 flex justify-center"><Button variant="outline" size="sm" disabled={deliveriesQ.isFetchingNextPage} onClick={() => void deliveriesQ.fetchNextPage()}>{deliveriesQ.isFetchingNextPage ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />} Load older deliveries</Button></div>}</div> : <Empty icon={<Activity size={18} />} title="No delivery attempts" detail="Test an endpoint to verify connectivity and signature handling." />}
          </div>
        </Card>

        <Card>
          <CardHead icon={<Download size={15} />} title="TallyPrime export" sub="Accounting vouchers in import-ready XML" action={<Badge tone={tallyPlanEnabled ? "green" : "amber"}>{tallyPlanEnabled ? "Operational" : "Pro plan"}</Badge>} />
          <div className="space-y-4 px-5 pb-5"><div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-xs leading-5 text-emerald-900"><div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0" /><p>{tallyPlanEnabled ? "Generated from server-authoritative bills and scoped to this shop. Customer names and voucher totals are XML-escaped." : "TallyPrime export is available on the Pro plan. Existing integration history remains visible after a downgrade."}</p></div></div><div className="grid grid-cols-2 gap-3"><Fld label="From"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Fld><Fld label="To"><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Fld></div><Button className="w-full gap-2" disabled={!tallyPlanEnabled || tallyM.isPending || !from || !to || from > to} onClick={() => tallyM.mutate()}>{tallyM.isPending ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} {tallyPlanEnabled ? "Download Tally XML" : "Upgrade to export"}</Button><a className="inline-flex items-center gap-1 text-xs font-bold text-[var(--brand)] hover:underline" href="https://help.tallysolutions.com/import-data-in-tallyprime/" target="_blank" rel="noreferrer">Tally import instructions <ExternalLink size={12} /></a></div>
        </Card>
      </div>

      <Dialog open={keyOpen} onOpenChange={setKeyOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Create scoped API key</DialogTitle><DialogDescription>Choose only the data this client actually needs. Keys are read-only and tenant scoped.</DialogDescription></DialogHeader><div className="space-y-4"><Fld label="Credential name"><Input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="e.g. Head office ERP" /></Fld><Fld label="Automatic expiry" hint="Short-lived keys reduce damage if a credential is ever exposed."><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={keyTtlDays} onChange={(event) => setKeyTtlDays(event.target.value)}><option value="30">30 days</option><option value="90">90 days (recommended)</option><option value="365">1 year</option><option value="0">Never expires</option></select></Fld><div><p className="mb-1.5 text-[12px] font-semibold text-[#45577a]">Permissions</p><div className="space-y-2">{SCOPES.map((scope) => <label key={scope.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#e4ebf6] p-3"><Checkbox checked={scopes.includes(scope.id)} onCheckedChange={(checked) => setScopes((current) => checked ? [...new Set([...current, scope.id])] : current.filter((item) => item !== scope.id))} /><span><span className="block text-sm font-bold text-[#102347]">{scope.label}</span><span className="block text-xs text-[#64748b]">{scope.detail}</span></span></label>)}</div></div></div><DialogFooter><Button variant="outline" onClick={() => setKeyOpen(false)}>Cancel</Button><Button onClick={createKey}>Continue securely</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={webhookOpen} onOpenChange={setWebhookOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Add webhook endpoint</DialogTitle><DialogDescription>Production endpoints must use HTTPS. Local, private and link-local destinations are blocked.</DialogDescription></DialogHeader><div className="space-y-4"><Fld label="Endpoint name"><Input value={webhookName} onChange={(event) => setWebhookName(event.target.value)} /></Fld><Fld label="HTTPS URL"><Input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/webhooks/kiranaos" /></Fld><div><p className="mb-1.5 text-[12px] font-semibold text-[#45577a]">Events</p><div className="grid gap-2 sm:grid-cols-2">{(overview?.supportedEvents ?? []).filter((event) => event !== "integration.test").map((event) => <label key={event} className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#e4ebf6] p-2.5 font-mono text-xs text-[#344668]"><Checkbox checked={events.includes(event)} onCheckedChange={(checked) => setEvents((current) => checked ? [...new Set([...current, event])] : current.filter((item) => item !== event))} />{event}</label>)}</div></div></div><DialogFooter><Button variant="outline" onClick={() => setWebhookOpen(false)}>Cancel</Button><Button onClick={createWebhook}>Continue securely</Button></DialogFooter></DialogContent></Dialog>

      <OwnerPinModal open={Boolean(approval)} title={approval?.title ?? "Approve integration action"} description={approval?.description} confirmLabel={approval?.confirmLabel} loading={approving} error={approvalError} onCancel={() => { if (!approving) setApproval(null); }} onConfirm={({ ownerPin }) => confirmApproval(ownerPin)} />

      <Dialog open={Boolean(secret)} onOpenChange={(open) => { if (!open) setSecret(null); }}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck size={18} className="text-emerald-600" />{secret?.title}</DialogTitle><DialogDescription>{secret?.note}</DialogDescription></DialogHeader><div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="break-all font-mono text-sm font-semibold leading-6 text-amber-950">{secret?.value}</p></div><DialogFooter><Button variant="outline" className="gap-2" onClick={() => { if (secret?.value) void navigator.clipboard.writeText(secret.value); toast({ title: "Secret copied" }); }}><Copy size={14} /> Copy secret</Button><Button onClick={() => setSecret(null)}>I saved it</Button></DialogFooter></DialogContent></Dialog>
    </SettingsShell>
  );
}

function LoadingRows() { return <div className="space-y-2">{[1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-[#f2f5fa]" />)}</div>; }
function Empty({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) { return <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-[#d8e1ef] bg-[#fbfcfe] p-6 text-center"><div><span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#edf3fb] text-[#64748b]">{icon}</span><p className="mt-2 text-sm font-bold text-[#344668]">{title}</p><p className="mt-1 max-w-sm text-xs leading-5 text-[#94a3b8]">{detail}</p></div></div>; }
function QueryFailure({ message, retry }: { message: string; retry: () => void }) { return <div className="rounded-xl border border-rose-100 bg-rose-50/70 p-4"><div className="flex items-start gap-3"><AlertTriangle size={17} className="mt-0.5 shrink-0 text-rose-500" /><div className="min-w-0 flex-1"><p className="text-sm font-bold text-rose-900">Could not load this integration data</p><p className="mt-1 break-words text-xs leading-5 text-rose-700">{message}</p></div><Button variant="outline" size="sm" className="h-8 shrink-0 gap-1 bg-white text-xs" onClick={retry}><RefreshCcw size={12} /> Retry</Button></div></div>; }
