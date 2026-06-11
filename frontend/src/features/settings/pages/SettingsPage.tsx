import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { getGetShopQueryKey, useChangePassword, useGetShop, useUpdateShop } from "@/lib/api/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Bell, Check, ChevronRight, Cloud, CreditCard, Eye, EyeOff, LifeBuoy, Loader2, MonitorSmartphone, Pencil,
  Plug, Printer, Receipt, Recycle, Settings2, Shield, Sliders, Sparkles, Store, Truck, UsersRound, X,
} from "lucide-react";
import { useAppTheme, ACCENT_COLORS, type AccentColor } from "@/features/settings/theme";
import { useAppLanguage, type AppLanguage } from "@/features/settings/i18n";
import { useSubscriptionSnapshot } from "@/features/subscription";
import { useOfflineStatus } from "@/features/sync";
import { offlineDB } from "@/lib/offline/db";
import { usePanelResize, PanelResizeHandle } from "@/hooks/use-panel-resize";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const shopSchema = z.object({
  name: z.string().min(1),
  ownerName: z.string().min(1),
  city: z.string().min(1),
  address: z.string().min(1),
  gstNumber: z.string().optional(),
  phone: z.string().optional(),
});
type ShopFormData = z.infer<typeof shopSchema>;

const PREFS_KEY = "kirana:settings-prefs:v1";
interface Prefs {
  printPreview: boolean; eInvoice: boolean; hsnTracking: boolean;
  autoSync: boolean; dailyBackup: boolean;
  biometric: boolean; twoFactor: boolean; sessionTimeout: string;
  lowStock: boolean; paymentReminders: boolean; dailySummary: boolean; promotions: boolean;
  gstMode: string; gstRate: string;
}
const DEFAULT_PREFS: Prefs = {
  printPreview: true, eInvoice: true, hsnTracking: true,
  autoSync: true, dailyBackup: true,
  biometric: true, twoFactor: true, sessionTimeout: "15 minutes",
  lowStock: true, paymentReminders: true, dailySummary: true, promotions: false,
  gstMode: "Exclusive (Add to price)", gstRate: "18%",
};

const MENU = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "store", label: "Store Profile", icon: Store },
  { id: "billing", label: "Billing & Subscription", icon: CreditCard, href: "/subscription" },
  { id: "staff", label: "Staff & Permissions", icon: UsersRound, href: "/staff" },
  { id: "devices", label: "Device Management", icon: MonitorSmartphone, href: "/devices" },
  { id: "printer", label: "Printer & Billing", icon: Printer },
  { id: "taxes", label: "Taxes & GST", icon: Receipt },
  { id: "sync", label: "Sync & Backup", icon: Cloud, href: "/sync-status" },
  { id: "security", label: "Security & PIN", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "advanced", label: "Advanced", icon: Sliders },
] as const;

export default function SettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { accent, setAccent } = useAppTheme();
  const { language, setLanguage } = useAppLanguage();
  const { snapshot } = useSubscriptionSnapshot();
  const { isOnline, isSyncing } = useOfflineStatus();
  const shop = useGetShop();
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("general");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const { width: panelWidth, isResizing, isDesktop, onResizeStart } = usePanelResize("kirana:settings-panel-width", { defaultWidth: 440 });

  const serverLoadedRef = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSettings = useUpdateShop({ mutation: { onError: () => undefined } });

  // Instant local load (offline-first)
  useEffect(() => {
    let active = true;
    void offlineDB.getSetting<Partial<Prefs>>(PREFS_KEY).then((saved) => {
      if (active && saved) setPrefs((p) => ({ ...p, ...saved }));
    });
    return () => { active = false; };
  }, []);

  // Server is source of truth on first load (syncs across devices)
  useEffect(() => {
    if (serverLoadedRef.current) return;
    const raw = shop.data?.settingsJson;
    if (raw == null) return;
    serverLoadedRef.current = true;
    try {
      const parsed = JSON.parse(raw || "{}");
      if (parsed && typeof parsed === "object") {
        setPrefs((p) => ({ ...p, ...parsed }));
        void offlineDB.setSetting(PREFS_KEY, { ...DEFAULT_PREFS, ...parsed });
      }
    } catch { /* ignore malformed */ }
  }, [shop.data?.settingsJson]);

  useEffect(() => () => { if (pushTimer.current) clearTimeout(pushTimer.current); }, []);

  function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    void offlineDB.setSetting(PREFS_KEY, next); // instant + offline
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => saveSettings.mutate({ data: { settingsJson: JSON.stringify(next) } }), 700); // debounced server sync
  }

  const planName = snapshot?.planCode ? snapshot.planCode.charAt(0).toUpperCase() + snapshot.planCode.slice(1) : "Free";
  const shopName = shop.data?.name ?? "My Store";
  const shopAddress = [shop.data?.address, shop.data?.city].filter(Boolean).join(", ") || "Add your store address";
  const shopEmail = (shop.data as { email?: string } | undefined)?.email ?? user?.email ?? "—";

  return (
    <div
      className={cn("min-h-full bg-[#f8faff] px-4 py-4", isResizing ? "" : "transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]")}
      style={editOpen && isDesktop ? { paddingRight: panelWidth + 16 } : undefined}
    >
      <div className="flex gap-4">
        {/* Submenu */}
        <aside className="hidden w-[200px] shrink-0 lg:block">
          <nav className="space-y-0.5">
            {MENU.map((m) => {
              const routed = "href" in m && Boolean(m.href);
              const isActive = !routed && m.id === activeSection;
              const onClick = () => {
                if (routed) { navigate((m as { href: string }).href); return; }
                setActiveSection(m.id);
                const targetId = m.id === "general" ? "section-store" : `section-${m.id}`;
                document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
              };
              return (
                <button
                  key={m.id}
                  onClick={onClick}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-left text-[13px] font-semibold transition-colors",
                    isActive ? "bg-[#eef5ff] text-[#005dff]" : "text-[#344668] hover:bg-[#eef2f8]",
                  )}
                >
                  <m.icon size={16} className={isActive ? "text-[#005dff]" : "text-[#536583]"} />
                  <span className="flex-1 truncate">{m.label}</span>
                  {routed && <ChevronRight size={14} className="text-[#9aa6bb]" />}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content grid */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Row 1: Store Profile + Billing */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card id="section-store">
              <CardHead icon={<Store size={15} />} title="Store Profile" action={<button onClick={() => setEditOpen(true)} className="flex items-center gap-1 text-[12px] font-bold text-[#005dff] hover:underline"><Pencil size={12} /> Edit</button>} />
              <div className="flex items-center gap-3.5 border-b border-[#eef2f8] px-5 pb-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[12px] bg-[#eef5ff] text-2xl">🏪</span>
                <div className="min-w-0">
                  <p className="truncate font-display text-[16px] font-black text-[#102347]">{shopName}</p>
                  <p className="truncate text-[12px] text-[#52627e]">{shopAddress}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-y-4 px-5 py-4">
                <Info label="Phone" value={shop.data?.phone ?? "—"} />
                <Info label="Email" value={shopEmail} />
                <Info label="GSTIN" value={shop.data?.gstNumber || "Not set"} />
                <Info label="Currency" value="₹ Indian Rupee" />
              </div>
            </Card>

            <Card>
              <CardHead icon={<CreditCard size={15} />} title="Billing & Subscription" action={<Link href="/subscription" className="text-[12px] font-bold text-[#005dff] hover:underline">Manage Plan</Link>} />
              <div className="px-5 pb-4">
                <div className="mb-4 flex items-center gap-2">
                  <span className="rounded-[8px] bg-[#fff4dd] px-2.5 py-1 text-[12px] font-extrabold text-[#b7791f]">{planName} Plan</span>
                  <span className="rounded-[8px] bg-[#f5f7fc] px-2.5 py-1 text-[12px] font-semibold text-[#64748b] capitalize">{snapshot?.status ?? "active"}</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <ul className="space-y-2">
                    {["Unlimited Invoices", "Multi-User Access", "Advanced Reports", "Priority Support"].map((f) => (
                      <li key={f} className="flex items-center gap-2 text-[12px] font-medium text-[#344668]">
                        <Check size={13} className="shrink-0 text-emerald-500" /> {f}
                      </li>
                    ))}
                  </ul>
                  <div>
                    <p className="text-[11px] text-[#64748b]">Usage this month</p>
                    <p className="font-display text-[18px] font-black text-[#102347]">{snapshot?.status === "active" ? "Active" : "—"}</p>
                    <p className="mt-1 text-[11px] text-[#64748b]">Manage billing & invoices in your plan.</p>
                    <Link href="/subscription" className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-[#005dff] hover:underline">View plan <ChevronRight size={13} /></Link>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Row 2: Staff + Devices */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHead icon={<UsersRound size={15} />} title="Staff & Permissions" action={<Link href="/staff" className="text-[12px] font-bold text-[#005dff] hover:underline">Manage Staff</Link>} />
              <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-4">
                <Stat label="Total Staff" value="—" sub="Active users" />
                <Stat label="Cashiers" value="—" sub="Can create bills" />
                <Stat label="Managers" value="—" sub="Full access" />
                <Stat label="View Only" value="—" sub="Read access" />
              </div>
              <p className="px-5 pb-4 text-[11px] text-[#9aa6bb]">Manage users, roles & permissions on the Staff page.</p>
            </Card>

            <Card>
              <CardHead icon={<MonitorSmartphone size={15} />} title="Device Management" sub="Manage your billing devices" action={<Link href="/devices" className="text-[12px] font-bold text-[#005dff] hover:underline">View All</Link>} />
              <div className="px-5 pb-3">
                {[
                  { name: "This Device", meta: "Web · Active session", active: true },
                ].map((d) => (
                  <div key={d.name} className="flex items-center gap-3 border-t border-[#eef2f8] py-2.5 first:border-t-0">
                    <MonitorSmartphone size={16} className="text-[#536583]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-[#102347]">{d.name}</p>
                      <p className="text-[11px] text-[#64748b]">{d.meta}</p>
                    </div>
                    <span className="rounded-[7px] bg-emerald-100 px-2 py-[3px] text-[11px] font-bold text-emerald-700">Active</span>
                  </div>
                ))}
                <Link href="/devices" className="mt-1 flex items-center justify-center gap-1 py-2 text-[12px] font-bold text-[#005dff] hover:underline">+ Manage Devices</Link>
              </div>
            </Card>
          </div>

          {/* Row 3: Printer + Taxes + Sync */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card id="section-printer">
              <CardHead icon={<Printer size={15} />} title="Printer & Billing" small action={<button className="text-[12px] font-bold text-[#005dff] hover:underline">Configure</button>} />
              <div className="px-5 pb-4">
                <RowToggle label="Default Bill Printer" desc="Thermal Printer (Receipts)" pill={<span className="rounded-[7px] bg-emerald-100 px-2 py-[3px] text-[11px] font-bold text-emerald-700">Connected</span>} />
                <RowToggle label="Bill Template" desc="Modern Template" pill={<button className="text-[12px] font-bold text-[#005dff]">Change</button>} />
                <RowToggle label="Print Settings" desc="80mm · Auto Cut" pill={<button className="text-[12px] font-bold text-[#005dff]">Configure</button>} />
                <RowToggle label="Print Preview" desc="Show before printing" pill={<Switch checked={prefs.printPreview} onCheckedChange={(v) => setPref("printPreview", v)} />} last />
              </div>
            </Card>

            <Card id="section-taxes">
              <CardHead icon={<Receipt size={15} />} title="Taxes & GST" small action={<button className="text-[12px] font-bold text-[#005dff] hover:underline">Configure</button>} />
              <div className="px-5 pb-4">
                <RowToggle label="GST Mode" pill={<Select value={prefs.gstMode} onValueChange={(v) => setPref("gstMode", v)}><SelectTrigger className="h-8 w-[150px] text-[12px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Exclusive (Add to price)">Exclusive (Add to price)</SelectItem><SelectItem value="Inclusive (In price)">Inclusive (In price)</SelectItem></SelectContent></Select>} />
                <RowToggle label="Default GST Rate" pill={<Select value={prefs.gstRate} onValueChange={(v) => setPref("gstRate", v)}><SelectTrigger className="h-8 w-[90px] text-[12px]"><SelectValue /></SelectTrigger><SelectContent>{["0%", "5%", "12%", "18%", "28%"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>} />
                <RowToggle label="Additional Rates" desc="5%, 12%, 28%" pill={<button className="text-[12px] font-bold text-[#005dff]">Manage</button>} />
                <RowToggle label="E-Invoice" pill={<Switch checked={prefs.eInvoice} onCheckedChange={(v) => setPref("eInvoice", v)} />} />
                <RowToggle label="HSN Code Tracking" pill={<Switch checked={prefs.hsnTracking} onCheckedChange={(v) => setPref("hsnTracking", v)} />} last />
              </div>
            </Card>

            <Card>
              <CardHead icon={<Cloud size={15} />} title="Sync & Backup" small action={<Link href="/sync-status" className="text-[12px] font-bold text-[#005dff] hover:underline">View Logs</Link>} />
              <div className="px-5 pb-4">
                <RowToggle label="Sync Status" pill={<span className="flex items-center gap-1.5 text-[12px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{isOnline ? (isSyncing ? "Syncing…" : "All synced") : "Offline"}</span>} />
                <RowToggle label="Auto Sync" desc="Every 15 minutes" pill={<Switch checked={prefs.autoSync} onCheckedChange={(v) => setPref("autoSync", v)} />} />
                <RowToggle label="Daily Backup" desc="At 02:00 AM" pill={<Switch checked={prefs.dailyBackup} onCheckedChange={(v) => setPref("dailyBackup", v)} />} />
                <RowToggle label="Backup Location" desc="Secure Cloud Storage" pill={<Cloud size={15} className="text-[#536583]" />} last />
              </div>
            </Card>
          </div>

          {/* Row 4: Security + Notifications + Integrations */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card id="section-security">
              <CardHead icon={<Shield size={15} />} title="Security & Owner PIN" small action={<button onClick={() => setPwOpen(true)} className="text-[12px] font-bold text-[#005dff] hover:underline">Update PIN</button>} />
              <div className="px-5 pb-4">
                <RowToggle label="Owner PIN" pill={<span className="font-mono text-[14px] tracking-widest text-[#102347]">•••••</span>} />
                <RowToggle label="Session Timeout" pill={<Select value={prefs.sessionTimeout} onValueChange={(v) => setPref("sessionTimeout", v)}><SelectTrigger className="h-8 w-[120px] text-[12px]"><SelectValue /></SelectTrigger><SelectContent>{["5 minutes", "15 minutes", "30 minutes", "1 hour"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>} />
                <RowToggle label="Biometric Login" desc="For staff devices" pill={<Switch checked={prefs.biometric} onCheckedChange={(v) => setPref("biometric", v)} />} />
                <RowToggle label="Two-Factor Auth" desc="Extra layer of security" pill={<Switch checked={prefs.twoFactor} onCheckedChange={(v) => setPref("twoFactor", v)} />} last />
              </div>
            </Card>

            <Card id="section-notifications">
              <CardHead icon={<Bell size={15} />} title="Notifications" small action={<button className="text-[12px] font-bold text-[#005dff] hover:underline">Configure</button>} />
              <div className="px-5 pb-4">
                <RowToggle label="Low Stock Alerts" desc="Get notified for low stock" pill={<Switch checked={prefs.lowStock} onCheckedChange={(v) => setPref("lowStock", v)} />} />
                <RowToggle label="Payment Reminders" desc="Pending payments" pill={<Switch checked={prefs.paymentReminders} onCheckedChange={(v) => setPref("paymentReminders", v)} />} />
                <RowToggle label="Daily Summary" desc="End of day summary" pill={<Switch checked={prefs.dailySummary} onCheckedChange={(v) => setPref("dailySummary", v)} />} />
                <RowToggle label="Promotions & Updates" desc="Product updates" pill={<Switch checked={prefs.promotions} onCheckedChange={(v) => setPref("promotions", v)} />} last />
              </div>
            </Card>

            <Card id="section-integrations">
              <CardHead icon={<Plug size={15} />} title="Integrations" small action={<button className="text-[12px] font-bold text-[#005dff] hover:underline">Manage</button>} />
              <div className="px-5 pb-4">
                {[
                  { name: "WhatsApp Business", status: "Connected", tone: "emerald" as const },
                  { name: "TallyPrime", status: "Connected", tone: "emerald" as const },
                  { name: "BharatPe", status: "Not Connected", tone: "amber" as const },
                  { name: "Payment Gateway", status: "Connected", tone: "emerald" as const },
                ].map((i, idx) => (
                  <div key={i.name} className={cn("flex items-center gap-2.5 py-2.5", idx > 0 && "border-t border-[#eef2f8]")}>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#f4f7fb]"><Plug size={13} className="text-[#536583]" /></span>
                    <span className="flex-1 truncate text-[13px] font-bold text-[#102347]">{i.name}</span>
                    <span className={cn("rounded-[7px] px-2 py-[3px] text-[11px] font-bold", i.tone === "emerald" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{i.status}</span>
                    <ChevronRight size={14} className="text-[#9aa6bb]" />
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Advanced */}
          <Card id="section-advanced">
            <CardHead icon={<Sliders size={15} />} title="Advanced" sub="Tools, data and account management" />
            <div className="grid grid-cols-1 gap-2 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { href: "/suppliers", label: "Suppliers", desc: "Purchase parties", icon: Truck },
                { href: "/staff", label: "Staff & Roles", desc: "Users and permissions", icon: UsersRound },
                { href: "/devices", label: "Devices", desc: "Licensed devices", icon: MonitorSmartphone },
                { href: "/sync-status", label: "Cloud Backup", desc: "Backup health & logs", icon: Cloud },
                { href: "/smart-tools", label: "Smart Tools", desc: "Voice & automation", icon: Sparkles },
                { href: "/recovery-mode", label: "Recovery Mode", desc: "Recover local drafts", icon: LifeBuoy },
                { href: "/audit-logs", label: "Audit Logs", desc: "Owner approvals", icon: Receipt },
                { href: "/recycle-bin", label: "Recycle Bin", desc: "Restore deleted records", icon: Recycle },
                { href: "/plans", label: "Plans", desc: "Compare & upgrade", icon: CreditCard },
              ].map((l) => (
                <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-[10px] border border-[#e7edf7] bg-white px-3 py-2.5 transition-colors hover:border-[#cfe0ff] hover:bg-[#f7faff]">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[#eef5ff] text-[#005dff]"><l.icon size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-[#102347]">{l.label}</span>
                    <span className="block truncate text-[11px] text-[#64748b]">{l.desc}</span>
                  </span>
                  <ChevronRight size={15} className="shrink-0 text-[#9aa6bb]" />
                </Link>
              ))}
            </div>
          </Card>

          {/* Footer */}
          <div className="flex flex-col items-center justify-between gap-2 rounded-[12px] border border-[#e7edf7] bg-white px-5 py-3.5 sm:flex-row">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#eef5ff] text-[#005dff]"><Settings2 size={16} /></span>
              <div>
                <p className="text-[13px] font-extrabold text-[#102347]">About KiranaOS</p>
                <p className="text-[11px] text-[#64748b]">Version 2.1.3 · You're up to date</p>
              </div>
            </div>
            <div className="flex items-center gap-5 text-[12px] font-bold text-[#005dff]">
              <Link href="/sync-status" className="hover:underline">What's New</Link>
              <button className="hover:underline">Help Center</button>
              <button className="hover:underline">Contact Support</button>
            </div>
          </div>
        </div>
      </div>

      <StoreEditPanel
        open={editOpen}
        shop={shop.data}
        accent={accent}
        setAccent={setAccent}
        language={language}
        setLanguage={setLanguage}
        width={panelWidth}
        onResizeStart={onResizeStart}
        onClose={() => setEditOpen(false)}
        onSaved={() => { queryClient.invalidateQueries({ queryKey: getGetShopQueryKey() }); setEditOpen(false); }}
      />

      <PasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </div>
  );
}

/* ── building blocks ── */
function Card({ id, children }: { id?: string; children: React.ReactNode }) {
  return <div id={id} className="scroll-mt-4 overflow-hidden rounded-[14px] border border-[#e7edf7] bg-white shadow-[0_8px_24px_rgba(15,35,80,0.04)]">{children}</div>;
}
function CardHead({ icon, title, sub, action, small }: { icon: React.ReactNode; title: string; sub?: string; action?: React.ReactNode; small?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between px-5 pt-4", small ? "pb-3" : "pb-3")}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[#eef5ff] text-[#005dff]">{icon}</span>
        <div>
          <h3 className="font-display text-[14px] font-black tracking-tight text-[#102347]">{title}</h3>
          {sub && <p className="text-[11px] text-[#64748b]">{sub}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-[#64748b]">{label}</p>
      <p className="truncate text-[13px] font-bold text-[#102347]">{value}</p>
    </div>
  );
}
function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[8px] border border-[#e7edf7] p-3">
      <p className="text-[11px] font-semibold text-[#64748b]">{label}</p>
      <p className="font-display text-[20px] font-black text-[#102347]">{value}</p>
      <p className="text-[10px] text-[#9aa6bb]">{sub}</p>
    </div>
  );
}
function RowToggle({ label, desc, pill, last }: { label: string; desc?: string; pill: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 py-2.5", !last && "border-b border-[#eef2f8]")}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-[#102347]">{label}</p>
        {desc && <p className="truncate text-[11px] text-[#64748b]">{desc}</p>}
      </div>
      <div className="shrink-0">{pill}</div>
    </div>
  );
}

/* ── Store profile edit slide-in ── */
function StoreEditPanel({
  open, shop, accent, setAccent, language, setLanguage, width, onResizeStart, onClose, onSaved,
}: {
  open: boolean;
  shop: { name?: string | null; ownerName?: string | null; city?: string | null; address?: string | null; gstNumber?: string | null; phone?: string | null } | undefined;
  accent: AccentColor;
  setAccent: (c: AccentColor) => void;
  language: AppLanguage;
  setLanguage: (l: AppLanguage) => void;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const form = useForm<ShopFormData>({
    resolver: zodResolver(shopSchema),
    values: {
      name: shop?.name ?? "", ownerName: shop?.ownerName ?? "", city: shop?.city ?? "",
      address: shop?.address ?? "", gstNumber: shop?.gstNumber ?? "", phone: shop?.phone ?? "",
    },
  });
  const updateShop = useUpdateShop({
    mutation: {
      onSuccess: () => { toast({ title: "Store profile saved" }); onSaved(); },
      onError: (err: unknown) => toast({ title: "Could not save", description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" }),
    },
  });

  return (
    <aside
      style={{ width }}
      className={`fixed right-0 top-0 z-40 flex h-full w-full max-w-[100vw] flex-col border-l border-[#e6ecf4] bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.10)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:top-[76px] lg:h-[calc(100vh-76px)] ${open ? "translate-x-0" : "translate-x-full"}`}
      role="dialog" aria-label="Edit store profile" aria-hidden={!open}
    >
      <PanelResizeHandle onResizeStart={onResizeStart} />
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef1f6] px-5 py-4">
        <div>
          <h2 className="font-display text-[17px] font-black tracking-tight text-[#0f1e3d]">Edit Store Profile</h2>
          <p className="mt-0.5 text-[12px] text-[#6d7c98]">Store details, appearance and language.</p>
        </div>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[#536383] hover:bg-[#f1f4f8]" aria-label="Close"><X size={18} /></button>
      </div>

      <form onSubmit={form.handleSubmit((v) => updateShop.mutate({ data: v }))} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="space-y-3">
            <h3 className="text-[13px] font-black text-[#13274d]">Store Details</h3>
            <Fld label="Store Name" err={form.formState.errors.name?.message}><Input className="h-10" {...form.register("name")} /></Fld>
            <Fld label="Owner Name" err={form.formState.errors.ownerName?.message}><Input className="h-10" {...form.register("ownerName")} /></Fld>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="City" err={form.formState.errors.city?.message}><Input className="h-10" {...form.register("city")} /></Fld>
              <Fld label="Phone"><Input className="h-10" {...form.register("phone")} /></Fld>
            </div>
            <Fld label="Address" err={form.formState.errors.address?.message}><Input className="h-10" {...form.register("address")} /></Fld>
            <Fld label="GSTIN (optional)"><Input className="h-10" {...form.register("gstNumber")} /></Fld>
          </section>

          <section className="space-y-3">
            <h3 className="text-[13px] font-black text-[#13274d]">Appearance</h3>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(ACCENT_COLORS) as [AccentColor, { label: string; swatch: string }][]).map(([key, def]) => (
                <button key={key} type="button" onClick={() => setAccent(key)} title={def.label}
                  className={cn("h-8 w-8 rounded-full border-2 transition-transform", accent === key ? "scale-110 border-[#0f1e3d]" : "border-transparent hover:scale-105")}
                  style={{ background: def.swatch }} aria-label={def.label} />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-[13px] font-black text-[#13274d]">Language</h3>
            <Select value={language} onValueChange={(v) => setLanguage(v as AppLanguage)}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="hi">हिन्दी (Hindi)</SelectItem>
              </SelectContent>
            </Select>
          </section>
        </div>

        <div className="shrink-0 border-t border-[#eef1f6] px-5 py-3.5">
          <div className="flex gap-2.5">
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={updateShop.isPending} style={{ background: "linear-gradient(180deg,#005dff 0%,#0047e8 100%)" }} className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95">
              {updateShop.isPending ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : "Save Changes"}
            </Button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function Fld({ label, err, children }: { label: string; err?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{label}</Label>
      {children}
      {err && <p className="mt-1 text-[11px] text-rose-600">{err}</p>}
    </div>
  );
}

/* ── Password / PIN dialog ── */
const pwSchema = z.object({
  currentPassword: z.string().min(1, "Required"),
  newPassword: z.string().min(6, "Min 6 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, { message: "Passwords don't match", path: ["confirmPassword"] });
type PwData = z.infer<typeof pwSchema>;

function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const [show, setShow] = useState(false);
  const form = useForm<PwData>({ resolver: zodResolver(pwSchema), defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" } });
  const changePassword = useChangePassword({
    mutation: {
      onSuccess: () => { form.reset(); toast({ title: "Password updated" }); onOpenChange(false); },
      onError: (err: unknown) => toast({ title: "Error", description: (err as { data?: { message?: string } })?.data?.message ?? "Incorrect password", variant: "destructive" }),
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-black tracking-tight text-[#0f1e3d]">Update Owner Password</DialogTitle>
          <p className="text-[12px] text-[#6d7c98]">Change the owner login password / PIN.</p>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => changePassword.mutate({ data: { currentPassword: v.currentPassword, newPassword: v.newPassword } }))} className="space-y-3.5">
          <Fld label="Current password" err={form.formState.errors.currentPassword?.message}>
            <div className="relative">
              <Input className="h-10 pr-9" type={show ? "text" : "password"} {...form.register("currentPassword")} />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7a9a]">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
          </Fld>
          <Fld label="New password" err={form.formState.errors.newPassword?.message}><Input className="h-10" type="password" {...form.register("newPassword")} /></Fld>
          <Fld label="Confirm new password" err={form.formState.errors.confirmPassword?.message}><Input className="h-10" type="password" {...form.register("confirmPassword")} /></Fld>
          <div className="flex gap-2.5 pt-1">
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-[10px] font-bold" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={changePassword.isPending} style={{ background: "linear-gradient(180deg,#005dff 0%,#0047e8 100%)" }} className="h-11 flex-1 gap-2 rounded-[10px] font-black text-white hover:opacity-95">
              {changePassword.isPending ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : "Update"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
