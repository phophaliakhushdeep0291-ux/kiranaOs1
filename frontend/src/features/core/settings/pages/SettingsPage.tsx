import { useAppLanguage } from "@/features/core/settings/i18n";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useGetShop } from "@/lib/api/client";
import { useAuth } from "@/features/core/auth/useAuth";
import { useSubscriptionSnapshot } from "@/features/core/subscription";
import { useOfflineStatus } from "@/features/core/sync";
import { offlineDB } from "@/lib/offline/db";
import {
  Bell, Check, ChevronRight, Cloud, CreditCard, MonitorSmartphone, Plug, Printer, Receipt,
  Recycle, Settings2, Shield, Sliders, Sparkles, Store, Truck, UsersRound, LifeBuoy,
} from "lucide-react";
import { SettingsShell } from "@/features/core/settings/SettingsShell";
import { Card, CardHead, Info, Badge } from "@/features/core/settings/ui";
import { DEFAULT_PRINTER_CONFIG, PRINTER_CONNECTION_LABELS, type PrinterConfig } from "@/features/core/settings/printer-config";
import { appVersion, buildId, SUPPORT_EMAIL } from "@/features/core/settings/app-info";
import { checkOwnerPin } from "@/features/core/settings/api";
import { listStaff } from "@/features/core/staff/api";
import { listDevices } from "@/features/core/devices/api";
import { getOfflineScope } from "@/lib/offline/context";
import { apiRequest } from "@/lib/api/http";

const PREFS_KEY = "kirana:settings-prefs:v1";

interface IntegrationOverview {
  maturityScore: number;
  activeKeys: number;
  activeWebhooks: number;
  providers: { id: string; name: string; status: string }[];
}

export default function SettingsPage() {
  const { t } = useAppLanguage();
  const { user } = useAuth();
  const { snapshot } = useSubscriptionSnapshot();
  const { isOnline, isSyncing } = useOfflineStatus();
  const shop = useGetShop();
  const [printer, setPrinter] = useState<PrinterConfig>(DEFAULT_PRINTER_CONFIG);
  const [gst, setGst] = useState({ mode: "Exclusive (Add to price)", rate: "18%" });
  const [notifCount, setNotifCount] = useState<number | null>(null);
  const [storeProfile, setStoreProfile] = useState<Record<string, unknown>>({});
  const currentDeviceId = getOfflineScope().device_id;

  const staffQ = useQuery({ queryKey: ["staff", "overview"], queryFn: listStaff, retry: 0 });
  const devicesQ = useQuery({ queryKey: ["devices", "overview"], queryFn: listDevices, retry: 1 });
  const integrationsQ = useQuery({ queryKey: ["integrations", "overview"], queryFn: () => apiRequest<IntegrationOverview>("/integrations/overview"), retry: 1 });
  const pinQ = useQuery({ queryKey: ["owner-pin-status"], queryFn: checkOwnerPin, retry: 1 });

  // The staff list is owner-only and plan-gated; a 403 means "can't tell", not zero.
  const staffCounts = useMemo(() => {
    const rows = staffQ.data;
    if (!rows) return { total: "—", owner: "—", admin: "—", staff: "—" };
    const by = (role: string) => String(rows.filter((r) => (r.role ?? "staff") === role).length);
    return { total: String(rows.length), owner: by("owner"), admin: by("admin"), staff: by("staff") };
  }, [staffQ.data]);

  useEffect(() => {
    void offlineDB.getSetting<Record<string, unknown>>(PREFS_KEY).then((p) => {
      if (!p) return;
      if (p.printer) setPrinter({ ...DEFAULT_PRINTER_CONFIG, ...(p.printer as Partial<PrinterConfig>) });
      if (p.storeProfile && typeof p.storeProfile === "object") setStoreProfile(p.storeProfile as Record<string, unknown>);
      if (typeof p.gstMode === "string" || typeof p.gstRate === "string") {
        setGst({ mode: (p.gstMode as string) ?? "Exclusive (Add to price)", rate: (p.gstRate as string) ?? "18%" });
      }
      const channels = ["lowStock", "paymentReminders", "dailySummary", "promotions"] as const;
      const on = channels.filter((k) => p[k] !== false).length;
      setNotifCount(on);
    });
  }, []);

  useEffect(() => {
    const raw = shop.data?.settingsJson;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.storeProfile && typeof parsed.storeProfile === "object") setStoreProfile(parsed.storeProfile as Record<string, unknown>);
    } catch {
      // Keep the local summary if the server blob is malformed.
    }
  }, [shop.data?.settingsJson]);

  const planName = snapshot?.planCode ? snapshot.planCode.charAt(0).toUpperCase() + snapshot.planCode.slice(1) : "Free";
  const shopName = shop.data?.name || stringValue(storeProfile.name) || "My Store";
  const shopAddress = [
    shop.data?.address,
    shop.data?.city,
    stringValue(storeProfile.state),
    stringValue(storeProfile.pincode),
  ].filter(Boolean).join(", ") || "Add your store address";
  const shopEmail = stringValue(storeProfile.email) || (shop.data as { email?: string } | undefined)?.email || user?.email || "-";
  const shopPhone = shop.data?.phone || stringValue(storeProfile.phone) || stringValue(storeProfile.altPhone) || "-";
  const shopCurrency = stringValue(storeProfile.currency) || "Indian Rupee (INR)";

  return (
    <SettingsShell>
      <section className="space-y-4 lg:hidden" aria-label={t("settings.hub.shortcuts")}>
        <div className="rounded-[20px] bg-[linear-gradient(135deg,var(--brand)_0%,var(--brand-strong)_100%)] p-5 text-white shadow-[0_18px_40px_rgba(7,95,255,0.24)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-100">{t("settings.hub.eyebrow")}</p>
              <h1 className="mt-1 font-display text-[24px] font-black tracking-tight">{t("settings.hub.title")}</h1>
              <p className="mt-1 max-w-[260px] text-[12px] leading-5 text-blue-100">{t("settings.hub.subtitle")}</p>
            </div>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/20"><Settings2 size={22} /></span>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-white/10 px-3 py-2.5 text-[11px] font-bold ring-1 ring-white/15">
            <span>{shopName}</span>
            <span className="inline-flex items-center gap-1.5 text-emerald-100"><span className="h-2 w-2 rounded-full bg-emerald-300" />{isOnline ? (isSyncing ? t("dashboard.health.syncing") : t("settings.hub.protected")) : t("settings.hub.offlineSafe")}</span>
          </div>
        </div>

        <div className="overflow-hidden rounded-[18px] border border-[#e2eaf6] bg-white shadow-[0_12px_30px_rgba(15,35,80,0.06)]">
          {[
            { href: "/settings/store-profile", label: t("settings.hub.tile.storeProfile"), desc: t("settings.hub.tile.storeProfileDesc"), icon: Store, tone: "bg-blue-50 text-blue-600" },
            { href: "/settings/billing", label: t("settings.hub.tile.billing"), desc: t("settings.hub.tile.billingDesc"), icon: CreditCard, tone: "bg-violet-50 text-violet-600" },
            { href: "/settings/taxes", label: t("settings.hub.taxesGst"), desc: t("settings.hub.tile.taxesDesc"), icon: Receipt, tone: "bg-lime-50 text-lime-700" },
            { href: "/settings/printer", label: t("settings.hub.tile.printer"), desc: t("settings.hub.tile.printerDesc"), icon: Printer, tone: "bg-amber-50 text-amber-600" },
            { href: "/settings/staff", label: t("settings.hub.tile.staff"), desc: t("settings.hub.tile.staffDesc"), icon: UsersRound, tone: "bg-cyan-50 text-cyan-600" },
            { href: "/settings/security", label: t("settings.hub.tile.security"), desc: t("settings.hub.tile.securityDesc"), icon: Shield, tone: "bg-rose-50 text-rose-600" },
            { href: "/settings/sync", label: t("settings.hub.tile.sync"), desc: isOnline ? t("settings.hub.tile.syncOnline") : t("settings.hub.tile.syncOffline"), icon: Cloud, tone: "bg-emerald-50 text-emerald-600" },
            { href: "/settings/notifications", label: t("settings.hub.notifications"), desc: t("settings.hub.tile.notificationsDesc"), icon: Bell, tone: "bg-fuchsia-50 text-fuchsia-600" },
            { href: "/settings/integrations", label: t("settings.hub.integrations"), desc: t("settings.hub.tile.integrationsDesc"), icon: Plug, tone: "bg-indigo-50 text-indigo-600" },
          ].map((item, index, rows) => (
            <Link key={item.href} href={item.href} className={`flex min-h-[68px] items-center gap-3 px-4 py-3 transition-colors active:bg-[#f4f7fc] ${index < rows.length - 1 ? "border-b border-[#edf1f7]" : ""}`}>
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[13px] ${item.tone}`}><item.icon size={19} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-black text-[var(--brand-ink)]">{item.label}</span>
                <span className="mt-0.5 block truncate text-[11px] text-[#6d7c98]">{item.desc}</span>
              </span>
              <ChevronRight size={17} className="shrink-0 text-[#9aa8bd]" />
            </Link>
          ))}
        </div>

        <Link href="/settings/advanced" className="flex min-h-14 items-center gap-3 rounded-[16px] border border-[#e2eaf6] bg-white px-4 shadow-[0_8px_22px_rgba(15,35,80,0.045)]">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><Sliders size={18} /></span>
          <span className="flex-1 text-[13px] font-black text-[var(--brand-ink)]">{t("settings.hub.advancedTools")}</span>
          <ChevronRight size={17} className="text-[#9aa8bd]" />
        </Link>
      </section>

      <div className="hidden lg:contents">
      {/* Row 1: Store Profile + Billing */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead icon={<Store size={15} />} title={t("settings.hub.storeProfile")} action={<Manage href="/settings/store-profile" />} />
          <div className="flex items-center gap-3.5 border-b border-[#eef2f8] px-5 pb-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[12px] bg-[var(--brand-soft)] text-2xl">🏪</span>
            <div className="min-w-0">
              <p className="truncate font-display text-[16px] font-black text-[var(--brand-ink)]">{shopName}</p>
              <p className="truncate text-[12px] text-[#52627e]">{shopAddress}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-y-4 px-5 py-4 sm:grid-cols-2">
            <Info label={t("settings.hub.phone")} value={shopPhone} />
            <Info label={t("settings.hub.email")} value={shopEmail} />
            <Info label={t("inventory.transfers.gstin")} value={shop.data?.gstNumber || t("settings.security.notSet")} />
            <Info label={t("manufacturing.orders.currency")} value={shopCurrency} />
          </div>
        </Card>

        <Card>
          <CardHead icon={<CreditCard size={15} />} title={t("settings.hub.billingSubscription")} action={<Manage href="/settings/billing" label={t("settings.hub.managePlanAction")} />} />
          <div className="px-5 pb-4">
            <div className="mb-4 flex items-center gap-2">
              <Badge tone="amber">{planName} Plan</Badge>
              <Badge tone="gray"><span className="capitalize">{snapshot?.status ?? "active"}</span></Badge>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ul className="space-y-2">
                {["Unlimited Invoices", "Multi-User Access", "Advanced Reports", "Priority Support"].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-[12px] font-medium text-[#344668]">
                    <Check size={13} className="shrink-0 text-emerald-500" /> {f}
                  </li>
                ))}
              </ul>
              <div>
                <p className="text-[11px] text-[#64748b]">{t("settings.hub.usageThisMonth")}</p>
                <p className="font-display text-[18px] font-black text-[var(--brand-ink)]">{snapshot?.status === "active" ? "Active" : "—"}</p>
                <p className="mt-1 text-[11px] text-[#64748b]">{t("settings.hub.managePlanAction")}</p>
                <Link href="/settings/billing" className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-[var(--brand)] hover:underline">{t("settings.hub.viewPlan")} <ChevronRight size={13} /></Link>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Row 2: Staff + Devices */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead icon={<UsersRound size={15} />} title={t("settings.hub.staffPermissions")} action={<Manage href="/settings/staff" label={t("settings.hub.manageStaff")} />} />
          <div className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-4">
            <OverviewStat label={t("settings.hub.totalStaff")} value={staffCounts.total} sub={t("settings.hub.activeUsers")} />
            <OverviewStat label={t("settings.hub.cashiers")} value={staffCounts.staff} sub={t("settings.hub.canCreateBills")} />
            <OverviewStat label={t("settings.hub.owners")} value={staffCounts.owner} sub={t("settings.hub.fullAccess")} />
            <OverviewStat label={t("settings.hub.admins")} value={staffCounts.admin} sub={t("settings.hub.manageApprove")} />
          </div>
          <p className="px-5 pb-4 text-[11px] text-[#9aa6bb]">
            {staffQ.isError ? "Staff list needs the Growth plan or an owner account — open the Staff page for details." : "Manage users, roles & permissions on the Staff page."}
          </p>
        </Card>

        <Card>
          <CardHead icon={<MonitorSmartphone size={15} />} title={t("settings.hub.deviceManagement")} sub={devicesQ.data ? `${devicesQ.data.devicesUsed} of ${devicesQ.data.plan.deviceLimit} device slots used` : t("settings.hub.devicesSub")} action={<Manage href="/settings/devices" label={t("settings.hub.viewAll")} />} />
          <div className="px-5 pb-3">
            {devicesQ.isLoading ? (
              <p className="py-4 text-center text-[12px] text-[#64748b]">{t("settings.hub.loadingDevices")}</p>
            ) : devicesQ.isError ? (
              <p className="py-4 text-center text-[12px] text-[#64748b]">{t("settings.hub.devicesUnavailable")}</p>
            ) : (devicesQ.data?.devices ?? []).slice(0, 3).map((device) => {
              const id = device.deviceId || device.device_id || device.id;
              const isCurrent = id === currentDeviceId;
              return (
                <div key={id} className="flex items-center gap-3 py-2.5">
                  <MonitorSmartphone size={16} className="text-[#536583]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-[var(--brand-ink)]">{device.deviceName || device.device_name || "Unnamed device"}{isCurrent ? " · This device" : ""}</p>
                    <p className="text-[11px] text-[#64748b]">{device.platform || device.operatingSystem || "web"} · {device.status === "active" ? "Active" : device.status || "Idle"}</p>
                  </div>
                  <Badge tone={device.status === "blocked" ? "red" : device.status === "active" ? "green" : "gray"}>{device.status === "blocked" ? "Blocked" : device.status === "active" ? "Active" : "Idle"}</Badge>
                </div>
              );
            })}
            <Link href="/settings/devices" className="mt-1 flex items-center justify-center gap-1 py-2 text-[12px] font-bold text-[var(--brand)] hover:underline">{t("settings.hub.manageDevices")}</Link>
          </div>
        </Card>
      </div>

      {/* Row 3: Printer + Taxes + Sync */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHead icon={<Printer size={15} />} title={t("settings.hub.printerBilling")} action={<Manage href="/settings/printer" label={t("settings.hub.configure")} />} />
          <div className="px-5 pb-4">
            <Info label={t("settings.hub.defaultPrinter")} value={printer.deviceName || t("settings.hub.browserPrinter")} />
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="blue">{PRINTER_CONNECTION_LABELS[printer.connection]}</Badge>
              <Badge tone="gray">{printer.paperSize}</Badge>
              <Badge tone={printer.autoPrint ? "green" : "gray"}>{printer.autoPrint ? "Auto-print on" : "Manual print"}</Badge>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead icon={<Receipt size={15} />} title={t("settings.hub.taxesGst")} action={<Manage href="/settings/taxes" label={t("settings.hub.configure")} />} />
          <div className="px-5 pb-4">
            <Info label={t("settings.hub.gstMode")} value={gst.mode} />
            <div className="mt-3"><Info label={t("settings.hub.defaultRate")} value={gst.rate} /></div>
          </div>
        </Card>

        <Card>
          <CardHead icon={<Cloud size={15} />} title={t("settings.hub.syncBackup")} action={<Manage href="/settings/sync" label={t("settings.hub.viewLogs")} />} />
          <div className="px-5 pb-4">
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{isOnline ? (isSyncing ? "Syncing…" : "All synced") : "Offline"}
            </div>
            <p className="mt-2 text-[11px] text-[#64748b]">{t("settings.hub.syncHelp")}</p>
          </div>
        </Card>
      </div>

      {/* Row 4: Security + Notifications + Integrations */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHead icon={<Shield size={15} />} title={t("settings.hub.securityPin")} action={<Manage href="/settings/security" label={t("settings.hub.manage")} />} />
          <div className="px-5 pb-4">
            <div className="flex items-center justify-between">
              <Info label={t("inventory.transfers.ownerPin")} value={pinQ.isLoading ? t("settings.lock.checking") : pinQ.data?.hasPin ? t("settings.hub.pinSet") : t("settings.security.notSet")} />
              <Badge tone={pinQ.data?.hasPin ? "green" : "amber"}>{pinQ.data?.hasPin ? "Protected" : "Set a PIN"}</Badge>
            </div>
            <p className="mt-2 text-[11px] text-[#64748b]">{t("settings.hub.pinHelp")}</p>
          </div>
        </Card>

        <Card>
          <CardHead icon={<Bell size={15} />} title={t("settings.hub.notifications")} action={<Manage href="/settings/notifications" label={t("settings.hub.configure")} />} />
          <div className="px-5 pb-4">
            <Info label={t("settings.hub.activeAlerts")} value={notifCount == null ? "—" : `${notifCount} of 4 enabled`} />
            <p className="mt-2 text-[11px] text-[#64748b]">{t("settings.hub.notificationsHelp")}</p>
          </div>
        </Card>

        <Card>
          <CardHead icon={<Plug size={15} />} title={t("settings.hub.integrations")} action={<Manage href="/settings/integrations" label={t("settings.hub.manage")} />} />
          <div className="px-5 pb-4">
            <div className="flex flex-wrap gap-1.5">
              {integrationsQ.isLoading ? <Badge tone="gray">{t("settings.lock.checking")}</Badge>
                : integrationsQ.isError ? <Badge tone="gray">{t("settings.hub.statusUnavailable")}</Badge>
                : (integrationsQ.data?.providers ?? []).slice(0, 4).map((provider) => (
                  <Badge key={provider.id} tone={provider.status === "ready" ? "green" : provider.status === "available" ? "blue" : "amber"}>{provider.name}</Badge>
                ))}
            </div>
            <p className="mt-2 text-[11px] text-[#64748b]">
              {integrationsQ.data ? `Readiness ${integrationsQ.data.maturityScore}/100 · ${integrationsQ.data.activeKeys} API key(s), ${integrationsQ.data.activeWebhooks} webhook(s).` : "Connect billing, payments & accounting tools."}
            </p>
          </div>
        </Card>
      </div>

      {/* Advanced */}
      <Card>
        <CardHead icon={<Sliders size={15} />} title={t("settings.advanced")} sub={t("settings.hub.toolsSub")} action={<Manage href="/settings/advanced" label={t("reports.settlement.filterOpen")} />} />
        <div className="grid grid-cols-1 gap-2 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: "/suppliers", label: t("settings.hub.tool.suppliers"), desc: t("settings.hub.tool.suppliersDesc"), icon: Truck },
            { href: "/settings/staff", label: t("settings.hub.tool.staffRoles"), desc: t("settings.hub.tool.staffRolesDesc"), icon: UsersRound },
            { href: "/settings/devices", label: t("settings.hub.tool.devices"), desc: t("settings.hub.tool.devicesDesc"), icon: MonitorSmartphone },
            { href: "/settings/sync", label: t("settings.hub.tool.cloudBackup"), desc: t("settings.hub.tool.cloudBackupDesc"), icon: Cloud },
            { href: "/smart-tools", label: t("settings.hub.tool.smartTools"), desc: t("settings.hub.tool.smartToolsDesc"), icon: Sparkles },
            { href: "/recovery-mode", label: t("settings.hub.tool.recoveryMode"), desc: t("settings.hub.tool.recoveryModeDesc"), icon: LifeBuoy },
            { href: "/audit-logs", label: t("settings.hub.tool.auditLogs"), desc: t("settings.hub.tool.auditLogsDesc"), icon: Receipt },
            { href: "/recycle-bin", label: t("settings.hub.tool.recycleBin"), desc: t("settings.hub.tool.recycleBinDesc"), icon: Recycle },
            { href: "/plans", label: t("settings.hub.tool.plans"), desc: t("settings.hub.tool.plansDesc"), icon: CreditCard },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-[10px] border border-[#e7edf7] bg-white px-3 py-2.5 transition-colors hover:border-[var(--brand-border)] hover:bg-[var(--brand-softer)]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[var(--brand-soft)] text-[var(--brand)]"><l.icon size={16} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-[var(--brand-ink)]">{l.label}</span>
                <span className="block truncate text-[11px] text-[#64748b]">{l.desc}</span>
              </span>
              <ChevronRight size={15} className="shrink-0 text-[#9aa6bb]" />
            </Link>
          ))}
        </div>
      </Card>

      {/* Footer */}
      <div className="flex flex-col items-stretch justify-between gap-3 rounded-[12px] border border-[#e7edf7] bg-white px-5 py-3.5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[var(--brand-soft)] text-[var(--brand)]"><Settings2 size={16} /></span>
          <div>
            <p className="text-[13px] font-extrabold text-[var(--brand-ink)]">{t("settings.hub.about")}</p>
            <p className="text-[11px] text-[#64748b]">Version {appVersion()} · build {buildId()}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] font-bold text-[var(--brand)]">
          <Link href="/settings/advanced" className="hover:underline">{t("settings.hub.diagnostics")}</Link>
          <Link href="/settings/setup" className="hover:underline">{t("settings.hub.setupChecklist")}</Link>
          <a href={`mailto:${SUPPORT_EMAIL}?subject=Artha%20support`} className="hover:underline">{t("settings.hub.contactSupport")}</a>
        </div>
      </div>
      </div>
    </SettingsShell>
  );
}

function Manage({ href, label }: { href: string; label?: string }) {
  // The fallback cannot be a default parameter: `t` comes from a hook, and a
  // default is evaluated in the parameter list, before any hook has run.
  const { t } = useAppLanguage();
  return <Link href={href} className="flex items-center gap-1 text-[12px] font-bold text-[var(--brand)] hover:underline">{label ?? t("settings.hub.manage")} <ChevronRight size={13} /></Link>;
}

function OverviewStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[8px] border border-[#e7edf7] p-3">
      <p className="text-[11px] font-semibold text-[#64748b]">{label}</p>
      <p className="font-display text-[20px] font-black text-[var(--brand-ink)]">{value}</p>
      <p className="text-[10px] text-[#9aa6bb]">{sub}</p>
    </div>
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
