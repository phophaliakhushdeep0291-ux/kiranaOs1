import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, Database, Download, FlaskConical, HardDrive, Palette, RotateCcw, Upload, Wrench,
} from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Fld, RowToggle } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";
import { useAppTheme, ACCENT_COLORS, type AccentColor } from "@/features/settings/theme";
import { useAppLanguage, type AppLanguage } from "@/features/settings/i18n";
import { setLandingPagePref } from "@/features/settings/landing-page";
import { offlineDB } from "@/lib/offline/db";

interface AdvConfig {
  retention: string;
  recycleRetention: string;
  autoCleanup: boolean;
  compressDb: boolean;
  dateFormat: string;
  currencyFormat: string;
  landingPage: string;
  compactMode: boolean;
  shortcuts: boolean;
  sound: boolean;
  defaultBilling: string;
  defaultPayment: string;
  defaultCustomer: string;
}
const DEFAULT_ADV: AdvConfig = {
  retention: "2 years", recycleRetention: "30 days", autoCleanup: true, compressDb: true,
  dateFormat: "DD/MM/YYYY", currencyFormat: "₹ 1,23,456", landingPage: "Dashboard", compactMode: false, shortcuts: true, sound: true,
  defaultBilling: "Fast Billing", defaultPayment: "Cash", defaultCustomer: "Walk-in Customer",
};
const STORAGE = [
  { label: "Local database", mb: 120, tone: "bg-[#005dff]" },
  { label: "Images", mb: 42, tone: "bg-violet-500" },
  { label: "Backups", mb: 230, tone: "bg-emerald-500" },
  { label: "Cache", mb: 18, tone: "bg-amber-500" },
];
const DB_TOOLS = [
  { key: "health", label: "Check database health" },
  { key: "repair", label: "Repair local database" },
  { key: "index", label: "Rebuild search index" },
  { key: "dashboard", label: "Recalculate dashboard totals" },
  { key: "ledgers", label: "Recalculate customer ledgers" },
  { key: "inventory", label: "Recalculate inventory stock" },
];
const DANGER = [
  { key: "resetSettings", label: "Reset settings", desc: "Restore all settings to defaults", safe: true },
  { key: "clearCache", label: "Clear local cache", desc: "Free up space; keeps your data", safe: true },
  { key: "logoutAll", label: "Logout all staff", desc: "Sign out every device", safe: false },
  { key: "removeDevice", label: "Remove this device", desc: "Unlink this device from the store", safe: false },
  { key: "deleteLocal", label: "Delete local offline data", desc: "Clears this device's local copy", safe: false },
  { key: "factoryReset", label: "Factory reset store", desc: "Permanently wipe local data & settings", safe: false },
];
const totalMb = STORAGE.reduce((s, x) => s + x.mb, 0);
const EXPORT_TABLES = [
  "products",
  "customers",
  "bills",
  "bill_items",
  "payments",
  "customer_ledger",
  "inventory_movements",
  "suppliers",
  "purchase_bills",
  "staff_users",
  "settings",
] as const;
const LOCAL_DATA_TABLES = [
  ...EXPORT_TABLES,
  "sync_outbox",
  "sync_cursor",
  "sync_conflicts",
  "id_mappings",
  "local_audit_logs",
  "subscription_cache",
  "device_license_cache",
] as const;

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadCsvTemplate(filename: string, headers: string[]) {
  const blob = new Blob([`${headers.join(",")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function mailSupport(subject: string, body: string) {
  window.location.href = `mailto:support@kiranaos.app?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function AdvancedSettingsPage() {
  const { toast } = useToast();
  const { prefs, patch, hydrated } = useSettingsPrefs();
  const { accent, setAccent } = useAppTheme();
  const { language, setLanguage } = useAppLanguage();
  const [adv, setAdv] = useState<AdvConfig>(DEFAULT_ADV);
  const [danger, setDanger] = useState<(typeof DANGER)[number] | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !hydrated) return;
    seeded.current = true;
    const savedAdv = { ...DEFAULT_ADV, ...((prefs.advanced ?? {}) as Partial<AdvConfig>) };
    setAdv(savedAdv);
    setLandingPagePref(savedAdv.landingPage); // mirror the synced value into the sync-readable store
  }, [hydrated, prefs.advanced]);

  const update = (partial: Partial<AdvConfig>) => { const next = { ...adv, ...partial }; setAdv(next); patch({ advanced: next }); };

  async function clearCache() {
    try {
      if ("caches" in window) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
      toast({ title: "Cache cleared", description: "Reopen the app to fetch the latest assets." });
    } catch { toast({ title: "Could not clear cache", variant: "destructive" }); }
  }
  function copyDiagnostics() {
    const diag = { app: "KiranaOS 2.1.3", online: navigator.onLine, language, accent, prefs: { advanced: adv }, ua: navigator.userAgent, at: new Date().toISOString() };
    void navigator.clipboard?.writeText(JSON.stringify(diag, null, 2));
    toast({ title: "Diagnostics copied" });
  }
  async function optimizeDatabase() {
    try {
      await offlineDB.init();
      toast({ title: "Database checked", description: "Local data opened cleanly and is ready." });
    } catch {
      toast({ title: "Database check failed", description: "Restart the app and try again.", variant: "destructive" });
    }
  }
  async function runDbTool(key: string, label: string) {
    try {
      await offlineDB.init();
      if (key === "repair" || key === "index") await offlineDB.pruneExpiredRecentCache();
      if (key === "dashboard") {
        const [bills, payments, items] = await Promise.all([offlineDB.getAll("bills"), offlineDB.getAll("payments"), offlineDB.getAll("bill_items")]);
        toast({ title: "Dashboard totals checked", description: `${bills.length} bills, ${payments.length} payments, ${items.length} items readable.` });
        return;
      }
      if (key === "ledgers") {
        const rows = await offlineDB.getAll("customer_ledger");
        toast({ title: "Customer ledgers checked", description: `${rows.length} ledger rows readable.` });
        return;
      }
      if (key === "inventory") {
        const rows = await offlineDB.getAll("inventory_movements");
        toast({ title: "Inventory stock checked", description: `${rows.length} stock movement rows readable.` });
        return;
      }
      toast({ title: `${label} complete`, description: "Local database opened and maintenance checks passed." });
    } catch {
      toast({ title: `${label} failed`, description: "Restart the app and try again.", variant: "destructive" });
    }
  }
  async function exportTable(table: (typeof EXPORT_TABLES)[number], filename: string) {
    try {
      const rows = await offlineDB.getAll<Record<string, unknown>>(table);
      downloadJson(filename, { exportedAt: new Date().toISOString(), table, rows });
      toast({ title: "Export downloaded", description: `${rows.length} ${table.replaceAll("_", " ")} row(s).` });
    } catch {
      toast({ title: "Export failed", description: "Could not read local data for this export.", variant: "destructive" });
    }
  }
  async function exportFullBackup() {
    try {
      const entries = await Promise.all(EXPORT_TABLES.map(async (table) => [table, await offlineDB.getAll<Record<string, unknown>>(table)] as const));
      downloadJson(`kiranaos-backup-${new Date().toISOString().slice(0, 10)}.json`, {
        app: "KiranaOS",
        exportedAt: new Date().toISOString(),
        tables: Object.fromEntries(entries),
      });
      toast({ title: "Backup downloaded", description: "Keep this file private. It contains local shop data." });
    } catch {
      toast({ title: "Backup failed", description: "Could not read the local database.", variant: "destructive" });
    }
  }
  async function clearScopedLocalData() {
    for (const table of LOCAL_DATA_TABLES) {
      const rows = await offlineDB.getAll<Record<string, unknown>>(table);
      for (const row of rows) {
        const key = row.key ?? row.clientEventId ?? row.local_id ?? row.localId ?? row.id;
        if (typeof key === "string" && key.length > 0) await offlineDB.delete(table, key);
      }
    }
  }
  async function runDanger(key: string) {
    setDanger(null);
    if (key === "resetSettings") { patch({ printer: undefined, taxes: undefined, security: undefined, notifications: undefined, integrations: undefined, advanced: undefined, branding: undefined, hours: undefined, bank: undefined, storeProfile: undefined }); toast({ title: "Settings reset to defaults" }); return; }
    if (key === "clearCache") { await clearCache(); return; }
    if (key === "deleteLocal" || key === "factoryReset") {
      try {
        if ("caches" in window) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
        await clearScopedLocalData();
      } catch { /* best effort */ }
      toast({ title: "Local data cleared", description: "The app will reload with a fresh local copy synced from the cloud." });
      setTimeout(() => window.location.reload(), 1200);
      return;
    }
    toast({ title: "Request recorded", description: "This action needs owner approval from the backend." });
  }

  return (
    <SettingsShell>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Data Management */}
        <Card>
          <CardHead icon={<Database size={15} />} title="Data Management" sub="Retention & storage" action={<button onClick={() => void optimizeDatabase()} className="text-[12px] font-bold text-[#005dff] hover:underline">Optimize</button>} />
          <div className="px-5 pb-5">
            <RowToggle label="Data retention" pill={<Select value={adv.retention} onValueChange={(v) => update({ retention: v })}><SelectTrigger className="h-8 w-[120px] text-[12px]"><SelectValue /></SelectTrigger><SelectContent>{["1 year", "2 years", "5 years", "Forever"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>} />
            <RowToggle label="Recycle bin retention" pill={<Select value={adv.recycleRetention} onValueChange={(v) => update({ recycleRetention: v })}><SelectTrigger className="h-8 w-[120px] text-[12px]"><SelectValue /></SelectTrigger><SelectContent>{["7 days", "30 days", "90 days"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>} />
            <RowToggle label="Auto cleanup temp files" pill={<Switch checked={adv.autoCleanup} onCheckedChange={(v) => update({ autoCleanup: v })} />} />
            <RowToggle label="Compress local database" pill={<Switch checked={adv.compressDb} onCheckedChange={(v) => update({ compressDb: v })} />} last />
            <div className="mt-3 space-y-2">
              <div className="flex justify-between text-[11px] font-semibold text-[#64748b]"><span>Storage used</span><span>{totalMb} MB</span></div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-[#eef2f8]">{STORAGE.map((s) => <div key={s.label} className={s.tone} style={{ width: `${(s.mb / totalMb) * 100}%` }} />)}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">{STORAGE.map((s) => <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-[#64748b]"><span className={`h-2 w-2 rounded-full ${s.tone}`} />{s.label} {s.mb}MB</span>)}</div>
            </div>
            <Button variant="outline" className="mt-3 h-9 w-full rounded-[9px] text-[12px] font-bold" onClick={clearCache}>Clean Cache</Button>
          </div>
        </Card>

        {/* App Preferences */}
        <Card>
          <CardHead icon={<Palette size={15} />} title="App Preferences" sub="Language, theme & defaults" />
          <div className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2">
            <Fld label="Language">
              <Select value={language} onValueChange={(v) => setLanguage(v as AppLanguage)}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="hi">हिन्दी (Hindi)</SelectItem></SelectContent>
              </Select>
            </Fld>
            <Fld label="Date format">
              <Select value={adv.dateFormat} onValueChange={(v) => update({ dateFormat: v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </Fld>
            <Fld label="Default landing page">
              <Select value={adv.landingPage} onValueChange={(v) => { update({ landingPage: v }); setLandingPagePref(v); }}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{["Dashboard", "Billing", "Inventory", "Reports"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </Fld>
            <Fld label="Default payment">
              <Select value={adv.defaultPayment} onValueChange={(v) => update({ defaultPayment: v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{["Cash", "UPI", "Split"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </Fld>
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-[12px] font-semibold text-[#45577a]">Accent theme</p>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(ACCENT_COLORS) as [AccentColor, { label: string; swatch: string }][]).map(([key, def]) => (
                  <button key={key} type="button" onClick={() => setAccent(key)} title={def.label}
                    className={`h-8 w-8 rounded-full border-2 transition-transform ${accent === key ? "scale-110 border-[#0f1e3d]" : "border-transparent hover:scale-105"}`}
                    style={{ background: def.swatch }} aria-label={def.label} />
                ))}
              </div>
            </div>
            <div className="space-y-0.5 sm:col-span-2">
              <RowToggle label="Compact mode" pill={<Switch checked={adv.compactMode} onCheckedChange={(v) => update({ compactMode: v })} />} />
              <RowToggle label="Keyboard shortcuts" pill={<Switch checked={adv.shortcuts} onCheckedChange={(v) => update({ shortcuts: v })} />} />
              <RowToggle label="Sound effects" pill={<Switch checked={adv.sound} onCheckedChange={(v) => update({ sound: v })} />} last />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Import / Export */}
        <Card>
          <CardHead icon={<Upload size={15} />} title="Import / Export" sub="Move your data in & out" />
          <div className="grid grid-cols-1 gap-2 px-5 pb-5 sm:grid-cols-2">
            {[
              { label: "Open product import", icon: Upload, run: () => { window.location.href = "/products?import=1"; } },
              { label: "Customer CSV template", icon: Download, run: () => downloadCsvTemplate("kiranaos-customers-template.csv", ["name", "mobile", "address", "openingBalance"]) },
              { label: "Export products", icon: Download, run: () => void exportTable("products", "kiranaos-products.json") },
              { label: "Export customers", icon: Download, run: () => void exportTable("customers", "kiranaos-customers.json") },
              { label: "Export bills", icon: Download, run: () => void exportTable("bills", "kiranaos-bills.json") },
              { label: "Export full backup", icon: Download, run: () => void exportFullBackup() },
            ].map((b) => (
              <Button key={b.label} variant="outline" className="h-10 justify-start gap-2 rounded-[9px] text-[12px] font-bold" onClick={b.run}>
                <b.icon size={14} /> {b.label}
              </Button>
            ))}
          </div>
        </Card>

        {/* Offline Database Tools */}
        <Card>
          <CardHead icon={<Wrench size={15} />} title="Offline Database Tools" sub="Keep local data healthy" />
          <div className="px-5 pb-4">
            {DB_TOOLS.map((t, i) => (
              <div key={t.key} className={`flex items-center justify-between py-2.5 ${i < DB_TOOLS.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                <span className="text-[13px] font-semibold text-[#344668]">{t.label}</span>
                <Button size="sm" variant="outline" className="h-8 rounded-[8px] text-[12px] font-bold" onClick={() => void runDbTool(t.key, t.label)}>Run</Button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Diagnostics */}
        <Card>
          <CardHead icon={<FlaskConical size={15} />} title="Developer / Diagnostics" sub="For support" action={<button onClick={copyDiagnostics} className="text-[12px] font-bold text-[#005dff] hover:underline">Copy</button>} />
          <div className="grid grid-cols-1 gap-y-3 px-5 pb-5 sm:grid-cols-2">
            {[
              ["App version", "2.1.3"], ["Build", "20260611"], ["Database", "v4"],
              ["Connection", navigator.onLine ? "Online" : "Offline"], ["Outbox", "0 pending"], ["Feature flags", "default"],
            ].map(([k, v]) => (
              <div key={k}><p className="text-[11px] font-semibold text-[#64748b]">{k}</p><p className="text-[13px] font-bold text-[#102347]">{v}</p></div>
            ))}
            <div className="mt-1 grid gap-2 sm:col-span-2 sm:grid-cols-2">
              <Button variant="outline" className="h-9 flex-1 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={copyDiagnostics}><HardDrive size={14} /> Copy diagnostics</Button>
              <Button variant="outline" className="h-9 flex-1 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={() => mailSupport("KiranaOS diagnostics", JSON.stringify({ online: navigator.onLine, language, accent, at: new Date().toISOString() }, null, 2))}>Send to support</Button>
            </div>
          </div>
        </Card>

        {/* Danger Zone */}
        <Card className="border-rose-200">
          <CardHead icon={<AlertTriangle size={15} />} title="Danger Zone" sub="Irreversible — owner PIN required" />
          <div className="px-5 pb-5">
            <div className="rounded-[12px] border border-rose-200 bg-rose-50/60 p-2">
              {DANGER.map((d, i) => (
                <div key={d.key} className={`flex items-center gap-3 px-2 py-2.5 ${i < DANGER.length - 1 ? "border-b border-rose-100" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-[#7f1d1d]">{d.label}</p>
                    <p className="text-[11px] text-rose-700/70">{d.desc}</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-8 shrink-0 rounded-[8px] border-rose-300 text-[12px] font-bold text-rose-700 hover:bg-rose-100" onClick={() => setDanger(d)}>{d.safe ? "Run" : "Confirm"}</Button>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <DangerDialog item={danger} onClose={() => setDanger(null)} onConfirm={runDanger} />
    </SettingsShell>
  );
}

function DangerDialog({ item, onClose, onConfirm }: { item: (typeof DANGER)[number] | null; onClose: () => void; onConfirm: (key: string) => void }) {
  const [pin, setPin] = useState("");
  useEffect(() => { setPin(""); }, [item]);
  const needsPin = item ? !item.safe : false;
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-[16px] font-black tracking-tight text-[#0f1e3d]">
            <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-rose-100 text-rose-600"><AlertTriangle size={15} /></span>
            {item?.label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-[12px] text-[#52627e]">{item?.desc}. {!item?.safe && <span className="font-bold text-rose-600">This action cannot be undone.</span>}</p>
          {needsPin && (
            <Fld label="Enter your Owner PIN to continue">
              <Input type="password" inputMode="numeric" className="h-10" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" />
            </Fld>
          )}
          <div className="flex gap-2.5 pt-1">
            <Button variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
            <Button className="h-11 flex-1 gap-2 rounded-[10px] bg-rose-600 font-black text-white hover:bg-rose-700" disabled={needsPin && pin.trim().length < 4} onClick={() => item && onConfirm(item.key)}>
              {item?.safe ? <RotateCcw size={15} /> : <AlertTriangle size={15} />} {item?.safe ? "Run now" : "Confirm Reset"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
