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
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BarChart3,
  Bell,
  ChevronDown,
  ChevronRight,
  Cloud,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  PercentSquare,
  ReceiptText,
  RefreshCw,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Tag,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanBadge, SubscriptionStatusBanner, useSubscriptionSnapshot } from "@/features/subscription";
import { useAppLanguage } from "@/features/settings/i18n";
import { useBusinessType } from "@/features/settings/business-types";
import { VoiceAssistant } from "@/features/voice/VoiceAssistant";
import { getApiBaseUrl } from "@/lib/api/http";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ── constants ─────────────────────────────────────────────────────────────────

const SIDEBAR_WIDTH_KEY = "kirana:sidebar-width-v3";
const SIDEBAR_COLLAPSED_KEY = "kirana:sidebar-collapsed-v2";
const SIDEBAR_GROUPS_KEY = "kirana:sidebar-groups-v2";
const DEFAULT_WIDTH = 242;
const MIN_WIDTH = 220;
const MAX_WIDTH = 320;
const COLLAPSED_WIDTH = 72;

// ── page title map ────────────────────────────────────────────────────────────

const PAGE_SUBTITLES: Record<string, string> = {
  "/billing": "Create fast bills and collect payments",
  "/dashboard": "Your business at a glance",
  "/products": "Manage your product catalog",
  "/categories": "Organise products into categories",
  "/inventory": "Track stock levels",
  "/inventory/stock-in": "Items currently in stock",
  "/inventory/stock-out": "Items that are out of stock",
  "/customers": "Customers and credit ledger",
  "/reports": "Sales insights and analytics",
  "/settings": "Manage your store, preferences, and system configurations",
};

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/billing": "Billing",
  "/bills": "Bills History",
  "/products": "Products",
  "/categories": "Categories",
  "/inventory": "Inventory",
  "/inventory/stock-in": "Stock In",
  "/inventory/stock-out": "Stock Out",
  "/purchase-bills": "Purchases",
  "/customers": "Customers / Udhar",
  "/udhar": "Udhar",
  "/reports": "Reports",
  "/daily-closing": "Daily Closing",
  "/expenses": "Expenses",
  "/offers": "Offers & Discounts",
  "/settings": "Settings",
  "/sync-status": "Cloud Backup",
  "/staff": "Staff",
  "/devices": "Devices",
  "/audit-logs": "Audit Logs",
  "/plans": "Plans",
  "/subscription": "Subscription",
};

function getPageTitle(loc: string): string {
  if (PAGE_TITLES[loc]) return PAGE_TITLES[loc];
  const match = Object.keys(PAGE_TITLES).find(k => k !== "/dashboard" && loc.startsWith(k + "/"));
  return match ? PAGE_TITLES[match] : "KiranaOS";
}

// ── nav data ──────────────────────────────────────────────────────────────────

type SubItem = { href: string; label: string };

interface LinkItem {
  kind: "link";
  href: string;
  label: string;
  Icon: React.ElementType;
  badge?: string;
  emphasis?: boolean;
}

interface GroupItem {
  kind: "group";
  id: string;
  label: string;
  Icon: React.ElementType;
  triggerPaths: string[];
  children: SubItem[];
}

type NavItem = LinkItem | GroupItem;

const NAV: NavItem[] = [
  { kind: "link", href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { kind: "link", href: "/billing", label: "Billing", Icon: ShoppingCart, badge: "F2", emphasis: true },
  {
    kind: "group", id: "inventory", label: "Inventory", Icon: Package,
    triggerPaths: ["/products", "/categories", "/inventory"],
    children: [
      { href: "/products", label: "Products" },
      { href: "/categories", label: "Categories" },
      { href: "/inventory/stock-in", label: "Stock In" },
      { href: "/inventory/stock-out", label: "Stock Out" },
      { href: "/inventory/adjustments", label: "Adjustments" },
      { href: "/inventory/stock-transfers", label: "Stock Transfers" },
    ],
  },
  { kind: "link", href: "/customers", label: "Customers / Udhar", Icon: Users },
  { kind: "link", href: "/purchase-bills", label: "Purchases", Icon: Truck },
  {
    kind: "group", id: "sales", label: "Sales", Icon: TrendingUp,
    triggerPaths: ["/bills"],
    children: [
      { href: "/bills", label: "Bills History" },
      { href: "/reports", label: "Sales Overview" },
    ],
  },
  { kind: "link", href: "/reports", label: "Reports", Icon: BarChart3 },
  { kind: "link", href: "/expenses", label: "Expenses", Icon: Wallet },
  { kind: "link", href: "/offers", label: "Offers & Discounts", Icon: PercentSquare },
  { kind: "link", href: "/settings", label: "Settings", Icon: Settings },
];

const MOBILE_NAV: { href: string; label: string; Icon: React.ElementType }[] = [
  { href: "/billing", label: "Billing", Icon: ShoppingCart },
  { href: "/products", label: "Products", Icon: Package },
  { href: "/customers", label: "Customers", Icon: Users },
  { href: "/reports", label: "Reports", Icon: BarChart3 },
  { href: "/dashboard", label: "More", Icon: LayoutDashboard },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function readLS(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writeLS(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch { /* ignored */ }
}
function clampW(w: number) {
  return Number.isFinite(w) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w))) : DEFAULT_WIDTH;
}
function isActive(loc: string, href: string) {
  return loc === href || (href !== "/dashboard" && loc.startsWith(href + "/"));
}
function initials(name: string) {
  return name.split(" ").slice(0, 2).map(s => s[0] ?? "").join("").toUpperCase() || "O";
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout, shop } = useAuth();
  const [loc] = useLocation();
  const { isOnline, backendStatus, pendingCount, failedCount, conflictCount, isSyncing } = useOfflineStatus();
  const { snapshot } = useSubscriptionSnapshot();
  const { def: btDef } = useBusinessType();
  const { t } = useAppLanguage();

  const attentionCount = pendingCount + failedCount + conflictCount;

  const [sidebarWidth, setSidebarWidth] = useState(() => clampW(Number(readLS(SIDEBAR_WIDTH_KEY, String(DEFAULT_WIDTH)))));
  const [collapsed, setCollapsed] = useState(() => readLS(SIDEBAR_COLLAPSED_KEY, "false") === "true");
  const [isResizing, setIsResizing] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(readLS(SIDEBAR_GROUPS_KEY, "[]")) as string[]); }
    catch { return new Set<string>(); }
  });

  const shellRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const liveW = useRef(sidebarWidth);

  const desktopW = collapsed ? COLLAPSED_WIDTH : sidebarWidth;
  const shellStyle = useMemo(() => ({ "--app-sidebar-width": `${desktopW}px` }) as CSSProperties, [desktopW]);

  // auto-expand groups when child route is active
  useEffect(() => {
    NAV.forEach(item => {
      if (item.kind !== "group") return;
      const hit = item.triggerPaths.some(p => isActive(loc, p)) || item.children.some(c => isActive(loc, c.href));
      if (hit) setExpandedGroups(prev => { const n = new Set(prev); n.add(item.id); return n; });
    });
  }, [loc]);

  useEffect(() => { liveW.current = sidebarWidth; writeLS(SIDEBAR_WIDTH_KEY, String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { writeLS(SIDEBAR_COLLAPSED_KEY, String(collapsed)); }, [collapsed]);
  useEffect(() => { writeLS(SIDEBAR_GROUPS_KEY, JSON.stringify([...expandedGroups])); }, [expandedGroups]);
  useEffect(() => () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); }, []);

  const toggleGroup = useCallback((id: string) => {
    setExpandedGroups(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const handleResize = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (collapsed) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const startX = e.clientX; const startW = sidebarWidth;
    const prevCursor = document.body.style.cursor; const prevSel = document.body.style.userSelect;
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
    setIsResizing(true);
    const writeW = (w: number) => {
      liveW.current = w;
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => { frameRef.current = null; shellRef.current?.style.setProperty("--app-sidebar-width", `${liveW.current}px`); });
    };
    const onMove = (ev: PointerEvent) => writeW(clampW(startW + ev.clientX - startX));
    const onUp = () => {
      if (frameRef.current !== null) { cancelAnimationFrame(frameRef.current); frameRef.current = null; }
      shellRef.current?.style.setProperty("--app-sidebar-width", `${liveW.current}px`);
      setSidebarWidth(liveW.current); setIsResizing(false);
      document.body.style.cursor = prevCursor; document.body.style.userSelect = prevSel;
      window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [collapsed, sidebarWidth]);

  const storeName = shop?.name ?? user?.name ?? "My Store";
  const storeLocation = [shop?.city, shop?.address].filter(Boolean)[0] ?? user?.email ?? "Owner";

  // apply business-type nav label overrides
  const labelOverrides: Record<string, string> = {
    "/billing": btDef.navConfig.billing,
    "/products": btDef.navConfig.products,
    "/inventory": btDef.navConfig.inventory,
    "/customers": btDef.navConfig.udhar,
  };

  return (
    <div ref={shellRef} className="app-shell min-h-screen bg-background text-foreground lg:h-screen lg:overflow-hidden" style={shellStyle} data-sidebar-resizing={isResizing ? "true" : undefined}>

      {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl will-change-[width] lg:flex lg:h-screen lg:flex-col",
          isResizing ? "transition-none" : "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        )}
        style={{ width: "var(--app-sidebar-width)" }}
      >
        {/* resize handle */}
        <button type="button" aria-label="Resize sidebar" disabled={collapsed} onPointerDown={handleResize}
          className={cn("absolute inset-y-0 right-0 z-20 w-3 translate-x-1/2 cursor-col-resize transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring", collapsed ? "pointer-events-none opacity-0" : "opacity-0 hover:opacity-100 focus-visible:opacity-100")}>
          <span className="mx-auto block h-full w-1 rounded-full bg-sidebar-primary/35" />
        </button>

        {/* Logo */}
        <div className={cn("flex items-center border-b border-sidebar-border", collapsed ? "flex-col gap-3 p-3" : "gap-3 p-4")}>
          <Link href="/dashboard" className="flex shrink-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-white shadow-lg ring-2 ring-white/15">
              <ShoppingCart size={20} aria-hidden="true" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-display text-lg font-black leading-none tracking-tight text-white">KiranaOS</div>
                <div className="mt-0.5 text-[10px] font-medium leading-none text-sidebar-foreground/50">{btDef.navConfig.tagline}</div>
              </div>
            )}
          </Link>
          {!collapsed && (
            <button type="button" aria-label="Collapse sidebar" onClick={() => setCollapsed(true)}
              className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/40 hover:bg-white/10 hover:text-white transition-colors">
              <ChevronRight size={14} className="rotate-180" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav aria-label="Main navigation" className={cn("flex-1 overflow-y-auto py-3", collapsed ? "space-y-1 px-2" : "space-y-0.5 px-3")}>
          {NAV.map(item =>
            item.kind === "link"
              ? <SidebarLink key={item.href} item={item} loc={loc} collapsed={collapsed} labelOverride={labelOverrides[item.href]} />
              : <SidebarGroup key={item.id} item={item} loc={loc} collapsed={collapsed} expanded={expandedGroups.has(item.id)} onToggle={() => toggleGroup(item.id)} labelOverrides={labelOverrides} />
          )}
        </nav>

        {/* Footer */}
        <div className={cn("border-t border-sidebar-border", collapsed ? "p-2 space-y-1.5" : "p-3 space-y-2")}>
          {collapsed ? (
            <>
              <button type="button" onClick={() => setCollapsed(false)} aria-label="Expand sidebar"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground/50 hover:bg-white/10 hover:text-white transition-colors">
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <button type="button" onClick={logout} aria-label="Logout"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground/50 hover:bg-white/10 hover:text-white transition-colors">
                <LogOut size={16} aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              {/* Sync status */}
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full animate-pulse", isOnline ? "bg-emerald-400 animation-none" : "bg-amber-400")} style={isOnline ? { animation: "none" } : undefined} />
                  <span className="text-sm font-semibold text-white">
                    {isOnline ? (isSyncing ? "Syncing…" : "Synced") : "Offline safe"}
                  </span>
                  {attentionCount > 0 && <span className="ml-auto text-[11px] font-bold text-amber-300">{attentionCount}</span>}
                </div>
                <p className="mt-1 text-[11px] text-sidebar-foreground/50">{isOnline ? "Last synced just now" : "Your data is safe on this device"}</p>
                <Link href="/sync-status" className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-sidebar-primary hover:text-white transition-colors">
                  <RefreshCw size={10} aria-hidden="true" /> Sync Now
                </Link>
              </div>

              {/* Help */}
              <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/55 transition-colors hover:bg-white/8 hover:text-white">
                <MessageCircle size={15} aria-hidden="true" />
                <div className="text-left">
                  <div className="text-xs font-semibold leading-none">Need help?</div>
                  <div className="mt-0.5 text-[10px] leading-none opacity-70">Chat with support</div>
                </div>
              </button>

              {/* Store + logout */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/8">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-white">
                      {initials(storeName)}
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-semibold text-white">{storeName}</div>
                      <div className="truncate text-[10px] text-sidebar-foreground/50">{user?.email ?? "Owner"}</div>
                    </div>
                    <ChevronDown size={13} className="shrink-0 text-sidebar-foreground/40" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-52">
                  <DropdownMenuItem asChild><Link href="/settings">Settings</Link></DropdownMenuItem>
                  <DropdownMenuItem asChild><Link href="/sync-status">Sync Status</Link></DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                    <LogOut size={14} className="mr-2" aria-hidden="true" /> Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </aside>

      {/* ── Main wrapper ────────────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex min-h-screen min-w-0 flex-1 flex-col will-change-[margin-left] lg:ml-[var(--app-sidebar-width)] lg:h-screen lg:min-h-0 lg:overflow-hidden",
          isResizing ? "transition-none" : "transition-[margin-left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        )}
      >
        {/* Desktop topbar */}
        <header className={cn("sticky top-0 z-40 hidden h-[76px] items-center gap-4 bg-background/95 px-5 backdrop-blur lg:flex", loc !== "/billing" && "border-b border-border")}>
          <button
            type="button"
            aria-label="Toggle sidebar"
            onClick={() => setCollapsed((c) => !c)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-foreground/70 shadow-sm transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Menu size={19} aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[26px] font-black tracking-tight text-foreground leading-none">{getPageTitle(loc)}</h1>
            {PAGE_SUBTITLES[loc] && (
              <p className="text-[12.5px] font-medium text-muted-foreground leading-none mt-1.5">{PAGE_SUBTITLES[loc]}</p>
            )}
          </div>

          <div className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
            isOnline ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", isOnline ? "bg-emerald-500" : "bg-amber-500")} />
            {isOnline ? (isSyncing ? "Syncing…" : "Synced") : "Offline"}
            {isOnline && !isSyncing && <span className="opacity-60">· Just now</span>}
          </div>

          <div className="hidden w-64 items-center gap-2 rounded-lg border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-background xl:flex">
            <Search size={14} aria-hidden="true" />
            <span className="flex-1 truncate">Search products, bills, customers…</span>
            <kbd className="rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium">⌘K</kbd>
          </div>

          <button type="button" aria-label="Notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">
            <Bell size={17} aria-hidden="true" />
            {attentionCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">
                {attentionCount}
              </span>
            )}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2.5 rounded-xl border bg-background px-2.5 py-1.5 text-sm transition-colors hover:border-primary/40">
                <div className="hidden text-right xl:block">
                  <div className="text-[13px] font-extrabold leading-tight text-foreground">{storeName}</div>
                  <div className="text-[11px] leading-tight text-muted-foreground">{storeLocation}</div>
                </div>
                <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                  {initials(storeName)}
                </div>
                <ChevronDown size={13} className="text-muted-foreground" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild><Link href="/settings">Settings</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/sync-status">Sync Status</Link></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                <LogOut size={14} className="mr-2" aria-hidden="true" /> Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Mobile topbar */}
        <header className="sticky top-0 z-40 border-b bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link href="/dashboard" className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow">
                <ShoppingCart size={17} aria-hidden="true" />
              </div>
              <span className="font-display text-lg font-black tracking-tight">KiranaOS</span>
            </Link>
            <div className="flex items-center gap-2">
              <div className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                isOnline ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
                <span className={cn("h-1.5 w-1.5 rounded-full", isOnline ? "bg-emerald-500" : "bg-amber-500")} />
                {isOnline ? "Synced" : "Offline"}
              </div>
              {snapshot && <PlanBadge planCode={snapshot.planCode} status={snapshot.status} />}
            </div>
          </div>
        </header>

        <SubscriptionStatusBanner />
        {backendStatus.browserOnline && !backendStatus.backendReachable && backendStatus.checkedAt && (
          <BackendUnreachableBanner apiBaseUrl={getApiBaseUrl()} />
        )}

        <main id="main-content" className="min-w-0 flex-1 overflow-auto pb-20 lg:pb-0">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur lg:hidden">
          <div className="grid grid-cols-5">
            {MOBILE_NAV.map(({ href, label, Icon }) => {
              const active = isActive(loc, href);
              return (
                <Link key={href} href={href}>
                  <div className={cn("flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors", active ? "text-primary" : "text-muted-foreground")}>
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl transition-colors", active && "bg-primary/10")}>
                      <Icon size={20} aria-hidden="true" />
                    </div>
                    {label}
                  </div>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      <VoiceAssistant />
    </div>
  );
}

// ── Sidebar nav components ────────────────────────────────────────────────────

function SidebarLink({ item, loc, collapsed, labelOverride }: {
  item: LinkItem; loc: string; collapsed: boolean; labelOverride?: string;
}) {
  const active = isActive(loc, item.href);
  const label = labelOverride ?? item.label;
  return (
    <Link href={item.href}>
      <div
        role="menuitem"
        aria-current={active ? "page" : undefined}
        title={collapsed ? label : undefined}
        className={cn(
          "group flex min-h-[42px] items-center rounded-lg text-sm font-medium transition-all duration-150",
          collapsed ? "justify-center px-0" : "gap-3 px-3",
          active
            ? "bg-sidebar-primary text-white shadow-md shadow-sidebar-primary/30"
            : item.emphasis
              ? "text-white/90 hover:bg-white/10 hover:text-white"
              : "text-sidebar-foreground/70 hover:bg-white/8 hover:text-white"
        )}
      >
        <item.Icon size={17} aria-hidden="true" />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{label}</span>
            {item.badge && !active && (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-sidebar-foreground/50">
                {item.badge}
              </span>
            )}
          </>
        )}
      </div>
    </Link>
  );
}

function SidebarGroup({ item, loc, collapsed, expanded, onToggle, labelOverrides }: {
  item: GroupItem; loc: string; collapsed: boolean; expanded: boolean; onToggle: () => void; labelOverrides: Record<string, string>;
}) {
  const groupActive = item.triggerPaths.some(p => isActive(loc, p)) || item.children.some(c => isActive(loc, c.href));

  if (collapsed) {
    const firstHref = item.triggerPaths[0] ?? item.children[0]?.href ?? "#";
    return (
      <Link href={firstHref}>
        <div title={item.label}
          className={cn("flex h-[42px] items-center justify-center rounded-lg transition-all duration-150",
            groupActive ? "bg-sidebar-primary text-white shadow-md shadow-sidebar-primary/30" : "text-sidebar-foreground/70 hover:bg-white/8 hover:text-white")}>
          <item.Icon size={17} aria-hidden="true" />
        </div>
      </Link>
    );
  }

  return (
    <div>
      <button type="button" onClick={onToggle}
        className={cn("group flex min-h-[42px] w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-all duration-150",
          groupActive ? "bg-white/10 text-white" : "text-sidebar-foreground/70 hover:bg-white/8 hover:text-white")}>
        <item.Icon size={17} aria-hidden="true" />
        <span className="flex-1 truncate text-left">{item.label}</span>
        <ChevronDown size={13} aria-hidden="true"
          className={cn("shrink-0 text-sidebar-foreground/35 transition-transform duration-200", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="mt-0.5 mb-1 space-y-0.5 pl-[42px]">
          {item.children.map(child => {
            const active = isActive(loc, child.href);
            const label = labelOverrides[child.href] ?? child.label;
            return (
              <Link key={child.href} href={child.href}>
                <div aria-current={active ? "page" : undefined}
                  className={cn("flex min-h-8 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    active ? "bg-sidebar-primary text-white" : "text-sidebar-foreground/55 hover:bg-white/8 hover:text-white")}>
                  <span className={cn("text-[8px]", active ? "text-white" : "text-sidebar-foreground/30")}>●</span>
                  {label}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BackendUnreachableBanner({ apiBaseUrl }: { apiBaseUrl: string }) {
  const isLocalhost = apiBaseUrl.includes("localhost") || apiBaseUrl.includes("127.0.0.1");
  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
      <WifiOff size={15} className="shrink-0 text-amber-600" aria-hidden="true" />
      <span className="flex-1 leading-tight">
        {isLocalhost ? "Backend is set to localhost — not accessible on this device. " : "Backend server is not reachable. "}
        <Link href="/sync-status" className="font-semibold underline underline-offset-2">Fix Server URL →</Link>
      </span>
    </div>
  );
}
