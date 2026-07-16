import type { ReactNode } from "react";
import { useLocation } from "wouter";
import {
  Bell, ChevronRight, Cloud, CreditCard, ListChecks, MonitorSmartphone, Plug, Printer, Receipt,
  Settings2, Shield, Sliders, Store, UsersRound, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SettingsMenuItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export const SETTINGS_MENU: SettingsMenuItem[] = [
  { id: "general", label: "General", href: "/settings", icon: Settings2 },
  { id: "setup", label: "Merchant Setup", href: "/settings/setup", icon: ListChecks },
  { id: "store", label: "Store Profile", href: "/settings/store-profile", icon: Store },
  { id: "billing", label: "Billing & Subscription", href: "/settings/billing", icon: CreditCard },
  { id: "staff", label: "Staff & Permissions", href: "/settings/staff", icon: UsersRound },
  { id: "devices", label: "Device Management", href: "/settings/devices", icon: MonitorSmartphone },
  { id: "printer", label: "Printer & Billing", href: "/settings/printer", icon: Printer },
  { id: "taxes", label: "Taxes & GST", href: "/settings/taxes", icon: Receipt },
  { id: "sync", label: "Sync & Backup", href: "/settings/sync", icon: Cloud },
  { id: "security", label: "Security & PIN", href: "/settings/security", icon: Shield },
  { id: "notifications", label: "Notifications", href: "/settings/notifications", icon: Bell },
  { id: "integrations", label: "Integrations", href: "/settings/integrations", icon: Plug },
  { id: "advanced", label: "Advanced", href: "/settings/advanced", icon: Sliders },
];

/**
 * Shared frame for every Settings tab: the dark-on-light settings submenu on the
 * left and the page content on the right. The app sidebar + header come from the
 * global Layout; this only owns the in-page submenu so the experience stays a
 * consistent SaaS control centre across tabs.
 */
export function SettingsShell({ children, className }: { children: ReactNode; className?: string }) {
  const [location, navigate] = useLocation();

  return (
    <div className="app-docked-page app-scrollbar overflow-x-auto">
      <div className="flex min-w-0 gap-4 lg:min-w-[920px] xl:min-w-0">
        <aside className="hidden w-[200px] shrink-0 lg:block">
          <nav className="sticky top-4 space-y-0.5">
            {SETTINGS_MENU.map((m) => {
              const isActive = location === m.href;
              return (
                <button
                  key={m.id}
                  onClick={() => navigate(m.href)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-left text-[13px] font-semibold transition-colors",
                    isActive ? "bg-[#eef5ff] text-[#005dff]" : "text-[#344668] hover:bg-[#eef2f8]",
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <m.icon size={16} className={isActive ? "text-[#005dff]" : "text-[#536583]"} />
                  <span className="flex-1 truncate">{m.label}</span>
                  {isActive && <ChevronRight size={14} className="text-[#9aa6bb]" />}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className={cn("min-w-0 flex-1 space-y-4", className)}>{children}</div>
      </div>
    </div>
  );
}

/**
 * Frames an existing standalone page (Billing/Staff/Devices) inside the shell.
 * Those pages wrap themselves in a padded, max-width PageShell; here we cancel
 * that outer padding/width so the content sits flush against the submenu and
 * aligns with the natively-built tabs instead of starting lower with a gap.
 */
export function FramedSettingsPage({ children }: { children: ReactNode }) {
  return (
    <SettingsShell>
      <div className="min-w-0 [&>*]:!max-w-none [&>*]:!p-0">{children}</div>
    </SettingsShell>
  );
}

