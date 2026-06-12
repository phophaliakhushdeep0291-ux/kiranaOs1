import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useGetShop } from "@/lib/api/client";
import { useAuth } from "@/features/auth/useAuth";
import { useSubscriptionSnapshot } from "@/features/subscription";
import { useOfflineStatus } from "@/features/sync";
import { offlineDB } from "@/lib/offline/db";
import {
  Bell, Check, ChevronRight, Cloud, CreditCard, MonitorSmartphone, Plug, Printer, Receipt,
  Recycle, Settings2, Shield, Sliders, Sparkles, Store, Truck, UsersRound, LifeBuoy,
} from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Info, Badge } from "@/features/settings/ui";
import { DEFAULT_PRINTER_CONFIG, PRINTER_CONNECTION_LABELS, type PrinterConfig } from "@/features/settings/printer-config";

const PREFS_KEY = "kirana:settings-prefs:v1";

export default function SettingsPage() {
  const { user } = useAuth();
  const { snapshot } = useSubscriptionSnapshot();
  const { isOnline, isSyncing } = useOfflineStatus();
  const shop = useGetShop();
  const [printer, setPrinter] = useState<PrinterConfig>(DEFAULT_PRINTER_CONFIG);
  const [gst, setGst] = useState({ mode: "Exclusive (Add to price)", rate: "18%" });
  const [notifCount, setNotifCount] = useState<number | null>(null);

  useEffect(() => {
    void offlineDB.getSetting<Record<string, unknown>>(PREFS_KEY).then((p) => {
      if (!p) return;
      if (p.printer) setPrinter({ ...DEFAULT_PRINTER_CONFIG, ...(p.printer as Partial<PrinterConfig>) });
      if (typeof p.gstMode === "string" || typeof p.gstRate === "string") {
        setGst({ mode: (p.gstMode as string) ?? "Exclusive (Add to price)", rate: (p.gstRate as string) ?? "18%" });
      }
      const channels = ["lowStock", "paymentReminders", "dailySummary", "promotions"] as const;
      const on = channels.filter((k) => p[k] !== false).length;
      setNotifCount(on);
    });
  }, []);

  const planName = snapshot?.planCode ? snapshot.planCode.charAt(0).toUpperCase() + snapshot.planCode.slice(1) : "Free";
  const shopName = shop.data?.name ?? "My Store";
  const shopAddress = [shop.data?.address, shop.data?.city].filter(Boolean).join(", ") || "Add your store address";
  const shopEmail = (shop.data as { email?: string } | undefined)?.email ?? user?.email ?? "—";

  return (
    <SettingsShell>
      {/* Row 1: Store Profile + Billing */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead icon={<Store size={15} />} title="Store Profile" action={<Manage href="/settings/store-profile" />} />
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
          <CardHead icon={<CreditCard size={15} />} title="Billing & Subscription" action={<Manage href="/settings/billing" label="Manage Plan" />} />
          <div className="px-5 pb-4">
            <div className="mb-4 flex items-center gap-2">
              <Badge tone="amber">{planName} Plan</Badge>
              <Badge tone="gray"><span className="capitalize">{snapshot?.status ?? "active"}</span></Badge>
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
                <Link href="/settings/billing" className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-[#005dff] hover:underline">View plan <ChevronRight size={13} /></Link>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Row 2: Staff + Devices */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead icon={<UsersRound size={15} />} title="Staff & Permissions" action={<Manage href="/settings/staff" label="Manage Staff" />} />
          <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-4">
            <OverviewStat label="Total Staff" value="—" sub="Active users" />
            <OverviewStat label="Cashiers" value="—" sub="Can create bills" />
            <OverviewStat label="Managers" value="—" sub="Full access" />
            <OverviewStat label="View Only" value="—" sub="Read access" />
          </div>
          <p className="px-5 pb-4 text-[11px] text-[#9aa6bb]">Manage users, roles & permissions on the Staff page.</p>
        </Card>

        <Card>
          <CardHead icon={<MonitorSmartphone size={15} />} title="Device Management" sub="Manage your billing devices" action={<Manage href="/settings/devices" label="View All" />} />
          <div className="px-5 pb-3">
            <div className="flex items-center gap-3 py-2.5">
              <MonitorSmartphone size={16} className="text-[#536583]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-[#102347]">This Device</p>
                <p className="text-[11px] text-[#64748b]">Web · Active session</p>
              </div>
              <Badge tone="green">Active</Badge>
            </div>
            <Link href="/settings/devices" className="mt-1 flex items-center justify-center gap-1 py-2 text-[12px] font-bold text-[#005dff] hover:underline">+ Manage Devices</Link>
          </div>
        </Card>
      </div>

      {/* Row 3: Printer + Taxes + Sync */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHead icon={<Printer size={15} />} title="Printer & Billing" action={<Manage href="/settings/printer" label="Configure" />} />
          <div className="px-5 pb-4">
            <Info label="Default printer" value={printer.deviceName || "Browser / system printer"} />
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="blue">{PRINTER_CONNECTION_LABELS[printer.connection]}</Badge>
              <Badge tone="gray">{printer.paperSize}</Badge>
              <Badge tone={printer.autoPrint ? "green" : "gray"}>{printer.autoPrint ? "Auto-print on" : "Manual print"}</Badge>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead icon={<Receipt size={15} />} title="Taxes & GST" action={<Manage href="/settings/taxes" label="Configure" />} />
          <div className="px-5 pb-4">
            <Info label="GST mode" value={gst.mode} />
            <div className="mt-3"><Info label="Default rate" value={gst.rate} /></div>
          </div>
        </Card>

        <Card>
          <CardHead icon={<Cloud size={15} />} title="Sync & Backup" action={<Manage href="/settings/sync" label="View Logs" />} />
          <div className="px-5 pb-4">
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{isOnline ? (isSyncing ? "Syncing…" : "All synced") : "Offline"}
            </div>
            <p className="mt-2 text-[11px] text-[#64748b]">Auto-sync & daily cloud backup keep every device in step.</p>
          </div>
        </Card>
      </div>

      {/* Row 4: Security + Notifications + Integrations */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHead icon={<Shield size={15} />} title="Security & PIN" action={<Manage href="/settings/security" label="Manage" />} />
          <div className="px-5 pb-4">
            <div className="flex items-center justify-between">
              <Info label="Owner PIN" value="••••• Set" />
              <Badge tone="green">Protected</Badge>
            </div>
            <p className="mt-2 text-[11px] text-[#64748b]">Sensitive actions require the owner PIN.</p>
          </div>
        </Card>

        <Card>
          <CardHead icon={<Bell size={15} />} title="Notifications" action={<Manage href="/settings/notifications" label="Configure" />} />
          <div className="px-5 pb-4">
            <Info label="Active alerts" value={notifCount == null ? "—" : `${notifCount} of 4 enabled`} />
            <p className="mt-2 text-[11px] text-[#64748b]">Low stock, udhar reminders, daily summary & more.</p>
          </div>
        </Card>

        <Card>
          <CardHead icon={<Plug size={15} />} title="Integrations" action={<Manage href="/settings/integrations" label="Manage" />} />
          <div className="px-5 pb-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="green">WhatsApp</Badge>
              <Badge tone="green">TallyPrime</Badge>
              <Badge tone="amber">BharatPe</Badge>
            </div>
            <p className="mt-2 text-[11px] text-[#64748b]">Connect billing, payments & accounting tools.</p>
          </div>
        </Card>
      </div>

      {/* Advanced */}
      <Card>
        <CardHead icon={<Sliders size={15} />} title="Advanced" sub="Tools, data and account management" action={<Manage href="/settings/advanced" label="Open" />} />
        <div className="grid grid-cols-1 gap-2 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: "/suppliers", label: "Suppliers", desc: "Purchase parties", icon: Truck },
            { href: "/settings/staff", label: "Staff & Roles", desc: "Users and permissions", icon: UsersRound },
            { href: "/settings/devices", label: "Devices", desc: "Licensed devices", icon: MonitorSmartphone },
            { href: "/settings/sync", label: "Cloud Backup", desc: "Backup health & logs", icon: Cloud },
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
          <Link href="/settings/sync" className="hover:underline">What's New</Link>
          <button className="hover:underline">Help Center</button>
          <button className="hover:underline">Contact Support</button>
        </div>
      </div>
    </SettingsShell>
  );
}

function Manage({ href, label = "Manage" }: { href: string; label?: string }) {
  return <Link href={href} className="flex items-center gap-1 text-[12px] font-bold text-[#005dff] hover:underline">{label} <ChevronRight size={13} /></Link>;
}

function OverviewStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[8px] border border-[#e7edf7] p-3">
      <p className="text-[11px] font-semibold text-[#64748b]">{label}</p>
      <p className="font-display text-[20px] font-black text-[#102347]">{value}</p>
      <p className="text-[10px] text-[#9aa6bb]">{sub}</p>
    </div>
  );
}
