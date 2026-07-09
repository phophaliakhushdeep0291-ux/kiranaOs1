import { useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Bell, Mail, MessageCircle, MessageSquare, Send, Smartphone } from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, RowToggle, Badge } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";

const CHANNELS = [
  { key: "inApp", label: "In-App", icon: Bell },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "sms", label: "SMS", icon: MessageSquare },
  { key: "email", label: "Email", icon: Mail },
  { key: "push", label: "Push", icon: Smartphone },
] as const;
const ALERTS = [
  { key: "lowStock", label: "Low stock alert", desc: "When a product dips below reorder level" },
  { key: "outOfStock", label: "Out of stock alert", desc: "When stock hits zero" },
  { key: "udharReminder", label: "Udhar payment reminder", desc: "Pending credit follow-ups" },
  { key: "largeDiscount", label: "Large discount alert", desc: "Discounts above your limit" },
  { key: "negativeStock", label: "Negative stock warning", desc: "Stock goes below zero" },
  { key: "syncFailed", label: "Sync failed alert", desc: "Cloud sync errors" },
  { key: "backupFailed", label: "Backup failed alert", desc: "Backup did not complete" },
  { key: "subscriptionExpiry", label: "Subscription expiry alert", desc: "Before your plan renews" },
] as const;
const TEMPLATES = [
  { key: "udhar", title: "Udhar payment reminder", preview: "Namaste {name} ji, aapka ₹{amount} udhar baki hai. Kripya payment kar dein." },
  { key: "thanks", title: "Thank you after payment", preview: "Dhanyavaad {name} ji! Aapka ₹{amount} payment mil gaya hai." },
  { key: "billShared", title: "Bill shared message", preview: "{store} — aapka bill #{billno}: ₹{total}. Dhanyavaad!" },
  { key: "lowStockBuy", title: "Low stock purchase reminder", preview: "{product} ka stock kam hai ({qty} bacha). Order karein?" },
];
const HISTORY = [
  { type: "Udhar Reminder", to: "Ramesh", status: "sent", time: "11:42 AM" },
  { type: "Low Stock", to: "Owner", status: "sent", time: "10:00 AM" },
  { type: "Backup Failed", to: "Owner", status: "failed", time: "Yesterday" },
];

interface NotifConfig {
  channels: Record<string, boolean>;
  alerts: Record<string, boolean>;
  dailyEnabled: boolean;
  dailyTime: string;
  dailySales: boolean;
  dailyProfit: boolean;
  dailyUdhar: boolean;
  dailyLowStock: boolean;
  dailyCashUpi: boolean;
  templates: Record<string, string>;
}
const DEFAULT_NOTIF: NotifConfig = {
  channels: { inApp: true, whatsapp: true, sms: false, email: true, push: true },
  alerts: Object.fromEntries(ALERTS.map((a) => [a.key, a.key !== "negativeStock"])),
  dailyEnabled: true, dailyTime: "21:00", dailySales: true, dailyProfit: true, dailyUdhar: true, dailyLowStock: true, dailyCashUpi: true,
  templates: Object.fromEntries(TEMPLATES.map((t) => [t.key, t.preview])),
};

export default function NotificationsSettingsPage() {
  const { toast } = useToast();
  const { prefs, patch, hydrated } = useSettingsPrefs();
  const [n, setN] = useState<NotifConfig>(DEFAULT_NOTIF);
  const [editing, setEditing] = useState<(typeof TEMPLATES)[number] | null>(null);
  const [draft, setDraft] = useState("");
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !hydrated) return;
    seeded.current = true;
    const saved = (prefs.notifications ?? {}) as Partial<NotifConfig>;
    setN({
      ...DEFAULT_NOTIF,
      ...saved,
      channels: { ...DEFAULT_NOTIF.channels, ...(saved.channels ?? {}) },
      alerts: { ...DEFAULT_NOTIF.alerts, ...(saved.alerts ?? {}) },
      templates: { ...DEFAULT_NOTIF.templates, ...(saved.templates ?? {}) },
    });
  }, [hydrated, prefs.notifications]);

  const update = (partial: Partial<NotifConfig>) => { const next = { ...n, ...partial }; setN(next); patch({ notifications: next }); };
  const saveTemplate = () => {
    if (!editing) return;
    const value = draft.trim();
    if (!value) {
      toast({ title: "Template is empty", description: "Add message text before saving.", variant: "destructive" });
      return;
    }
    update({ templates: { ...n.templates, [editing.key]: value } });
    setEditing(null);
    toast({ title: "Template saved" });
  };
  const sendTemplateTest = (template: (typeof TEMPLATES)[number]) => {
    const message = (n.templates[template.key] ?? template.preview)
      .replaceAll("{name}", "Ramesh")
      .replaceAll("{amount}", "850")
      .replaceAll("{store}", "KiranaOS")
      .replaceAll("{billno}", "KOS-0001")
      .replaceAll("{product}", "Sugar")
      .replaceAll("{qty}", "2 kg");
    void navigator.clipboard?.writeText(message);
    toast({ title: "Sample copied", description: "Paste it in WhatsApp/SMS to test the final text." });
  };

  return (
    <SettingsShell>
      {/* Channels */}
      <Card>
        <CardHead icon={<Bell size={15} />} title="Notification Channels" sub="How alerts reach you" />
        <div className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-5">
          {CHANNELS.map((c) => {
            const on = n.channels[c.key] ?? false;
            return (
              <div key={c.key} className="rounded-[12px] border border-[#e7edf7] px-3 py-3">
                <div className="flex items-center justify-between">
                  <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-[#eef5ff] text-[#005dff]"><c.icon size={15} /></span>
                  <Switch checked={on} onCheckedChange={(v) => update({ channels: { ...n.channels, [c.key]: v } })} />
                </div>
                <p className="mt-2 text-[13px] font-bold text-[#102347]">{c.label}</p>
                <Badge tone={on ? "green" : "gray"}>{on ? "Connected" : "Off"}</Badge>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Alert Rules */}
        <Card>
          <CardHead icon={<Bell size={15} />} title="Alert Rules" sub="What you get notified about" />
          <div className="px-5 pb-4">
            {ALERTS.map((a, i) => (
              <RowToggle key={a.key} label={a.label} desc={a.desc} last={i === ALERTS.length - 1}
                pill={<Switch checked={n.alerts[a.key] ?? false} onCheckedChange={(v) => update({ alerts: { ...n.alerts, [a.key]: v } })} />} />
            ))}
          </div>
        </Card>

        {/* Reminder Templates */}
        <Card>
          <CardHead icon={<MessageCircle size={15} />} title="Reminder Templates" sub="Editable messages with placeholders" />
          <div className="space-y-2.5 px-5 pb-5">
            {TEMPLATES.map((t) => (
              <div key={t.key} className="rounded-[10px] border border-[#eef2f8] px-3.5 py-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-bold text-[#102347]">{t.title}</p>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditing(t); setDraft(n.templates[t.key] ?? t.preview); }} className="text-[12px] font-bold text-[#005dff] hover:underline">Edit</button>
                    <button onClick={() => sendTemplateTest(t)} className="inline-flex items-center gap-1 text-[12px] font-bold text-[#005dff] hover:underline"><Send size={11} /> Test</button>
                  </div>
                </div>
                <p className="mt-1 truncate text-[11px] text-[#64748b]">{n.templates[t.key] ?? t.preview}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Daily Summary */}
        <Card>
          <CardHead icon={<Bell size={15} />} title="Daily Summary" sub="End-of-day recap to the owner" />
          <div className="px-5 pb-4">
            <RowToggle label="Enable daily summary" pill={<Switch checked={n.dailyEnabled} onCheckedChange={(v) => update({ dailyEnabled: v })} />} />
            <RowToggle label="Summary time" pill={<Input className="h-8 w-[110px] text-[12px]" type="time" value={n.dailyTime} onChange={(e) => update({ dailyTime: e.target.value })} />} />
            <RowToggle label="Include sales total" pill={<Switch checked={n.dailySales} onCheckedChange={(v) => update({ dailySales: v })} />} />
            <RowToggle label="Include profit" pill={<Switch checked={n.dailyProfit} onCheckedChange={(v) => update({ dailyProfit: v })} />} />
            <RowToggle label="Include udhar collection" pill={<Switch checked={n.dailyUdhar} onCheckedChange={(v) => update({ dailyUdhar: v })} />} />
            <RowToggle label="Include low stock" pill={<Switch checked={n.dailyLowStock} onCheckedChange={(v) => update({ dailyLowStock: v })} />} />
            <RowToggle label="Include cash / UPI breakup" pill={<Switch checked={n.dailyCashUpi} onCheckedChange={(v) => update({ dailyCashUpi: v })} />} last />
          </div>
        </Card>

        {/* Notification History */}
        <Card>
          <CardHead icon={<Send size={15} />} title="Notification History" sub="Recently sent" />
          <div className="px-5 pb-4">
            {HISTORY.map((h, i) => (
              <div key={i} className={`flex items-center gap-3 py-2.5 ${i < HISTORY.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-[#102347]">{h.type}</p>
                  <p className="text-[11px] text-[#64748b]">To {h.to} · {h.time}</p>
                </div>
                {h.status === "sent" ? <Badge tone="green">Sent</Badge> : <Badge tone="red">Failed</Badge>}
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="font-display text-[17px] font-black tracking-tight text-[#0f1e3d]">{editing?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <textarea
              className="min-h-[120px] w-full resize-y rounded-[10px] border border-[#dbe6f7] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#005dff]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <p className="text-[11px] text-[#64748b]">Available placeholders: {"{name}"}, {"{amount}"}, {"{store}"}, {"{billno}"}, {"{product}"}, {"{qty}"}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="h-10 rounded-[10px] font-bold" onClick={() => setEditing(null)}>Cancel</Button>
              <Button className="h-10 rounded-[10px] bg-[#005dff] font-black text-white hover:bg-[#0047e8]" onClick={saveTemplate}>Save template</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsShell>
  );
}
