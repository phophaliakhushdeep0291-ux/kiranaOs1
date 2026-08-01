import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, Database, Download, FlaskConical, HardDrive, Loader2, Palette, RotateCcw, Upload, Wrench,
} from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Fld, RowToggle } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";
import { useAppTheme, ACCENT_COLORS, type AccentColor } from "@/features/settings/theme";
import { useAppLanguage, type AppLanguage } from "@/features/settings/i18n";
import { setLandingPagePref } from "@/features/settings/landing-page";
import { appVersion, buildId, databaseVersion, formatBytes, measureStorage, SUPPORT_EMAIL } from "@/features/settings/app-info";
import { DATE_FORMATS, applyAppPreferences } from "@/features/settings/app-preferences";
import { verifyOwnerPin } from "@/features/settings/api";
import { useAuth } from "@/features/auth/useAuth";
import { listDevices, logoutDevice, removeDevice, type DeviceDto } from "@/features/devices/api";
import { getOfflineScope } from "@/lib/offline/context";
import { offlineDB } from "@/lib/offline/db";
import { clearInstantMemoryCache } from "@/lib/offline/instant-cache";
import { EXPORT_TABLES, LOCAL_DATA_TABLES } from "@/lib/offline/local-data-tables";

function resolveDeviceId(device: DeviceDto) {
  return device.deviceId || device.device_id || device.id;
}

/**
 * Only preferences something in the app actually reads live here. "Data
 * retention" and "Compress local database" used to sit on this page as
 * switches nothing consulted — retention is a server-side policy and Dexie has
 * no compaction knob — so they were removed rather than left as decoration.
 */
interface AdvConfig {
  autoCleanup: boolean;
  dateFormat: string;
  landingPage: string;
  compactMode: boolean;
  shortcuts: boolean;
  sound: boolean;
  defaultPayment: string;
}
const DEFAULT_ADV: AdvConfig = {
  autoCleanup: true,
  dateFormat: "DD/MM/YYYY", landingPage: "Dashboard", compactMode: false, shortcuts: true, sound: true,
  defaultPayment: "Cash",
};
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
  { key: "logoutAll", label: "Logout all other devices", desc: "Sign out every device except this one", safe: false },
  { key: "removeDevice", label: "Remove this device", desc: "Unlink this device from the store", safe: false },
  { key: "deleteLocal", label: "Delete local offline data", desc: "Clears this device's local copy", safe: false },
  { key: "factoryReset", label: "Factory reset store", desc: "Permanently wipe local data & settings", safe: false },
];
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
  window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function AdvancedSettingsPage() {
  const { toast } = useToast();
  const { prefs, patch, hydrated } = useSettingsPrefs();
  const { accent, setAccent } = useAppTheme();
  const { language, setLanguage } = useAppLanguage();
  const { logout } = useAuth();
  const [adv, setAdv] = useState<AdvConfig>(DEFAULT_ADV);
  const [danger, setDanger] = useState<(typeof DANGER)[number] | null>(null);
  const [dangerError, setDangerError] = useState<string | null>(null);
  const [dangerRunning, setDangerRunning] = useState(false);
  const seeded = useRef(false);
  const currentDeviceId = getOfflineScope().device_id;

  const storageQ = useQuery({ queryKey: ["advanced", "storage"], queryFn: measureStorage, staleTime: 15_000 });
  const outboxQ = useQuery({
    queryKey: ["advanced", "outbox"],
    queryFn: async () => ({
      pending: await offlineDB.getPendingCount().catch(() => 0),
      conflicts: (await offlineDB.getAll("sync_conflicts").catch(() => [])).length,
    }),
    refetchInterval: 20_000,
  });

  useEffect(() => {
    if (seeded.current || !hydrated) return;
    seeded.current = true;
    const savedAdv = { ...DEFAULT_ADV, ...((prefs.advanced ?? {}) as Partial<AdvConfig>) };
    setAdv(savedAdv);
    setLandingPagePref(savedAdv.landingPage); // mirror the synced value into the sync-readable store
    applyAppPreferences(savedAdv);
  }, [hydrated, prefs.advanced]);

  const update = (partial: Partial<AdvConfig>) => {
    const next = { ...adv, ...partial };
    setAdv(next);
    applyAppPreferences(next); // compact mode / shortcuts / sound take effect immediately
    patch({ advanced: next });
  };

  const storage = storageQ.data;

  async function clearCache() {
    try {
      if ("caches" in window) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
      toast({ title: "Cache cleared", description: "Reopen the app to fetch the latest assets." });
    } catch { toast({ title: "Could not clear cache", variant: "destructive" }); }
  }
  function diagnosticsPayload() {
    return {
      app: `Artha ${appVersion()}`,
      build: buildId(),
      database: databaseVersion(),
      online: navigator.onLine,
      outbox: outboxQ.data ?? null,
      storageBytes: storage?.usageBytes ?? null,
      quotaBytes: storage?.quotaBytes ?? null,
      localRecords: storage?.totalRows ?? null,
      language,
      accent,
      prefs: { advanced: adv },
      ua: navigator.userAgent,
      at: new Date().toISOString(),
    };
  }
  function copyDiagnostics() {
    void navigator.clipboard?.writeText(JSON.stringify(diagnosticsPayload(), null, 2));
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
      downloadJson(`artha-backup-${new Date().toISOString().slice(0, 10)}.json`, {
        app: "Artha",
        exportedAt: new Date().toISOString(),
        tables: Object.fromEntries(entries),
      });
      toast({ title: "Backup downloaded", description: "Keep this file private. It contains local shop data." });
    } catch {
      toast({ title: "Backup failed", description: "Could not read the local database.", variant: "destructive" });
    }
  }
  async function clearScopedLocalData() {
    // Delete by each store's real primary key (see offlineDB.clearScopedData) so
    // synced rows — where `id` ≠ `local_id` — are actually removed. The old guess
    // deleted synced customers/bills/ledger by `local_id`, which no-ops, so the
    // wipe left them behind.
    await offlineDB.clearScopedData([...LOCAL_DATA_TABLES]);
    // The instant cache (in-memory map + the settings-backed recent cache) mirrors
    // these tables for instant paint. Without clearing it the just-wiped customers
    // and ledgers repaint straight from memory and the wipe appears to do nothing.
    clearInstantMemoryCache();
  }
  /**
   * Every destructive action goes through here with a PIN the *server* checked.
   * The dialog used to accept any four characters and then only toast, which
   * meant "Logout all staff" and "Remove this device" quietly did nothing.
   */
  async function runDanger(key: string, ownerPin: string) {
    setDangerRunning(true);
    setDangerError(null);
    try {
      if (key !== "resetSettings" && key !== "clearCache") await verifyOwnerPin(ownerPin);

      if (key === "resetSettings") {
        patch({ printer: undefined, taxes: undefined, security: undefined, notifications: undefined, integrations: undefined, advanced: undefined, branding: undefined, hours: undefined, bank: undefined, storeProfile: undefined });
        setAdv(DEFAULT_ADV);
        applyAppPreferences(DEFAULT_ADV);
        setLandingPagePref(DEFAULT_ADV.landingPage);
        setDanger(null);
        toast({ title: "Settings reset to defaults" });
        return;
      }
      if (key === "clearCache") { setDanger(null); await clearCache(); return; }

      if (key === "logoutAll") {
        const snapshot = await listDevices();
        const others = (snapshot.devices ?? []).filter((device) => resolveDeviceId(device) !== currentDeviceId);
        if (others.length === 0) {
          setDanger(null);
          toast({ title: "No other devices", description: "This is the only device signed in to the shop." });
          return;
        }
        let signedOut = 0;
        for (const device of others) {
          try {
            await logoutDevice(resolveDeviceId(device), ownerPin, currentDeviceId);
            signedOut += 1;
          } catch { /* keep going; the count below reports what actually happened */ }
        }
        setDanger(null);
        toast({
          title: signedOut ? `${signedOut} device(s) signed out` : "No device could be signed out",
          description: signedOut === others.length ? "Every other device must sign in again." : `${others.length - signedOut} could not be signed out — check Device Management.`,
          variant: signedOut ? undefined : "destructive",
        });
        return;
      }

      if (key === "removeDevice") {
        await removeDevice(currentDeviceId, ownerPin, { removeCurrentDevice: true });
        setDanger(null);
        toast({ title: "Device removed", description: "Signing out — this device is no longer linked to the shop." });
        setTimeout(() => void logout(), 1200);
        return;
      }

      if (key === "deleteLocal" || key === "factoryReset") {
        // Wipe local DATA only. Do NOT delete the PWA app-shell cache here (that is
        // what "Clean Cache" is for): removing the cached JS/HTML while the service
        // worker is live can leave the reload with nothing to render — a blank screen.
        try {
          await clearScopedLocalData();
        } catch { /* best effort */ }
        if (key === "factoryReset") {
          patch({ printer: undefined, taxes: undefined, security: undefined, notifications: undefined, integrations: undefined, advanced: undefined, branding: undefined, hours: undefined, bank: undefined, storeProfile: undefined });
        }
        setDanger(null);
        toast({ title: "Local data cleared", description: "The app will reload with a fresh local copy synced from the cloud." });
        setTimeout(() => window.location.reload(), 900);
        return;
      }
      setDanger(null);
    } catch (error) {
      setDangerError((error as { data?: { message?: string }; message?: string })?.data?.message
        ?? (error as { message?: string })?.message
        ?? "Could not complete this action.");
    } finally {
      setDangerRunning(false);
      void storageQ.refetch();
    }
  }

  return (
    <SettingsShell>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Data Management */}
        <Card>
          <CardHead icon={<Database size={15} />} title="Data Management" sub="Retention & storage" action={<button onClick={() => void optimizeDatabase()} className="text-[12px] font-bold text-[var(--brand)] hover:underline">Optimize</button>} />
          <div className="px-5 pb-5">
            <RowToggle
              label="Auto cleanup temp files"
              desc="Prune expired caches and synced history every 10 minutes"
              pill={<Switch checked={adv.autoCleanup} onCheckedChange={(v) => update({ autoCleanup: v })} />}
              last
            />
            <div className="mt-3 space-y-2">
              <div className="flex justify-between text-[11px] font-semibold text-[#64748b]">
                <span>Storage used on this device</span>
                <span>{storage?.measured ? `${formatBytes(storage.usageBytes)}${storage.quotaBytes ? ` of ${formatBytes(storage.quotaBytes)}` : ""}` : "Not reported by this browser"}</span>
              </div>
              {storage?.measured && storage.quotaBytes ? (
                <div className="h-2.5 overflow-hidden rounded-full bg-[#eef2f8]">
                  <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${Math.min(100, Math.max(1, ((storage.usageBytes ?? 0) / storage.quotaBytes) * 100))}%` }} />
                </div>
              ) : null}
              <p className="text-[11px] font-semibold text-[#64748b]">{storage ? `${storage.totalRows.toLocaleString("en-IN")} local records` : "Measuring…"}</p>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-[#eef2f8]">
                {(storage?.slices ?? []).filter((s) => s.rows > 0).map((s) => (
                  <div key={s.label} className={s.tone} style={{ width: `${(s.rows / Math.max(1, storage?.totalRows ?? 1)) * 100}%` }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {(storage?.slices ?? []).map((s) => (
                  <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-[#64748b]"><span className={`h-2 w-2 rounded-full ${s.tone}`} />{s.label} {s.rows.toLocaleString("en-IN")}</span>
                ))}
              </div>
            </div>
            <Button variant="outline" className="mt-3 h-9 w-full rounded-[9px] text-[12px] font-bold" onClick={() => void clearCache()}>
              Clean Cache{storage?.cacheNames ? ` (${storage.cacheNames})` : ""}
            </Button>
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
                <SelectContent>{DATE_FORMATS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
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
                    className={`h-8 w-8 rounded-full border-2 transition-transform ${accent === key ? "scale-110 border-[var(--brand-ink)]" : "border-transparent hover:scale-105"}`}
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
              { label: "Customer CSV template", icon: Download, run: () => downloadCsvTemplate("artha-customers-template.csv", ["name", "mobile", "address", "openingBalance"]) },
              { label: "Export products", icon: Download, run: () => void exportTable("products", "artha-products.json") },
              { label: "Export customers", icon: Download, run: () => void exportTable("customers", "artha-customers.json") },
              { label: "Export bills", icon: Download, run: () => void exportTable("bills", "artha-bills.json") },
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
          <CardHead icon={<FlaskConical size={15} />} title="Developer / Diagnostics" sub="For support" action={<button onClick={copyDiagnostics} className="text-[12px] font-bold text-[var(--brand)] hover:underline">Copy</button>} />
          <div className="grid grid-cols-1 gap-y-3 px-5 pb-5 sm:grid-cols-2">
            {[
              ["App version", appVersion()],
              ["Build", buildId()],
              ["Database", databaseVersion()],
              ["Connection", navigator.onLine ? "Online" : "Offline"],
              ["Outbox", outboxQ.data ? `${outboxQ.data.pending} pending · ${outboxQ.data.conflicts} conflict(s)` : "Reading…"],
              ["Storage", storage?.measured ? formatBytes(storage.usageBytes) : "Not reported"],
            ].map(([k, v]) => (
              <div key={k}><p className="text-[11px] font-semibold text-[#64748b]">{k}</p><p className="text-[13px] font-bold text-[var(--brand-ink)]">{v}</p></div>
            ))}
            <div className="mt-1 grid gap-2 sm:col-span-2 sm:grid-cols-2">
              <Button variant="outline" className="h-9 flex-1 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={copyDiagnostics}><HardDrive size={14} /> Copy diagnostics</Button>
              <Button variant="outline" className="h-9 flex-1 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={() => mailSupport("Artha diagnostics", JSON.stringify(diagnosticsPayload(), null, 2))}>Send to support</Button>
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
                  <Button size="sm" variant="outline" className="h-8 shrink-0 rounded-[8px] border-rose-300 text-[12px] font-bold text-rose-700 hover:bg-rose-100" onClick={() => { setDangerError(null); setDanger(d); }}>{d.safe ? "Run" : "Confirm"}</Button>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <DangerDialog
        item={danger}
        error={dangerError}
        running={dangerRunning}
        onClose={() => { setDanger(null); setDangerError(null); }}
        onConfirm={(key, ownerPin) => void runDanger(key, ownerPin)}
      />
    </SettingsShell>
  );
}

function DangerDialog({ item, error, running, onClose, onConfirm }: {
  item: (typeof DANGER)[number] | null;
  error: string | null;
  running: boolean;
  onClose: () => void;
  onConfirm: (key: string, ownerPin: string) => void;
}) {
  const [pin, setPin] = useState("");
  useEffect(() => { setPin(""); }, [item]);
  const needsPin = item ? !item.safe : false;
  return (
    <Dialog open={item !== null} onOpenChange={(o) => { if (!o && !running) onClose(); }}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-[16px] font-black tracking-tight text-[var(--brand-ink)]">
            <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-rose-100 text-rose-600"><AlertTriangle size={15} /></span>
            {item?.label}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => { event.preventDefault(); if (item) onConfirm(item.key, pin.trim()); }}
        >
          <p className="text-[12px] text-[#52627e]">{item?.desc}. {!item?.safe && <span className="font-bold text-rose-600">This action cannot be undone.</span>}</p>
          {needsPin && (
            <Fld label="Enter your Owner PIN to continue" hint="Checked by the server before anything is changed.">
              <Input type="password" inputMode="numeric" autoComplete="off" className="h-10" value={pin} disabled={running} onChange={(e) => setPin(e.target.value)} placeholder="••••" />
            </Fld>
          )}
          {error ? <p role="alert" className="rounded-[8px] bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p> : null}
          <div className="flex gap-2.5 pt-1">
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" disabled={running} onClick={onClose}>Cancel</Button>
            <Button type="submit" className="h-11 flex-1 gap-2 rounded-[10px] bg-rose-600 font-black text-white hover:bg-rose-700" disabled={running || (needsPin && pin.trim().length < 4)}>
              {running ? <Loader2 size={15} className="animate-spin" /> : item?.safe ? <RotateCcw size={15} /> : <AlertTriangle size={15} />}
              {running ? "Working…" : item?.safe ? "Run now" : "Confirm"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
