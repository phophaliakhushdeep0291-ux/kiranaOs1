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
import { useAuth } from "@/features/auth/useAuth";
import { useOfflineStatus } from "@/features/sync";
import {
  BarChart3,
  Bell,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PercentSquare,
  RefreshCw,
  Search,
  Settings,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  WifiOff,
} from "lucide-react";
import { PlanBadge, SubscriptionStatusBanner, useSubscriptionSnapshot } from "@/features/subscription";
import { useBusinessType } from "@/features/settings/business-types";
import { VoiceAssistant } from "@/features/voice/VoiceAssistant";
import { DemoModeBanner } from "@/features/demo/DemoModeBanner";
import { CommandPalette } from "./CommandPalette";
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
const DEFAULT_WIDTH = 256;
const MIN_WIDTH = 232;
const MAX_WIDTH = 320;
const COLLAPSED_WIDTH = 76;

// ── page title map ────────────────────────────────────────────────────────────

const PAGE_SUBTITLES: Record<string, string> = {
  "/billing": "Create fast bills and collect payments",
  "/dashboard": "Live sales, cash, stock, and sync health",
  "/bills": "View, manage, and track all your sales bills",
  "/products": "Manage your product catalog, pricing and stock",
  "/categories": "Organise products into categories",
  "/inventory": "Manage stock, movements, and purchase flow",
  "/inventory/stock-in": "Add incoming stock to inventory",
  "/inventory/stock-out": "Report outgoing stock from inventory",
  "/inventory/adjustments": "Adjust inventory quantities and review corrections",
  "/inventory/stock-transfers": "Transfer stock between locations",
  "/purchase-bills": "Manage purchase bills, suppliers, and purchase dues",
  "/returns/new": "Record a customer return — restock items and refund",
  "/customers": "Track credit, payments, and customer trust",
  "/reports": "Track performance, trends, and data-driven decisions",
  "/daily-closing": "Cash drawer and daily business summary",
  "/expenses": "Track shop expenses and outflows",
  "/offers": "Create coupons and discounts for billing",
  "/settings": "Manage your store, preferences, and system configurations",
  "/sync-status": "Monitor cloud backup and local-first safety",
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
  "/inventory/adjustments": "Adjustments",
  "/inventory/stock-transfers": "Stock Transfers",
  "/purchase-bills": "Purchases",
  "/returns/new": "New Return",
  "/customers": "Customers / Udhar",
  "/udhar": "Udhar",
  "/reports": "Reports & Analytics",
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

function getPageSubtitle(loc: string): string | undefined {
  if (PAGE_SUBTITLES[loc]) return PAGE_SUBTITLES[loc];
  const match = Object.keys(PAGE_SUBTITLES).find(k => loc.startsWith(k + "/"));
  return match ? PAGE_SUBTITLES[match] : undefined;
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
  overviewHref?: string;
  triggerPaths: string[];
  children: SubItem[];
}

type NavItem = LinkItem | GroupItem;

const NAV: NavItem[] = [
  { kind: "link", href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { kind: "link", href: "/billing", label: "Billing", Icon: ShoppingCart, badge: "F2", emphasis: true },
  {
    kind: "group", id: "inventory", label: "Inventory", Icon: Package, overviewHref: "/inventory",
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
    triggerPaths: ["/bills", "/returns"],
    children: [
      { href: "/bills", label: "Bills History" },
      { href: "/returns/new", label: "New Return" },
      { href: "/reports", label: "Sales Overview" },
    ],
  },
  { kind: "link", href: "/reports", label: "Reports", Icon: BarChart3 },
  { kind: "link", href: "/expenses", label: "Expenses", Icon: Wallet },
  { kind: "link", href: "/offers", label: "Offers & Discounts", Icon: PercentSquare },
  { kind: "link", href: "/settings", label: "Settings", Icon: Settings },
];

const MOBILE_NAV: { href: string; label: string; Icon: React.ElementType }[] = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/billing", label: "Billing", Icon: ShoppingCart },
  { href: "/inventory", label: "Inventory", Icon: Package },
  { href: "/customers", label: "Customers", Icon: Users },
  { href: "/settings", label: "More", Icon: Settings },
];

const MOBILE_MENU: { href: string; label: string; Icon: React.ElementType }[] = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/billing", label: "Billing", Icon: ShoppingCart },
  { href: "/inventory", label: "Inventory", Icon: Package },
  { href: "/customers", label: "Customers / Udhar", Icon: Users },
  { href: "/purchase-bills", label: "Purchases", Icon: Truck },
  { href: "/bills", label: "Bills History", Icon: TrendingUp },
  { href: "/reports", label: "Reports", Icon: BarChart3 },
  { href: "/expenses", label: "Expenses", Icon: Wallet },
  { href: "/settings", label: "Settings", Icon: Settings },
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
function isMobileNavActive(loc: string, href: string) {
  if (href === "/inventory") {
    return ["/inventory", "/products", "/categories"].some((path) => isActive(loc, path));
  }
  return isActive(loc, href);
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

  const attentionCount = pendingCount + failedCount + conflictCount;
  const hasSyncProblems = failedCount > 0 || conflictCount > 0;
  const hasPendingSync = pendingCount > 0;
  const backendChecked = Boolean(backendStatus.checkedAt);
  const connectionLabel = isOnline
    ? (hasSyncProblems ? "Review sync" : isSyncing ? "Syncing..." : hasPendingSync ? `${pendingCount} pending` : "Synced")
    : backendStatus.browserOnline
      ? (backendChecked ? "Cloud paused" : "Checking backup")
      : "Offline safe";
  const connectionDetail = isOnline
    ? (hasSyncProblems ? "Some records need owner review" : hasPendingSync ? "Backup will finish shortly" : "Last synced just now")
    : backendStatus.browserOnline
      ? "Local billing works; backup will retry"
      : "Your data is safe on this device";
  const connectionBadgeClass = isOnline
    ? (hasSyncProblems
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : hasPendingSync
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700")
    : backendStatus.browserOnline
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : "border-amber-200 bg-amber-50 text-amber-700";
  const connectionDotClass = isOnline
    ? (hasSyncProblems ? "bg-rose-500" : hasPendingSync ? "bg-amber-500" : "bg-emerald-500")
    : backendStatus.browserOnline
      ? "bg-sky-500"
      : "bg-amber-500";

  const [sidebarWidth, setSidebarWidth] = useState(() => clampW(Number(readLS(SIDEBAR_WIDTH_KEY, String(DEFAULT_WIDTH)))));
  const [collapsed, setCollapsed] = useState(() => readLS(SIDEBAR_COLLAPSED_KEY, "false") === "true");
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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
    <div ref={shellRef} className="app-shell isolate h-[100dvh] overflow-hidden bg-background text-foreground lg:h-screen" style={shellStyle} data-sidebar-resizing={isResizing ? "true" : undefined}>

      {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden border-r border-white/10 bg-sidebar text-sidebar-foreground shadow-[10px_0_40px_rgba(3,18,43,0.20)] will-change-[width] lg:flex lg:h-screen lg:flex-col",
          isResizing ? "transition-none" : "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        )}
        style={{
          width: "var(--app-sidebar-width)",
          background: "radial-gradient(circle at 20% 0%, rgba(0,91,255,0.22), transparent 18rem), linear-gradient(180deg,#061b38 0%,#04152d 62%,#031024 100%)",
        }}
      >
        {/* resize handle */}
        <button type="button" aria-label="Resize sidebar" disabled={collapsed} onPointerDown={handleResize}
          className={cn("absolute inset-y-0 right-0 z-20 w-3 translate-x-1/2 cursor-col-resize transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring", collapsed ? "pointer-events-none opacity-0" : "opacity-0 hover:opacity-100 focus-visible:opacity-100")}>
          <span className="mx-auto block h-full w-1 rounded-full bg-sidebar-primary/35" />
        </button>

        {/* Logo */}
        <div className={cn("flex items-center border-b border-white/10", collapsed ? "flex-col gap-3 p-3" : "gap-3 px-4 py-5")}>
          <Link href="/dashboard" className="flex min-w-0 shrink-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[#075cf7] text-white shadow-[0_14px_28px_rgba(0,91,255,0.30)] ring-1 ring-white/20">
              <ShoppingCart size={20} aria-hidden="true" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-display text-[25px] font-black leading-none tracking-tight text-white">
                  Kirana<span className="text-[#2b7cff]">OS</span>
                </div>
                <div className="mt-1 truncate text-[11px] font-medium leading-none text-white/68">{btDef.navConfig.tagline}</div>
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
        <nav aria-label="Main navigation" className={cn("app-scrollbar flex-1 overflow-y-auto py-4", collapsed ? "space-y-1 px-2" : "space-y-1 px-3")}>
          {NAV.map(item =>
            item.kind === "link"
              ? <SidebarLink key={item.href} item={item} loc={loc} collapsed={collapsed} labelOverride={labelOverrides[item.href]} />
              : <SidebarGroup key={item.id} item={item} loc={loc} collapsed={collapsed} expanded={expandedGroups.has(item.id)} onToggle={() => toggleGroup(item.id)} labelOverrides={labelOverrides} />
          )}
        </nav>

        {/* Footer */}
        <div className={cn("border-t border-white/10", collapsed ? "p-2 space-y-1.5" : "p-4 space-y-3")}>
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
              <div className="rounded-[14px] border border-white/12 bg-white/[0.055] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", connectionDotClass, !isOnline && "animate-pulse")} />
                  <span className="text-sm font-semibold text-white">
                    {connectionLabel}
                  </span>
                  {attentionCount > 0 && <span className="ml-auto text-[11px] font-bold text-amber-300">{attentionCount}</span>}
                </div>
                <p className="mt-1 text-[11px] text-sidebar-foreground/50">{connectionDetail}</p>
                <Link href="/sync-status" className="mt-3 flex h-10 items-center justify-center gap-2 rounded-[10px] border border-white/12 bg-white/5 text-[12px] font-bold text-white transition-colors hover:border-[#075cf7]/70 hover:bg-[#075cf7]">
                  <RefreshCw size={13} aria-hidden="true" /> Sync Now
                </Link>
              </div>

              {/* Store + logout */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex w-full items-center gap-3 rounded-[14px] border border-white/10 bg-white/[0.045] px-3 py-3 text-sm transition-colors hover:bg-white/8">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#075cf7] text-xs font-bold text-white ring-2 ring-white/15">
                      {initials(storeName)}
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-semibold text-white">{storeName}</div>
                      <div className="truncate text-[11px] text-white/55">{storeLocation}</div>
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
          "flex h-[100dvh] min-h-0 min-w-0 flex-1 flex-col overflow-hidden will-change-[margin-left] lg:ml-[var(--app-sidebar-width)] lg:h-screen",
          isResizing ? "transition-none" : "transition-[margin-left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        )}
      >
        {/* Desktop topbar */}
        <header className="sticky top-0 z-40 hidden min-h-[var(--app-desktop-topbar-height)] items-center gap-4 border-b border-[#e6ecf4] bg-white/94 px-5 shadow-[0_1px_0_rgba(15,35,80,0.02)] backdrop-blur-xl lg:flex xl:px-6">
          <button
            type="button"
            aria-label="Toggle sidebar"
            onClick={() => setCollapsed((c) => !c)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-[#dfe8f5] bg-white text-[#0f2147] shadow-sm transition-colors hover:border-primary/40 hover:bg-[#f5f9ff] hover:text-primary"
          >
            <Menu size={19} aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[20px] font-black tracking-tight text-[#0f2147] leading-none">{getPageTitle(loc)}</h1>
            {getPageSubtitle(loc) && (
              <p className="mt-1.5 truncate text-[12px] font-medium leading-none text-[#64748b]">{getPageSubtitle(loc)}</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search products, bills, and customers"
            className="hidden h-11 w-[320px] items-center gap-2 rounded-[12px] border border-[#dfe8f5] bg-[#f8fbff] px-3 text-left text-[#64748b] shadow-sm transition-colors hover:border-primary/40 hover:bg-white xl:flex"
          >
            <Search size={17} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">Search products, bills, customers...</span>
            <span className="rounded-[7px] border border-[#dbe6f5] bg-white px-1.5 py-0.5 font-mono text-[10px] font-black text-[#64748b]">Ctrl K</span>
          </button>

          <div className={cn("flex h-10 max-w-[178px] items-center justify-center gap-1.5 truncate rounded-[10px] border px-3 text-xs font-bold shadow-sm", connectionBadgeClass)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", connectionDotClass)} />
            <span className="truncate">{connectionLabel}</span>
            {isOnline && !isSyncing && !hasPendingSync && !hasSyncProblems && <span className="opacity-60">Just now</span>}
          </div>

          {snapshot && <PlanBadge planCode={snapshot.planCode} status={snapshot.status} />}

          <Link href="/sync-status">
            <div aria-label="Open sync alerts"
              className="relative flex h-11 w-11 items-center justify-center rounded-[12px] border border-[#dfe8f5] bg-white text-[#0f2147] shadow-sm transition-colors hover:border-primary/40 hover:bg-[#f5f9ff] hover:text-primary">
              <Bell size={18} aria-hidden="true" />
              {attentionCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">
                  {attentionCount}
                </span>
              )}
            </div>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 rounded-[14px] border border-[#dfe8f5] bg-white px-2.5 py-2 text-sm shadow-sm transition-colors hover:border-primary/40 hover:bg-[#f8fbff]">
                <div className="hidden text-right xl:block">
                  <div className="text-[13px] font-extrabold leading-tight text-[#0f2147]">{storeName}</div>
                  <div className="text-[11px] leading-tight text-[#64748b]">{storeLocation}</div>
                </div>
                <div className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-[#075cf7] text-sm font-bold text-white ring-2 ring-[#e7f0ff]">
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
        <header className="sticky top-0 z-40 min-h-[var(--app-mobile-topbar-height)] border-b border-[#e4ebf4] bg-white/95 px-3 py-2.5 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Open navigation" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[#075fff] transition-colors hover:bg-[#eef4ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075fff]/30">
                    <Menu size={22} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60 p-2">
                  {MOBILE_MENU.map(({ href, label, Icon }) => (
                    <DropdownMenuItem key={href} asChild>
                      <Link href={href} className="flex cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2.5 font-semibold">
                        <Icon size={16} aria-hidden="true" /> {label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Link href="/dashboard" className="min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="block truncate font-display text-[19px] font-black tracking-tight text-[#102347]">Kirana<span className="text-[#075fff]">OS</span></span>
                <span className="block truncate text-[8px] font-semibold text-[#64748b]">Smart POS for Modern Stores</span>
              </Link>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Link href="/sync-status" aria-label="Notifications" className="relative grid h-9 w-9 place-items-center rounded-full text-[#102347] transition-colors hover:bg-[#f3f7fc]">
                <Bell size={18} aria-hidden="true" />
                {attentionCount > 0 && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#ef233c] px-1 text-[8px] font-black text-white">{attentionCount}</span>}
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="Open profile menu" className="grid h-9 w-9 place-items-center rounded-full bg-[#075fff] text-[11px] font-black text-white ring-2 ring-[#e6efff]">
                    {initials(storeName)}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem asChild><Link href="/settings">Settings</Link></DropdownMenuItem>
                  <DropdownMenuItem asChild><Link href="/sync-status">Sync Status</Link></DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive"><LogOut size={14} className="mr-2" /> Logout</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <SubscriptionStatusBanner />
        {backendStatus.browserOnline && !backendStatus.backendReachable && backendStatus.checkedAt && (
          <BackendUnreachableBanner apiBaseUrl={getApiBaseUrl()} />
        )}

        <main id="main-content" className="app-main-scroll app-scrollbar min-w-0 flex-1 overflow-auto scroll-smooth overscroll-contain bg-white pb-[calc(var(--app-mobile-nav-height)+env(safe-area-inset-bottom))] lg:pb-0">
          <DemoModeBanner />
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(15,35,80,0.08)] backdrop-blur lg:hidden">
          <div className="grid grid-cols-5">
            {MOBILE_NAV.map(({ href, label, Icon }) => {
              const active = isMobileNavActive(loc, href);
              return (
                <Link key={href} href={href}>
                  <div className={cn("flex min-h-[var(--app-mobile-nav-height)] flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors", active ? "text-primary" : "text-muted-foreground")}>
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
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
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
          "group flex min-h-[44px] items-center rounded-[10px] text-[14px] font-semibold transition-all duration-150",
          collapsed ? "justify-center px-0" : "gap-3 px-3",
          active
            ? "bg-[#075cf7] text-white shadow-[0_10px_22px_rgba(0,91,255,0.26)]"
            : item.emphasis
              ? "text-white/90 hover:bg-white/10 hover:text-white"
              : "text-white/76 hover:bg-white/8 hover:text-white"
        )}
      >
        <item.Icon size={18} aria-hidden="true" />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{label}</span>
            {item.badge && !active && (
              <span className="rounded-[6px] bg-[#075cf7] px-1.5 py-0.5 text-[10px] font-black text-white shadow-sm">
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
    const firstHref = item.overviewHref ?? item.triggerPaths[0] ?? item.children[0]?.href ?? "#";
    return (
      <Link href={firstHref}>
        <div title={item.label}
          className={cn("flex h-[44px] items-center justify-center rounded-[10px] transition-all duration-150",
            groupActive ? "bg-[#075cf7] text-white shadow-[0_10px_22px_rgba(0,91,255,0.26)]" : "text-white/76 hover:bg-white/8 hover:text-white")}>
          <item.Icon size={18} aria-hidden="true" />
        </div>
      </Link>
    );
  }

  if (item.overviewHref) {
    const overviewActive = loc === item.overviewHref;
    return (
      <div>
        <div className={cn("group flex min-h-[44px] w-full items-center rounded-[10px] transition-all duration-150",
          groupActive ? "bg-white/10 text-white" : "text-white/76 hover:bg-white/8 hover:text-white")}>
          <Link href={item.overviewHref} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-l-[10px] px-3">
            <item.Icon size={18} aria-hidden="true" />
            <span className="flex-1 truncate text-left text-[14px] font-semibold">{item.label}</span>
            {overviewActive ? <span className="sr-only">Current page</span> : null}
          </Link>
          <button type="button" onClick={onToggle} aria-label={`${expanded ? "Collapse" : "Expand"} ${item.label} menu`} aria-expanded={expanded}
            className="grid min-h-[44px] w-10 shrink-0 place-items-center rounded-r-[10px] text-sidebar-foreground/50 transition-colors hover:bg-white/10 hover:text-white">
            <ChevronDown size={13} aria-hidden="true" className={cn("transition-transform duration-200", expanded && "rotate-180")} />
          </button>
        </div>

        {expanded && (
          <div className="mb-1 mt-1 space-y-0.5 pl-[42px]">
            {item.children.map(child => {
              const active = isActive(loc, child.href);
              const label = labelOverrides[child.href] ?? child.label;
              return (
                <Link key={child.href} href={child.href}>
                  <div aria-current={active ? "page" : undefined}
                    className={cn("flex min-h-8 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                      active ? "bg-sidebar-primary text-white" : "text-sidebar-foreground/55 hover:bg-white/8 hover:text-white")}>
                    <span className={cn("text-[8px]", active ? "text-white" : "text-sidebar-foreground/30")}>â—</span>
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

  return (
    <div>
      <button type="button" onClick={onToggle}
        className={cn("group flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 text-[14px] font-semibold transition-all duration-150",
          groupActive ? "bg-white/10 text-white" : "text-white/76 hover:bg-white/8 hover:text-white")}>
        <item.Icon size={18} aria-hidden="true" />
        <span className="flex-1 truncate text-left">{item.label}</span>
        <ChevronDown size={13} aria-hidden="true"
          className={cn("shrink-0 text-sidebar-foreground/35 transition-transform duration-200", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="mb-1 mt-1 space-y-0.5 pl-[42px]">
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
        {isLocalhost ? "Backend URL points to localhost. Make sure the backend server is running on this machine. " : "Cloud backup is paused because the backend is not reachable. Local billing still works. "}
        <Link href="/sync-status" className="font-semibold underline underline-offset-2">Open Sync Status -&gt;</Link>
      </span>
    </div>
  );
}
