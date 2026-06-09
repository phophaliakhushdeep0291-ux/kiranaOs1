import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/features/auth/AuthContext";
import { useOfflineStatus } from "@/features/sync";
import {
  BookOpen,
  CalendarCheck,
  Cloud,
  FileText,
  LayoutDashboard,
  LogOut,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanBadge, SubscriptionStatusBanner, useSubscriptionSnapshot } from "@/features/subscription";
import { StatusBadge } from "@/components/shared";
import { useAppLanguage } from "@/features/settings/i18n";
import { VoiceAssistant } from "@/features/voice/VoiceAssistant";

const dailyLinks = [
  { href: "/dashboard", key: "nav.dashboard", icon: LayoutDashboard },
  { href: "/billing", key: "nav.billing", icon: ShoppingCart, emphasis: true },
  { href: "/bills", key: "nav.bills", icon: ReceiptText },
  { href: "/products", key: "nav.products", icon: Package },
  { href: "/inventory", key: "nav.inventory", icon: BookOpen },
  { href: "/purchase-bills", label: "Purchases", icon: Truck },
  { href: "/customers", key: "nav.customers", icon: Users },
  { href: "/udhar", key: "nav.udhar", icon: FileText },
] as const;

const businessLinks = [
  { href: "/reports", key: "nav.reports", icon: FileText },
  { href: "/daily-closing", key: "nav.closing", icon: CalendarCheck },
] as const;

const adminLinks = [
  { href: "/sync-status", label: "Cloud Backup", icon: Cloud },
  { href: "/settings", key: "nav.settings", icon: Settings },
] as const;

const mobileLinks = [...dailyLinks, ...businessLinks, ...adminLinks] as const;

const SIDEBAR_WIDTH_STORAGE_KEY = "kirana:desktop-sidebar-width";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "kirana:desktop-sidebar-collapsed";
const SIDEBAR_DEFAULT_WIDTH = 288;
const SIDEBAR_MIN_WIDTH = 236;
const SIDEBAR_MAX_WIDTH = 348;
const SIDEBAR_COLLAPSED_WIDTH = 84;

function isActiveLink(location: string, href: string) {
  return location === href || (href !== "/dashboard" && location.startsWith(`${href}/`));
}

function clampSidebarWidth(width: number) {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function readStoredSidebarWidth() {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    return stored ? clampSidebarWidth(Number(stored)) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function readStoredSidebarCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const { isOnline, pendingCount, failedCount, conflictCount, isSyncing } = useOfflineStatus();
  const { snapshot } = useSubscriptionSnapshot();
  const { t } = useAppLanguage();
  const attentionCount = pendingCount + failedCount + conflictCount;
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const liveSidebarWidthRef = useRef(sidebarWidth);
  const desktopSidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  const shellStyle = useMemo(
    () => ({ "--app-sidebar-width": `${desktopSidebarWidth}px` }) as CSSProperties,
    [desktopSidebarWidth],
  );

  useEffect(() => {
    liveSidebarWidthRef.current = sidebarWidth;
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch {
      // Local storage is only a preference; layout remains usable without it.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
    } catch {
      // Ignore preference persistence errors.
    }
  }, [sidebarCollapsed]);

  const handleSidebarResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (sidebarCollapsed) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setIsSidebarResizing(true);

    const writeSidebarWidth = (width: number) => {
      liveSidebarWidthRef.current = width;
      if (resizeFrameRef.current !== null) return;
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        shellRef.current?.style.setProperty("--app-sidebar-width", `${liveSidebarWidthRef.current}px`);
      });
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      writeSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
    };

    const handlePointerUp = () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      const nextWidth = liveSidebarWidthRef.current;
      shellRef.current?.style.setProperty("--app-sidebar-width", `${nextWidth}px`);
      setSidebarWidth(nextWidth);
      setIsSidebarResizing(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }, [sidebarCollapsed, sidebarWidth]);

  return (
    <div
      ref={shellRef}
      className="app-shell min-h-screen bg-background text-foreground lg:h-screen lg:overflow-hidden"
      style={shellStyle}
      data-sidebar-resizing={isSidebarResizing ? "true" : undefined}
    >
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl will-change-[width] lg:flex lg:h-screen lg:flex-col ${
          isSidebarResizing
            ? "transition-none"
            : "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        }`}
        style={{ width: "var(--app-sidebar-width)" }}
      >
        <button
          type="button"
          aria-label="Resize sidebar"
          title="Resize sidebar"
          disabled={sidebarCollapsed}
          onPointerDown={handleSidebarResize}
          className={`absolute inset-y-0 right-0 z-20 w-3 translate-x-1/2 cursor-col-resize transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring ${
            sidebarCollapsed ? "pointer-events-none opacity-0" : "opacity-0 hover:opacity-100 focus-visible:opacity-100"
          }`}
        >
          <span className="mx-auto block h-full w-1 rounded-full bg-sidebar-primary/55" />
        </button>

        <div className={`border-b border-sidebar-border ${sidebarCollapsed ? "p-3" : "p-4"}`}>
          <div className={`flex gap-3 ${sidebarCollapsed ? "flex-col items-center" : "items-start justify-between"}`}>
            <Link href="/dashboard" className={`group flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring ${sidebarCollapsed ? "justify-center" : ""}`}>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-md ring-1 ring-white/10">
                <ShoppingCart size={23} aria-hidden="true" />
              </div>
              <div
                className={`min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-200 ease-out ${
                  sidebarCollapsed ? "max-w-0 -translate-x-1 opacity-0" : "max-w-44 translate-x-0 opacity-100"
                }`}
              >
                <h1 className="text-lg font-black tracking-tight text-white">KiranaOS</h1>
                <p className="truncate text-xs text-sidebar-foreground/70">Retail command center</p>
              </div>
            </Link>
            <div className={`flex shrink-0 items-center gap-2 ${sidebarCollapsed ? "flex-col" : ""}`}>
              {!sidebarCollapsed && snapshot && <PlanBadge planCode={snapshot.planCode} status={snapshot.status} />}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                className="h-9 w-9 text-sidebar-foreground hover:bg-white/10 hover:text-white"
              >
                {sidebarCollapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}
              </Button>
            </div>
          </div>

          {sidebarCollapsed ? (
            <Link href="/sync-status" aria-label={isOnline ? "Online backup status" : "Offline backup status"}>
              <div className="mt-3 flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-sidebar-foreground ring-1 ring-white/10 hover:bg-white/15" title={isOnline ? "Online" : "Offline ready"}>
                {isOnline ? <Wifi size={17} aria-hidden="true" /> : <WifiOff size={17} aria-hidden="true" />}
              </div>
            </Link>
          ) : (
            <div className="mt-4 rounded-lg bg-white/10 p-3 ring-1 ring-white/10">
              <div className="flex items-center justify-between gap-3">
                <StatusBadge tone={isOnline ? "success" : "warning"} className="border-sidebar-border bg-white/10 text-white">
                  {isOnline ? (isSyncing ? "Backing up" : "Online") : "Offline ready"}
                </StatusBadge>
                <Link href="/sync-status">
                  <span className={`text-xs font-semibold ${attentionCount > 0 ? "text-amber-200" : "text-sidebar-foreground/70"}`}>
                    {attentionCount > 0 ? `${attentionCount} backup items` : "Backup clear"}
                  </span>
                </Link>
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs text-sidebar-foreground/72">
                <ShieldCheck size={14} aria-hidden="true" />
                <span>Billing works even when internet drops.</span>
              </div>
            </div>
          )}
        </div>

        <nav aria-label="Main navigation" className={`flex-1 space-y-4 overflow-y-auto ${sidebarCollapsed ? "p-2" : "p-3"}`}>
          <NavSection title="Daily counter" links={dailyLinks} location={location} t={t} collapsed={sidebarCollapsed} />
          <NavSection title="Owner view" links={businessLinks} location={location} t={t} collapsed={sidebarCollapsed} />
          <NavSection title="Admin" links={adminLinks} location={location} t={t} quiet collapsed={sidebarCollapsed} />
        </nav>

        <div className={`border-t border-sidebar-border ${sidebarCollapsed ? "p-2" : "p-4"}`}>
          {sidebarCollapsed ? (
            <Button onClick={logout} variant="ghost" size="icon" aria-label="Logout" title="Logout" className="h-10 w-10 text-sidebar-foreground hover:bg-white/10 hover:text-white">
              <LogOut size={16} aria-hidden="true" />
            </Button>
          ) : (
            <div className="rounded-lg bg-white/10 p-3 ring-1 ring-white/10">
              <div className="truncate text-sm font-semibold text-white">{user?.name ?? "Owner"}</div>
              <div className="mt-1 text-xs text-sidebar-foreground/70">{t("status.dataSafe")}</div>
              <Button onClick={logout} variant="ghost" className="mt-3 w-full justify-start text-sidebar-foreground hover:bg-white/10 hover:text-white">
                <LogOut size={16} aria-hidden="true" />
                Logout
              </Button>
            </div>
          )}
        </div>
      </aside>

      <div
        className={`flex min-h-screen min-w-0 flex-1 flex-col will-change-[margin-left] lg:ml-[var(--app-sidebar-width)] lg:h-screen lg:min-h-0 lg:overflow-hidden ${
          isSidebarResizing
            ? "transition-none"
            : "transition-[margin-left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        }`}
      >
        <header className="sticky top-0 z-40 border-b bg-card/95 px-3 py-2 shadow-sm backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-2">
            <Link href="/dashboard" className="flex items-center gap-2 rounded-xl font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ShoppingCart size={20} aria-hidden="true" />
              </div>
              <span>KiranaOS</span>
            </Link>
            <div className="flex items-center gap-2">
              {isOnline ? <Wifi size={18} className="text-emerald-600" aria-label="Online" /> : <WifiOff size={18} className="text-amber-600" aria-label="Offline" />}
              {snapshot && <PlanBadge planCode={snapshot.planCode} status={snapshot.status} />}
            </div>
          </div>
          <nav aria-label="Mobile navigation" className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {mobileLinks.map((link) => {
              const Icon = link.icon;
              const active = isActiveLink(location, link.href);
              return (
                <Link key={link.href} href={link.href}>
                  <div className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors ${active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background text-foreground hover:bg-accent"}`}>
                    <Icon size={15} aria-hidden="true" />
                    {"key" in link ? t(link.key) : link.label}
                  </div>
                </Link>
              );
            })}
          </nav>
        </header>

        <SubscriptionStatusBanner />
        <main id="main-content" className="min-w-0 flex-1 overflow-auto">
          {children}
        </main>
        <VoiceAssistant />
      </div>
    </div>
  );
}

type NavigationLink = (typeof mobileLinks)[number];

function NavSection({
  title,
  links,
  location,
  t,
  quiet = false,
  collapsed = false,
}: {
  title: string;
  links: readonly NavigationLink[];
  location: string;
  t: (key: Extract<NavigationLink, { key: string }>["key"]) => string;
  quiet?: boolean;
  collapsed?: boolean;
}) {
  return (
    <section className="space-y-1.5" aria-label={title}>
      {!collapsed && <p className="px-3 text-[11px] font-bold uppercase tracking-wide text-sidebar-foreground/48">{title}</p>}
      {links.map((link) => {
        const Icon = link.icon;
        const active = isActiveLink(location, link.href);
        const label = "key" in link ? t(link.key) : link.label;
        return (
          <Link key={link.href} href={link.href}>
            <div
              aria-current={active ? "page" : undefined}
              title={collapsed ? label : undefined}
              className={`group flex min-h-11 items-center rounded-lg py-2.5 text-sm font-semibold transition-all duration-200 ${
                collapsed ? "justify-center px-2" : "gap-3 px-3"
              } ${
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md ring-1 ring-white/10"
                  : "emphasis" in link && link.emphasis
                    ? "bg-white/10 text-white hover:translate-x-0.5 hover:bg-sidebar-accent"
                    : quiet
                      ? "text-sidebar-foreground/68 hover:translate-x-0.5 hover:bg-sidebar-accent hover:text-white"
                      : "text-sidebar-foreground/86 hover:translate-x-0.5 hover:bg-sidebar-accent hover:text-white"
              }`}
            >
              <Icon size={18} aria-hidden="true" />
              <span
                className={`flex-1 overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out ${
                  collapsed ? "max-w-0 -translate-x-1 opacity-0" : "max-w-40 translate-x-0 opacity-100"
                }`}
              >
                {label}
              </span>
            </div>
          </Link>
        );
      })}
    </section>
  );
}
