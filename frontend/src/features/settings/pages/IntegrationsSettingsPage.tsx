import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Activity, Copy, Plug, RefreshCcw } from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Fld, Badge, Kpi, RowToggle } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";

type IntStatus = "connected" | "disconnected" | "error" | "soon";
// None of these are wired to a real backend yet, so they default to "Coming Soon" rather than
// claiming to be connected. (Previously several defaulted to "connected", which was misleading.)
const APPS: { key: string; name: string; desc: string; def: IntStatus }[] = [
  { key: "whatsapp", name: "WhatsApp Business", desc: "Send bills & reminders", def: "soon" },
  { key: "tally", name: "TallyPrime", desc: "Accounting export", def: "soon" },
  { key: "razorpay", name: "Razorpay", desc: "Online payments", def: "soon" },
  { key: "bharatpe", name: "BharatPe", desc: "UPI & QR collections", def: "soon" },
  { key: "gdrive", name: "Google Drive Backup", desc: "Off-site backups", def: "soon" },
  { key: "printerApi", name: "Thermal Printer API", desc: "Network print bridge", def: "soon" },
  { key: "sms", name: "SMS Gateway", desc: "Transactional SMS", def: "soon" },
  { key: "accounting", name: "Accounting Export", desc: "CSV / Excel ledgers", def: "soon" },
  { key: "cloud", name: "Cloud Storage", desc: "Document storage", def: "soon" },
];
const STATUS_TONE: Record<IntStatus, "green" | "amber" | "red" | "gray"> = { connected: "green", disconnected: "amber", error: "red", soon: "gray" };
const STATUS_LABEL: Record<IntStatus, string> = { connected: "Connected", disconnected: "Not Connected", error: "Error", soon: "Coming Soon" };
const EVENTS = ["bill.created", "payment.recorded", "customer.updated", "stock.low", "sync.failed"];

export default function IntegrationsSettingsPage() {
  const { toast } = useToast();
  const { prefs, patch, hydrated } = useSettingsPrefs();
  const [states, setStates] = useState<Record<string, IntStatus>>({});
  const [apiOn, setApiOn] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !hydrated) return;
    seeded.current = true;
    const saved = (prefs.integrations ?? {}) as { states?: Record<string, IntStatus>; apiOn?: boolean };
    setStates({ ...Object.fromEntries(APPS.map((a) => [a.key, a.def])), ...(saved.states ?? {}) });
    setApiOn(Boolean(saved.apiOn));
  }, [hydrated, prefs.integrations]);

  const toggleApp = (key: string) => {
    const cur = states[key] ?? "disconnected";
    if (cur === "soon") { toast({ title: "Coming soon" }); return; }
    const next = cur === "connected" ? "disconnected" : "connected";
    const nextStates = { ...states, [key]: next as IntStatus };
    setStates(nextStates);
    patch({ integrations: { states: nextStates, apiOn } });
    toast({ title: next === "connected" ? "Connected" : "Disconnected" });
  };
  const setApi = (v: boolean) => { setApiOn(v); patch({ integrations: { states, apiOn: v } }); };

  const connected = Object.values(states).filter((s) => s === "connected").length;
  const notConnected = Object.values(states).filter((s) => s === "disconnected").length;
  const needsAttention = Object.values(states).filter((s) => s === "error").length;

  return (
    <SettingsShell>
      {/* Overview */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Connected" value={connected} tone="green" icon={<Plug size={15} />} />
        <Kpi label="Not Connected" value={notConnected} tone="amber" icon={<Plug size={15} />} />
        <Kpi label="Needs Attention" value={needsAttention} tone="red" icon={<Plug size={15} />} />
        <Kpi label="Last Sync" value="—" sub="No integrations yet" tone="blue" icon={<RefreshCcw size={15} />} />
      </div>

      {/* Integration grid */}
      <Card>
        <CardHead icon={<Plug size={15} />} title="Connected Apps" sub="Tap to connect or manage" action={<button onClick={() => toast({ title: "Refreshing connections…" })} className="inline-flex items-center gap-1 text-[12px] font-bold text-[#005dff] hover:underline"><RefreshCcw size={12} /> Refresh</button>} />
        <div className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
          {APPS.map((a) => {
            const st = states[a.key] ?? a.def;
            return (
              <div key={a.key} className="flex flex-col gap-2 rounded-[12px] border border-[#e7edf7] px-3.5 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[#f4f7fb] text-[#536583]"><Plug size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-[#102347]">{a.name}</p>
                    <p className="truncate text-[11px] text-[#64748b]">{a.desc}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge>
                  <button onClick={() => toggleApp(a.key)} disabled={st === "soon"} className="text-[12px] font-bold text-[#005dff] hover:underline disabled:text-[#9aa6bb]">
                    {st === "connected" ? "Manage" : st === "soon" ? "Soon" : "Connect"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* API & Webhooks */}
        <Card>
          <CardHead icon={<Plug size={15} />} title="API & Webhooks" sub="For Pro integrations" action={<Badge tone="amber">Pro</Badge>} />
          <div className="space-y-3 px-5 pb-5">
            <RowToggle label="Enable API access" desc="Allow external apps to call your store API" pill={<Switch checked={apiOn} onCheckedChange={setApi} />} />
            <Fld label="API Key">
              <div className="flex gap-2">
                <Input className="h-10 font-mono text-[12px]" readOnly value={apiOn ? (showKey ? "kos_live_8f2a91c4e7b6d350" : "kos_live_••••••••••••") : "Enable API access first"} />
                <Button variant="outline" className="h-10 rounded-[9px] px-3 text-[12px] font-bold" disabled={!apiOn} onClick={() => setShowKey((s) => !s)}>{showKey ? "Hide" : "Show"}</Button>
                <Button variant="outline" className="h-10 rounded-[9px] px-3" disabled={!apiOn} onClick={() => { void navigator.clipboard?.writeText("kos_live_8f2a91c4e7b6d350"); toast({ title: "API key copied" }); }}><Copy size={14} /></Button>
              </div>
            </Fld>
            <Fld label="Webhook URL"><Input className="h-10 text-[12px]" placeholder="https://your-server.com/kiranaos-webhook" disabled={!apiOn} /></Fld>
            <div>
              <p className="mb-1.5 text-[12px] font-semibold text-[#45577a]">Allowed events</p>
              <div className="flex flex-wrap gap-1.5">{EVENTS.map((e) => <Badge key={e} tone="blue">{e}</Badge>)}</div>
            </div>
          </div>
        </Card>

        {/* Activity */}
        <Card>
          <CardHead icon={<Activity size={15} />} title="Integration Activity" sub="Recent events" />
          <div className="px-5 pb-4">
            <div className="flex flex-col items-center gap-1.5 py-8 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[#f1f5fb] text-[#94a3b8]"><Activity size={18} /></span>
              <p className="text-[12px] font-bold text-[#344668]">No integration activity yet</p>
              <p className="text-[11px] text-[#94a3b8]">Activity will appear here once integrations go live.</p>
            </div>
          </div>
        </Card>
      </div>
    </SettingsShell>
  );
}
