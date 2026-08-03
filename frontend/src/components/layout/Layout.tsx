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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/useAuth";
import { useOfflineStatus } from "@/features/sync/useOfflineStatus";
import {
  Activity,
  BarChart3,
  Bell,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  Landmark,
  Gift,
  LogOut,
  Menu,
  Package,
  PercentSquare,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Shirt,
  ShoppingCart,
  Store,
  TrendingUp,
  Truck,
  Undo2,
  Users,
  Wallet,
  WifiOff,
} from "lucide-react";
import { PlanBadge } from "@/features/subscription/components/PlanBadge";
import { SubscriptionStatusBanner } from "@/features/subscription/components/SubscriptionStatusBanner";
import { useSubscriptionSnapshot } from "@/features/subscription/access";
import { useBusinessType } from "@/features/settings/business-types";
import { useBusinessTypeServerSync } from "@/features/settings/business-type-sync";
import { useModuleVisibility } from "@/features/settings/modules";
import { useModuleVisibilityServerSync } from "@/features/settings/module-visibility-sync";
import { VoiceAssistant } from "@/features/voice/VoiceAssistant";
import { ReportIssueButton } from "@/features/support";
import { DemoModeBanner } from "@/features/demo/DemoModeBanner";
import { SyncAlertBanner } from "@/features/sync/SyncAlertBanner";
import { CommandPalette } from "./CommandPalette";
import { MobileBottomNav, MobileTopBar } from "./MobileAppChrome";
import { apiRequest, getApiBaseUrl } from "@/lib/api/http";
import { getActiveLocationId, LOCATION_CHANGED_EVENT, setActiveLocationId as persistActiveLocationId } from "@/features/stores/location-context";
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
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 232;
const MAX_WIDTH = 320;
const COLLAPSED_WIDTH = 76;

// ── page title map ────────────────────────────────────────────────────────────

const PAGE_SUBTITLES: Record<string, string> = {
  "/billing": "Fast billing, clear totals, confident collections",
  "/dashboard": "Today’s sales, cash, stock, and shop health",
  "/bills": "View, search, filter, and manage all bills and invoices",
  "/orders-received": "Review customer QR orders and load them into billing",
  "/products": "Manage your product catalog, pricing and stock",
  "/inventory": "Manage stock, movements, and purchase flow",
  "/purchase-bills": "Manage purchase bills, suppliers, and purchase dues",
  "/customers": "Manage customer credit, record payments, and track full udhar ledger",
  "/reports": "Track performance, trends, and data-driven decisions",
  "/activity-insights": "How this shop uses Artha, and what your activity suggests",
  "/money-statement": "Trace every cash, UPI, bank, and credit movement",
  "/daily-closing": "Cash drawer and daily business summary",
  "/settings": "Manage your store, preferences, and system configurations",
  "/sync-status": "Monitor cloud backup and local-first safety",
};

const PAGE_TITLES: Record<string, string> = {
  "/bills": "Billing History",
  "/inventory/batches": "Batch & Expiry",
  "/loyalty": "Customer Loyalty",
  "/purchase-bills": "Purchases",
  "/returns/new": "Return Items",
  "/customers": "Customers / Udhar",
  "/reports": "Reports & Analytics",
  "/activity-insights": "Activity & Insights",
  "/money-statement": "Cash & Payments",
  "/assurance": "Financial Assurance",
  "/assurance/findings": "Assurance Findings",
  "/assurance/report": "Financial Assurance Report",
  "/offers": "Offers & Discounts",
  "/sync-status": "Cloud Backup",
};

function getPageTitle(loc: string): string {
  if (PAGE_TITLES[loc]) return PAGE_TITLES[loc];
  const parent = Object.keys(PAGE_TITLES).find((path) => loc.startsWith(`${path}/`));
  if (parent) return PAGE_TITLES[parent];
  const segment = cleanPath(loc).split("/").filter(Boolean).at(-1);
  return segment
    ? segment.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Artha";
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
type StoreLocationOption = { id: string; code: string; name: string; city?: string | null; isPrimary: boolean; active: boolean };
type StoreLocationsResponse = { locations: StoreLocationOption[] };

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
      { href: "/inventory/stock-counts", label: "Stock Counts" },
      { href: "/inventory/batches", label: "Batch & Expiry" },
    ],
  },
  { kind: "link", href: "/customers", label: "Customers / Udhar", Icon: Users },
  { kind: "link", href: "/purchase-bills", label: "Purchases", Icon: Truck },
  {
    kind: "group", id: "sales", label: "Sales", Icon: TrendingUp,
    triggerPaths: ["/bills", "/orders-received", "/sales-overview"],
    children: [
      { href: "/bills", label: "Billing History" },
      { href: "/orders-received", label: "Orders Received" },
      { href: "/sales-overview", label: "Sales Overview" },
    ],
  },
  { kind: "link", href: "/returns", label: "Returns", Icon: Undo2 },
  { kind: "link", href: "/rentals", label: "Rentals", Icon: Shirt },
  { kind: "link", href: "/reports", label: "Reports", Icon: BarChart3 },
  { kind: "link", href: "/activity-insights", label: "Activity & Insights", Icon: Activity },
  { kind: "link", href: "/money-statement", label: "Cash & Payments", Icon: Landmark },
  {
    kind: "group", id: "assurance", label: "Financial Assurance", Icon: ShieldCheck, overviewHref: "/assurance",
    triggerPaths: ["/assurance"],
    children: [
      { href: "/assurance", label: "Dashboard" },
      { href: "/assurance/findings", label: "Findings" },
      { href: "/assurance/review-queue", label: "Review Queue" },
      { href: "/assurance/evidence", label: "Evidence Requests" },
      { href: "/assurance/cases", label: "Investigation Cases" },
      { href: "/assurance/runs", label: "Audit Runs" },
      { href: "/assurance/rules", label: "Rules & Thresholds" },
      { href: "/assurance/report", label: "Assurance Report" },
    ],
  },
  { kind: "link", href: "/expenses", label: "Expenses", Icon: Wallet },
  { kind: "link", href: "/offers", label: "Offers & Discounts", Icon: PercentSquare },
  { kind: "link", href: "/loyalty", label: "Loyalty", Icon: Gift },
  { kind: "link", href: "/gift-cards", label: "Gift Cards", Icon: Gift },
  { kind: "link", href: "/settings", label: "Settings", Icon: Settings },
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
function cleanPath(path: string) {
  return path.split(/[?#]/)[0] || "/";
}
function isActive(loc: string, href: string) {
  const current = cleanPath(loc);
  const target = cleanPath(href);
  return current === target || (target !== "/dashboard" && current.startsWith(target + "/"));
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
  useBusinessTypeServerSync();
  const { isEnabled: isModuleOn, isHrefEnabled } = useModuleVisibility();
  useModuleVisibilityServerSync();
  const queryClient = useQueryClient();
  const locationsQuery = useQuery({
    queryKey: ["store-locations", "active-context"],
    queryFn: () => apiRequest<StoreLocationsResponse>("/stores"),
    staleTime: 60_000,
  });
  const locations = (locationsQuery.data?.locations ?? []).filter((row) => row.active);
  const [activeLocationId, setActiveLocationId] = useState(() => getActiveLocationId());

  useEffect(() => {
    const syncLocation = (event: Event) => setActiveLocationId((event as CustomEvent<{ locationId?: string }>).detail?.locationId ?? getActiveLocationId());
    window.addEventListener(LOCATION_CHANGED_EVENT, syncLocation);
    return () => window.removeEventListener(LOCATION_CHANGED_EVENT, syncLocation);
  }, []);

  useEffect(() => {
    if (!locations.length) return;
    if (activeLocationId && locations.some((row) => row.id === activeLocationId)) return;
    const fallback = locations.find((row) => row.isPrimary) ?? locations[0];
    persistActiveLocationId(fallback.id);
    setActiveLocationId(fallback.id);
  }, [activeLocationId, locations]);

  const activeStoreLocation = locations.find((row) => row.id === activeLocationId) ?? locations.find((row) => row.isPrimary) ?? locations[0];
  const switchLocation = (locationId: string) => {
    if (locationId === activeLocationId) return;
    persistActiveLocationId(locationId);
    setActiveLocationId(locationId);
    void queryClient.invalidateQueries();
  };

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
  const mobileConnectionTone = hasSyncProblems
    ? "attention" as const
    : isSyncing || hasPendingSync
      ? "busy" as const
      : isOnline
        ? "good" as const
        : "offline" as const;
  const pageHasOwnTopbarActions = loc === "/reports" || loc === "/sales-overview";

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

  // Modules the owner switched off in Settings drop out of the sidebar entirely.
  // A group survives on its remaining children, so hiding "Stock & inventory"
  // still leaves Products and Categories reachable under the same heading.
  const nav = useMemo(() => {
    const items: NavItem[] = [];
    for (const item of NAV) {
      if (item.kind === "link") {
        if (isHrefEnabled(item.href)) items.push(item);
        continue;
      }
      const children = item.children.filter((child) => isHrefEnabled(child.href));
      if (children.length === 0) continue;
      items.push({
        ...item,
        children,
        triggerPaths: item.triggerPaths.filter((path) => isHrefEnabled(path)),
        overviewHref: item.overviewHref && isHrefEnabled(item.overviewHref) ? item.overviewHref : undefined,
      });
    }
    return items;
  }, [isHrefEnabled]);

  // auto-expand groups when child route is active
  useEffect(() => {
    nav.forEach(item => {
      if (item.kind !== "group") return;
      const hit = item.triggerPaths.some(p => isActive(loc, p)) || item.children.some(c => isActive(loc, c.href));
      if (hit) setExpandedGroups(prev => { const n = new Set(prev); n.add(item.id); return n; });
    });
  }, [loc, nav]);

  useEffect(() => {
    if (loc !== "/customers") return;
    setExpandedGroups((current) => current.size > 0 ? new Set<string>() : current);
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
  const storeLocation = activeStoreLocation
    ? `${activeStoreLocation.name}${activeStoreLocation.city ? ` · ${activeStoreLocation.city}` : ""}`
    : [shop?.city, shop?.address].filter(Boolean)[0] ?? user?.email ?? "Owner";
  const mobileStoreLocation = activeStoreLocation
    ? `${activeStoreLocation.code || activeStoreLocation.name}${activeStoreLocation.city ? ` · ${activeStoreLocation.city}` : ""}`
    : storeLocation;

  // apply business-type nav label overrides
  const labelOverrides: Record<string, string> = {
    "/billing": btDef.navConfig.billing,
    "/products": btDef.navConfig.products,
    "/inventory": btDef.navConfig.inventory,
    "/customers": btDef.navConfig.udhar,
  };

  return (
    <div ref={shellRef} className="app-shell app-shell-root" style={shellStyle} data-sidebar-resizing={isResizing ? "true" : undefined}>
      <a href="#main-content" className="app-skip-link">Skip to main content</a>

      {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "app-desktop-sidebar",
          isResizing ? "transition-none" : "app-sidebar-transition"
        )}
        style={{
          width: "var(--app-sidebar-width)",
          background:
            "radial-gradient(circle at 20% 0%, color-mix(in srgb, var(--brand) 24%, transparent), transparent 18rem), linear-gradient(180deg, color-mix(in srgb, hsl(var(--sidebar)) 82%, var(--brand)) 0%, hsl(var(--sidebar)) 62%, color-mix(in srgb, hsl(var(--sidebar)) 88%, black) 100%)",
        }}
      >
        {/* resize handle */}
        <button type="button" aria-label="Resize sidebar" disabled={collapsed} onPointerDown={handleResize}
          className={cn("app-sidebar-resizer", collapsed ? "is-disabled" : "is-ready")}>
          <span className="mx-auto block h-full w-1 rounded-full bg-sidebar-primary/35" />
        </button>

        {/* Logo */}
        <div className={cn("flex items-center border-b border-white/10", collapsed ? "flex-col gap-3 p-3" : "gap-3 px-4 py-5")}>
          <Link href="/dashboard" className="app-sidebar-brand">
            <div className="app-sidebar-brand-mark">
              <ShoppingCart size={20} aria-hidden="true" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-display text-[28px] font-black leading-none tracking-tight text-white">
                  Ar<span className="text-[var(--brand)]">tha</span>
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
          {nav.map(item =>
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
              <div className="app-sidebar-sync-card">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", connectionDotClass, !isOnline && "animate-pulse")} />
                  <span className="text-sm font-semibold text-white">
                    {connectionLabel}
                  </span>
                  {attentionCount > 0 && <span className="ml-auto text-[11px] font-bold text-amber-300">{attentionCount}</span>}
                </div>
                <p className="mt-1 text-[11px] text-sidebar-foreground/50">{connectionDetail}</p>
                <Link href="/sync-status" className="app-sidebar-sync-link">
                  <RefreshCw size={13} aria-hidden="true" /> Sync Now
                </Link>
              </div>

              {/* Store + logout */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="app-sidebar-account">
                    <div className="app-sidebar-avatar">
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
                  {locations.length > 1 && <>
                    <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground">Working location</div>
                    {locations.map((location) => (
                      <DropdownMenuItem key={location.id} onClick={() => switchLocation(location.id)} className={cn(location.id === activeStoreLocation?.id && "bg-primary/8 text-primary")}>
                        <Store size={14} className="mr-2" />
                        <span className="min-w-0 flex-1 truncate">{location.name}</span>
                        {location.id === activeStoreLocation?.id && <span className="ml-2 text-[10px] font-black">ACTIVE</span>}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>}
                  <DropdownMenuItem asChild><Link href="/settings">Settings</Link></DropdownMenuItem>
                  <DropdownMenuItem asChild><Link href="/sync-status">Sync Status</Link></DropdownMenuItem>
                  {isModuleOn("ask_artha") && <DropdownMenuItem asChild><Link href="/help">Ask Artha</Link></DropdownMenuItem>}
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
          "app-main-column",
          isResizing ? "transition-none" : "app-main-column-transition"
        )}
      >
        {/* Desktop topbar */}
        <header className="app-desktop-topbar">
          <button
            type="button"
            aria-label="Toggle sidebar"
            onClick={() => setCollapsed((c) => !c)}
            className="app-topbar-icon-button"
          >
            <Menu size={19} aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="app-topbar-title">{getPageTitle(loc)}</h1>
            {getPageSubtitle(loc) && (
              <p className="app-topbar-subtitle">{getPageSubtitle(loc)}</p>
            )}
          </div>

          {activeStoreLocation && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="app-topbar-location">
                <Store size={16} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-black text-[var(--brand-ink)]">{activeStoreLocation.name}</span>
                  <span className="block truncate text-[9px] font-bold uppercase tracking-wide text-[#64748b]">{activeStoreLocation.code}{activeStoreLocation.isPrimary ? " · Primary" : " · Branch"}</span>
                </span>
                <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground">All operations use this location</div>
              {locations.map((location) => (
                <DropdownMenuItem key={location.id} onClick={() => switchLocation(location.id)} className={cn(location.id === activeStoreLocation.id && "bg-primary/8 text-primary")}>
                  <Store size={14} className="mr-2" />
                  <span className="min-w-0 flex-1 truncate">{location.name}</span>
                  <span className="ml-2 text-[10px] font-bold text-muted-foreground">{location.code}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link href="/inventory/stock-transfers">Manage locations & transfers</Link></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}

          {!pageHasOwnTopbarActions && !loc.startsWith("/returns") && loc !== "/customers" && <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search products, bills, and customers"
            className="app-topbar-search"
          >
            <Search size={17} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">Search products, bills, customers...</span>
            <span className="app-topbar-shortcut">Ctrl K</span>
          </button>}

          {!pageHasOwnTopbarActions && !loc.startsWith("/returns") && loc !== "/customers" && <div className={cn("app-topbar-connection", connectionBadgeClass)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", connectionDotClass)} />
            <span className="truncate">{connectionLabel}</span>
            {isOnline && !isSyncing && !hasPendingSync && !hasSyncProblems && <span className="opacity-60">Just now</span>}
          </div>}

          {!pageHasOwnTopbarActions && !loc.startsWith("/returns") && loc !== "/customers" && snapshot && <PlanBadge planCode={snapshot.planCode} status={snapshot.status} />}

          <Link href="/sync-status">
            <div aria-label="Open sync alerts"
              className="app-topbar-icon-button app-topbar-alerts">
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
              <button className="app-topbar-account">
                <div className="hidden min-w-0 max-w-[150px] text-right 2xl:block">
                  <div className="truncate text-[13px] font-extrabold leading-tight text-[var(--brand-ink)]">{storeName}</div>
                  <div className="truncate text-[11px] leading-tight text-[#64748b]">{storeLocation}</div>
                </div>
                <div className="app-topbar-avatar">
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

        <MobileTopBar
          pageTitle={getPageTitle(loc)}
          storeName={storeName}
          storeLocation={mobileStoreLocation}
          connectionLabel={connectionLabel}
          connectionTone={mobileConnectionTone}
          attentionCount={attentionCount}
          onOpenSearch={() => setPaletteOpen(true)}
        />

        <SubscriptionStatusBanner />
        {backendStatus.browserOnline && !backendStatus.backendReachable && backendStatus.checkedAt && (
          <BackendUnreachableBanner apiBaseUrl={getApiBaseUrl()} />
        )}

        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "app-main-scroll app-scrollbar min-w-0 flex-1 overflow-auto overscroll-contain pb-[var(--app-mobile-content-bottom-clearance)] lg:pb-0",
            pageHasOwnTopbarActions ? "bg-[#ffffff]" : "bg-white",
          )}
        >
          <SyncAlertBanner />
          <DemoModeBanner />
          {children}
        </main>

        <MobileBottomNav
          location={loc}
          storeName={storeName}
          storeLocation={mobileStoreLocation}
          connectionLabel={connectionLabel}
          connectionDetail={connectionDetail}
          connectionTone={mobileConnectionTone}
          locations={locations}
          activeLocationId={activeStoreLocation?.id}
          onSwitchLocation={switchLocation}
          onOpenSearch={() => setPaletteOpen(true)}
          onLogout={logout}
        />
      </div>
      <div className="hidden lg:contents">
        {isModuleOn("voice_assistant") && cleanPath(loc) !== "/billing" && <VoiceAssistant />}
        {isModuleOn("report_issue") && <ReportIssueButton />}
      </div>
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
            ? "bg-[var(--brand)] text-white shadow-[0_10px_22px_var(--brand-shadow)]"
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
              <span className="rounded-[6px] bg-[var(--brand)] px-1.5 py-0.5 text-[10px] font-black text-white shadow-sm">
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
            groupActive ? "bg-[var(--brand)] text-white shadow-[0_10px_22px_var(--brand-shadow)]" : "text-white/76 hover:bg-white/8 hover:text-white")}>
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
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-white" : "bg-sidebar-foreground/30")} />
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
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-white" : "bg-sidebar-foreground/30")} />
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
