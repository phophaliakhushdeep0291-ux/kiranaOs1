import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Copy,
  Loader2,
  MessageCircle,
  RefreshCcw,
  ServerCog,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api/http";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Badge, Card, CardHead, RowToggle } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";
import { UpgradePrompt, useFeature } from "@/features/subscription";

interface ReminderStatus {
  channel: "whatsapp";
  provider: string;
  providerSendConfigured: boolean;
  providerConfigured: boolean;
  webhookConfigured: boolean;
  queueEnabled: boolean;
  workerHealthy: boolean;
  operational: boolean;
  code: "PROVIDER_SETUP_REQUIRED" | "QUEUE_SETUP_REQUIRED" | "WORKER_OFFLINE" | "OPERATIONAL";
}

interface ReminderTemplate {
  id: string;
  name: string;
  channel: "whatsapp" | "sms" | "email";
  templateText: string;
  active: boolean;
  updatedAt?: string;
}

interface ReminderLog {
  id: string;
  customerName: string | null;
  customerMobileMasked: string;
  channel: string;
  status: "queued" | "accepted" | "sent" | "delivered" | "read" | "failed" | "skipped";
  provider: string;
  error?: string | null;
  acceptedAt?: string | null;
  sentAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  failedAt?: string | null;
  lastStatusAt?: string | null;
  createdAt: string;
  messagePreview: string;
}

interface ClosingPreferences {
  dailySales: boolean;
  dailyProfit: boolean;
  dailyUdhar: boolean;
  dailyCashUpi: boolean;
}

const DEFAULT_CLOSING: ClosingPreferences = {
  dailySales: true,
  dailyProfit: true,
  dailyUdhar: true,
  dailyCashUpi: true,
};

const ALLOWED_VARIABLES = [
  "customerName",
  "shopName",
  "balance",
  "dueDate",
  "lastPaymentDate",
  "billCount",
  "paidAmount",
  "statementPeriod",
];

function readableDate(value?: string | null) {
  if (!value) return "Not completed";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

function statusCopy(status?: ReminderStatus) {
  if (!status) return { label: "Checking", tone: "gray" as const, detail: "Reading live backend readiness." };
  if (status.operational) return { label: "Operational", tone: "green" as const, detail: "Provider, Redis queue, and reminder worker are ready." };
  if (!status.providerConfigured) return { label: "Setup required", tone: "amber" as const, detail: "Configure a supported WhatsApp provider on the server." };
  if (!status.queueEnabled) return { label: "Queue required", tone: "amber" as const, detail: "The provider is configured, but Redis job queues are disabled." };
  return { label: "Worker offline", tone: "red" as const, detail: "The queue is enabled, but no fresh reminder worker heartbeat is available." };
}

function previewTemplate(template: string) {
  const values: Record<string, string> = {
    customerName: "Ramesh",
    shopName: "Veyra Store",
    balance: "850",
    dueDate: "31 Jul 2026",
    lastPaymentDate: "10 Jul 2026",
    billCount: "4",
    paidAmount: "1,250",
    statementPeriod: "1 Jul to 31 Jul",
  };
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => values[key] ?? "");
}

export default function NotificationsSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const feature = useFeature("whatsapp_reminders");
  const { prefs, patch, hydrated } = useSettingsPrefs();
  const [closing, setClosing] = useState<ClosingPreferences>(DEFAULT_CLOSING);
  const [editing, setEditing] = useState<ReminderTemplate | null>(null);
  const [draft, setDraft] = useState("");
  const seeded = useRef(false);
  const automationEnabled = feature.allowed && !feature.loading;

  useEffect(() => {
    if (seeded.current || !hydrated) return;
    seeded.current = true;
    const saved = (prefs.notifications ?? {}) as Partial<ClosingPreferences>;
    setClosing({ ...DEFAULT_CLOSING, ...saved });
  }, [hydrated, prefs.notifications]);

  const statusQ = useQuery({
    queryKey: ["reminders", "status"],
    queryFn: () => apiRequest<ReminderStatus>("/reminders/status"),
    enabled: automationEnabled,
    refetchInterval: 30_000,
    retry: 1,
  });
  const templatesQ = useQuery({
    queryKey: ["reminders", "templates"],
    queryFn: () => apiRequest<ReminderTemplate[]>("/reminders/templates"),
    enabled: automationEnabled,
    retry: 1,
  });
  const logsQ = useQuery({
    queryKey: ["reminders", "logs"],
    queryFn: () => apiRequest<ReminderLog[]>("/reminders/logs?limit=20"),
    enabled: automationEnabled,
    refetchInterval: 30_000,
    retry: 1,
  });

  const updateTemplate = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<ReminderTemplate, "templateText" | "active">> }) =>
      apiRequest<ReminderTemplate>("/reminders/templates/" + id, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: async () => {
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["reminders", "templates"] });
      toast({ title: "Reminder template saved", description: "The server will use this version for future sends." });
    },
    onError: (error) => toast({ title: "Could not save template", description: errorMessage(error), variant: "destructive" }),
  });

  function updateClosing(partial: Partial<ClosingPreferences>) {
    const next = { ...closing, ...partial };
    setClosing(next);
    patch({ notifications: { ...((prefs.notifications ?? {}) as Record<string, unknown>), ...next } });
  }

  function saveTemplate() {
    if (!editing) return;
    const value = draft.trim();
    if (value.length < 5) {
      toast({ title: "Template is too short", description: "Add a useful customer message.", variant: "destructive" });
      return;
    }
    updateTemplate.mutate({ id: editing.id, data: { templateText: value } });
  }

  async function copySample(template: ReminderTemplate) {
    try {
      await navigator.clipboard.writeText(previewTemplate(template.templateText));
      toast({ title: "Rendered sample copied", description: "This is a preview only; no message was marked as sent." });
    } catch {
      toast({ title: "Clipboard unavailable", description: "Select and copy the template text manually.", variant: "destructive" });
    }
  }

  function refreshAutomation() {
    void queryClient.invalidateQueries({ queryKey: ["reminders"] });
    toast({ title: "Refreshing live reminder status" });
  }

  const liveStatus = statusCopy(statusQ.data);
  const logs = logsQ.data ?? [];

  return (
    <SettingsShell>
      <Card>
        <CardHead
          icon={<MessageCircle size={15} />}
          title="WhatsApp Automation"
          sub="Live provider, queue, and worker readiness"
          action={automationEnabled ? (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={refreshAutomation}>
              <RefreshCcw size={13} className={statusQ.isFetching ? "animate-spin" : ""} /> Refresh
            </Button>
          ) : undefined}
        />
        <div className="px-5 pb-5">
          {!feature.loading && !feature.allowed ? (
            <UpgradePrompt compact featureName="whatsapp_reminders" description={feature.reason} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[14px] border border-[#e4ebf6] bg-[#f8faff] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-black text-[#102347]">Delivery pipeline</p>
                      <Badge tone={statusQ.isError ? "red" : liveStatus.tone}>
                        {statusQ.isError ? "Status unavailable" : liveStatus.label}
                      </Badge>
                    </div>
                    <p className="mt-1 max-w-xl text-[12px] text-[#64748b]">
                      {statusQ.isError ? "The backend status request failed. No channel is being shown as connected." : liveStatus.detail}
                    </p>
                  </div>
                  <Link href="/settings/integrations">
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                      <Settings2 size={13} /> Integration setup
                    </Button>
                  </Link>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <ReadinessCheck label="Provider API" ready={statusQ.data?.providerSendConfigured === true} value={statusQ.data?.provider || "unknown"} />
                  <ReadinessCheck label="Signed callbacks" ready={statusQ.data?.webhookConfigured === true} value={statusQ.data?.webhookConfigured ? "configured" : "not ready"} />
                  <ReadinessCheck label="Redis queue" ready={statusQ.data?.queueEnabled === true} value={statusQ.data?.queueEnabled ? "enabled" : "not ready"} />
                  <ReadinessCheck label="Reminder worker" ready={statusQ.data?.workerHealthy === true} value={statusQ.data?.workerHealthy ? "healthy" : "no heartbeat"} />
                </div>
              </div>
              <div className="rounded-[14px] border border-emerald-100 bg-emerald-50/70 p-4">
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 shrink-0 text-emerald-700" size={18} />
                  <div>
                    <p className="text-[13px] font-black text-emerald-950">Delivery truth, not optimistic UI</p>
                    <p className="mt-1 text-[11px] leading-5 text-emerald-800">
                      Provider acceptance is shown as Accepted. Sent, Delivered, and Read appear only after a
                      verified provider callback; skipped and failed attempts remain visible below.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHead icon={<Bell size={15} />} title="Daily Closing Share" sub="Choose what appears in the real closing summary" />
          <div className="px-5 pb-4">
            <p className="mb-2 rounded-[10px] bg-blue-50 px-3 py-2 text-[11px] font-semibold text-blue-800">
              These preferences control the Daily Closing screen and its share text. They do not claim to schedule SMS, email, or push delivery.
            </p>
            <RowToggle label="Include sales total" pill={<Switch checked={closing.dailySales} onCheckedChange={(value) => updateClosing({ dailySales: value })} />} />
            <RowToggle label="Include profit" pill={<Switch checked={closing.dailyProfit} onCheckedChange={(value) => updateClosing({ dailyProfit: value })} />} />
            <RowToggle label="Include udhar collection" pill={<Switch checked={closing.dailyUdhar} onCheckedChange={(value) => updateClosing({ dailyUdhar: value })} />} />
            <RowToggle label="Include cash / UPI breakup" pill={<Switch checked={closing.dailyCashUpi} onCheckedChange={(value) => updateClosing({ dailyCashUpi: value })} />} last />
          </div>
        </Card>

        <Card>
          <CardHead icon={<ServerCog size={15} />} title="Server Reminder Templates" sub="Audited templates used by automated WhatsApp sends" />
          <div className="space-y-2.5 px-5 pb-5">
            {!automationEnabled ? (
              <p className="rounded-[10px] bg-[#f6f8fc] px-3 py-6 text-center text-[12px] text-[#64748b]">Available with WhatsApp reminders.</p>
            ) : templatesQ.isLoading ? (
              <p className="flex items-center justify-center gap-2 py-8 text-[12px] text-[#64748b]"><Loader2 size={14} className="animate-spin" /> Loading server templates</p>
            ) : templatesQ.isError ? (
              <p className="rounded-[10px] bg-rose-50 px-3 py-3 text-[12px] font-semibold text-rose-700">Templates could not be loaded. No local sample is being substituted.</p>
            ) : (templatesQ.data ?? []).length === 0 ? (
              <p className="rounded-[10px] bg-[#f6f8fc] px-3 py-6 text-center text-[12px] text-[#64748b]">No active server templates.</p>
            ) : (
              (templatesQ.data ?? []).map((template) => (
                <div key={template.id} className="rounded-[11px] border border-[#e7edf7] px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-black text-[#102347]">{template.name}</p>
                        <Badge tone={template.active ? "green" : "gray"}>{template.active ? "Active" : "Paused"}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[#64748b]">{template.templateText}</p>
                    </div>
                    <Switch
                      checked={template.active}
                      disabled={updateTemplate.isPending}
                      onCheckedChange={(active) => updateTemplate.mutate({ id: template.id, data: { active } })}
                    />
                  </div>
                  <div className="mt-2 flex gap-3">
                    <button type="button" className="text-[11px] font-black text-[#005dff] hover:underline" onClick={() => { setEditing(template); setDraft(template.templateText); }}>Edit server template</button>
                    <button type="button" className="inline-flex items-center gap-1 text-[11px] font-black text-[#005dff] hover:underline" onClick={() => void copySample(template)}><Copy size={11} /> Copy rendered sample</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          icon={<Clock3 size={15} />}
          title="Actual Delivery History"
          sub="Latest server records; sample messages never appear here"
          action={logsQ.isFetching ? <Loader2 size={14} className="animate-spin text-[#64748b]" /> : undefined}
        />
        <div className="px-5 pb-5">
          {!automationEnabled ? (
            <p className="rounded-[10px] bg-[#f6f8fc] px-3 py-6 text-center text-[12px] text-[#64748b]">Delivery history is available with WhatsApp reminders.</p>
          ) : logsQ.isError ? (
            <p className="rounded-[10px] bg-rose-50 px-3 py-3 text-[12px] font-semibold text-rose-700">Live delivery history could not be loaded.</p>
          ) : logsQ.isLoading ? (
            <p className="flex items-center justify-center gap-2 py-8 text-[12px] text-[#64748b]"><Loader2 size={14} className="animate-spin" /> Loading deliveries</p>
          ) : logs.length === 0 ? (
            <div className="py-10 text-center">
              <MessageCircle className="mx-auto text-[#b5c0d2]" size={28} />
              <p className="mt-2 text-[13px] font-black text-[#102347]">No reminder attempts yet</p>
              <p className="mt-1 text-[11px] text-[#64748b]">Send from a customer account to create the first auditable record.</p>
            </div>
          ) : (
            <div className="app-table-scroll overflow-x-auto rounded-[11px] border border-[#e7edf7]">
              <table className="w-full min-w-[760px] text-left text-[12px]">
                <thead className="bg-[#f7f9fd] text-[10px] font-black uppercase tracking-wide text-[#64748b]">
                  <tr><th className="px-4 py-2.5">Customer</th><th className="px-4 py-2.5">Message</th><th className="px-4 py-2.5">Provider</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Time</th></tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-t border-[#eef2f8]">
                      <td className="px-4 py-3"><p className="font-black text-[#102347]">{log.customerName || "Customer"}</p><p className="text-[10px] text-[#8290a8]">{log.customerMobileMasked || "No mobile shown"}</p></td>
                      <td className="max-w-[340px] px-4 py-3 text-[#52627e]"><p className="line-clamp-2">{log.messagePreview}</p>{log.error ? <p className="mt-1 text-[10px] font-bold text-rose-600">{log.error}</p> : null}</td>
                      <td className="px-4 py-3 font-bold uppercase text-[#52627e]">{log.provider || "disabled"}</td>
                      <td className="px-4 py-3"><DeliveryBadge status={log.status} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#64748b]">{readableDate(log.readAt || log.deliveredAt || log.sentAt || log.acceptedAt || log.failedAt || log.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-[580px]">
          <DialogHeader>
            <DialogTitle className="font-display text-[17px] font-black tracking-tight text-[#0f1e3d]">{editing?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <textarea
              className="min-h-[150px] w-full resize-y rounded-[10px] border border-[#dbe6f7] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#005dff]"
              value={draft}
              maxLength={1000}
              onChange={(event) => setDraft(event.target.value)}
            />
            <p className="text-[11px] leading-5 text-[#64748b]">Allowed variables: {ALLOWED_VARIABLES.map((variable) => "{{" + variable + "}}").join(", ")}</p>
            <div className="rounded-[10px] bg-[#f6f8fc] px-3 py-2 text-[11px] text-[#52627e]">
              <span className="font-black">Rendered preview:</span> {previewTemplate(draft)}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button disabled={updateTemplate.isPending} onClick={saveTemplate}>
                {updateTemplate.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save server template
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsShell>
  );
}

function ReadinessCheck({ label, ready, value }: { label: string; ready: boolean; value: string }) {
  return (
    <div className="rounded-[10px] border border-[#e5ebf5] bg-white px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        {ready ? <CheckCircle2 size={13} className="text-emerald-600" /> : <AlertTriangle size={13} className="text-amber-600" />}
        <span className="text-[10px] font-black uppercase tracking-wide text-[#64748b]">{label}</span>
      </div>
      <p className="mt-1 truncate text-[12px] font-black text-[#102347]">{value}</p>
    </div>
  );
}

function DeliveryBadge({ status }: { status: ReminderLog["status"] }) {
  if (status === "read") return <Badge tone="green">Read</Badge>;
  if (status === "delivered") return <Badge tone="green">Delivered</Badge>;
  if (status === "sent") return <Badge tone="blue">Sent</Badge>;
  if (status === "accepted") return <Badge tone="blue">Accepted</Badge>;
  if (status === "queued") return <Badge tone="blue">Queued</Badge>;
  if (status === "failed") return <Badge tone="red">Failed</Badge>;
  return <Badge tone="gray">Skipped</Badge>;
}
