import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
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
import { useAuth } from "@/features/core/auth/useAuth";
import { useOfflineStatus } from "@/features/core/sync/useOfflineStatus";
import {
  BarChart3,
  Bell,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  Landmark,
  LogOut,
  Menu,
  Package,
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
import { PlanBadge } from "@/features/core/subscription/components/PlanBadge";
import { SubscriptionStatusBanner } from "@/features/core/subscription/components/SubscriptionStatusBanner";
import { useSubscriptionSnapshot } from "@/features/core/subscription/access";
import { useBusinessType } from "@/features/core/settings/business-types";
import { useBusinessTypeServerSync } from "@/features/core/settings/business-type-sync";
import { isPathAllowedByCapabilities, isPathInBusinessProfile, useShopBusinessProfile } from "@/features/core/settings/business-profile-bootstrap";
import { useModuleVisibility } from "@/features/core/settings/modules";
import { useAppLanguage, type Translate, type TranslationKey } from "@/features/core/settings/i18n";
import { useModuleVisibilityServerSync } from "@/features/core/settings/module-visibility-sync";
import { useActiveVerticalPack, type VerticalNavEntry } from "@/features/verticals/registry";
import { VoiceAssistant } from "@/features/core/voice/VoiceAssistant";
import { AssistantLauncher } from "@/features/core/assistant/AssistantLauncher";
import { ReportIssueButton } from "@/features/core/support";
import { DemoModeBanner } from "@/features/core/demo/DemoModeBanner";
import { SyncAlertBanner } from "@/features/core/sync/SyncAlertBanner";
import { CommandPalette } from "./CommandPalette";
import { MobileBottomNav, MobileTopBar } from "./MobileAppChrome";
import { apiRequest, getApiBaseUrl } from "@/lib/api/http";
import { getActiveLocationId, LOCATION_CHANGED_EVENT, setActiveLocationId as persistActiveLocationId } from "@/features/core/stores/location-context";
import { cn } from "@/lib/utils";
import { preloadCoreRoute, scheduleCoreRoutePreload } from "@/app/route-preload";
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

/**
 * Route to title key. This is the string a shopkeeper reads on every screen to
 * know where they are, so it is translated rather than derived from the URL.
 * Ordered longest-first so "/settings/sync" is not answered by "/settings".
 */
const PAGE_TITLE_KEYS: Record<string, TranslationKey> = {
  "/inventory/stock-transfers": "page.title.inventory.stocktransfers",
  "/inventory/stock-counts": "page.title.inventory.stockcounts",
  "/settings/store-profile": "page.title.settings.storeprofile",
  "/settings/notifications": "page.title.settings.notifications",
  "/inventory/adjustments": "page.title.inventory.adjustments",
  "/settings/integrations": "page.title.settings.integrations",
  "/inventory/stock-out": "page.title.inventory.stockout",
  "/inventory/stock-in": "page.title.inventory.stockin",
  "/assurance/findings": "page.title.assurance.findings",
  "/inventory/batches": "page.title.inventory.batches",
  "/activity-insights": "page.title.activityinsights",
  "/settings/security": "page.title.settings.security",
  "/settings/advanced": "page.title.settings.advanced",
  "/settings/billing": "page.title.settings.billing",
  "/settings/printer": "page.title.settings.printer",
  "/settings/modules": "page.title.settings.modules",
  "/settings/devices": "page.title.settings.devices",
  "/assurance/report": "page.title.assurance.report",
  "/money-statement": "page.title.moneystatement",
  "/orders-received": "page.title.ordersreceived",
  "/purchase-bills": "page.title.purchasebills",
  "/sales-overview": "page.title.salesoverview",
  "/settings/taxes": "page.title.settings.taxes",
  "/settings/staff": "page.title.settings.staff",
  "/settings/setup": "page.title.settings.setup",
  "/daily-closing": "page.title.dailyclosing",
  "/settings/sync": "page.title.settings.sync",
  "/subscription": "page.title.subscription",
  "/returns/new": "page.title.returns.new",
  "/recycle-bin": "page.title.recyclebin",
  "/smart-tools": "page.title.smarttools",
  "/sync-status": "page.title.syncstatus",
  "/categories": "page.title.categories",
  "/gift-cards": "page.title.giftcards",
  "/audit-logs": "page.title.auditlogs",
  "/dashboard": "page.title.dashboard",
  "/inventory": "page.title.inventory",
  "/customers": "page.title.customers",
  "/suppliers": "page.title.suppliers",
  "/assurance": "page.title.assurance",
  "/products": "page.title.products",
  "/expenses": "page.title.expenses",
  "/settings": "page.title.settings",
  "/billing": "page.title.billing",
  "/reports": "page.title.reports",
  "/returns": "page.title.returns",
  "/loyalty": "page.title.loyalty",
  "/devices": "page.title.devices",
  "/offers": "page.title.offers",
  "/bills": "page.title.bills",
  "/staff": "page.title.staff",
  "/plans": "page.title.plans",
  "/help": "page.title.help",
};

function getPageTitle(loc: string, t: Translate): string {
  const path = cleanPath(loc);
  if (PAGE_TITLE_KEYS[path]) return t(PAGE_TITLE_KEYS[path]);
  const parent = Object.keys(PAGE_TITLE_KEYS).find((candidate) => path.startsWith(`${candidate}/`));
  if (parent) return t(PAGE_TITLE_KEYS[parent]);
  // An unlisted screen (platform admin, deep assurance links) still needs a
  // name; title-casing its last segment is the honest fallback.
  const segment = path.split("/").filter(Boolean).at(-1);
  return segment
    ? segment.replace(/-/g, " ").replace(/\w/g, (letter) => letter.toUpperCase())
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

/**
 * The declared sidebar, whose labels are TranslationKeys.
 *
 * `NavItem` above is the RENDERED sidebar: by the time SidebarLink prints
 * `item.label` it must already be words. Only the trade pack's entries were ever
 * put through `t()`, so the core spine's plain English labels ("Purchases",
 * "Returns", "Cash & Payments"…) reached the screen verbatim and a Hindi shop
 * read a sidebar that was 7/11 English. Separating the two types makes the
 * compiler insist that every declared label is a real key, and that every key is
 * translated before it is rendered.
 */
type NavSpecSubItem = { href: string; label: TranslationKey };

interface NavSpecLinkItem extends Omit<LinkItem, "label"> {
  label: TranslationKey;
}

interface NavSpecGroupItem extends Omit<GroupItem, "label" | "children"> {
  label: TranslationKey;
  children: NavSpecSubItem[];
}

type NavSpecItem = NavSpecLinkItem | NavSpecGroupItem;
type StoreLocationOption = { id: string; code: string; name: string; city?: string | null; isPrimary: boolean; active: boolean };
type StoreLocationsResponse = { locations: StoreLocationOption[] };

/**
 * The shared spine every shop gets, before its trade adds anything.
 *
 * Exported so `vertical-navigation-fit.test.ts` can build each of the twelve
 * sidebars as data and check them. A pack anchoring itself to an href that is
 * not here, or naming an entry the core spine already uses, is not visible by
 * reading either file alone — it only shows up when the two are merged.
 */
export const NAV: NavSpecItem[] = [
  { kind: "link", href: "/dashboard", label: "nav.dashboard", Icon: LayoutDashboard },
  { kind: "link", href: "/billing", label: "nav.billing", Icon: ShoppingCart, badge: "F2", emphasis: true },
  {
    kind: "group", id: "inventory", label: "nav.inventory", Icon: Package, overviewHref: "/inventory",
    triggerPaths: ["/products", "/categories", "/inventory"],
    children: [
      { href: "/products", label: "nav.products" },
      { href: "/categories", label: "page.title.categories" },
      { href: "/inventory/stock-in", label: "page.title.inventory.stockin" },
      { href: "/inventory/stock-out", label: "page.title.inventory.stockout" },
      { href: "/inventory/adjustments", label: "page.title.inventory.adjustments" },
      { href: "/inventory/stock-transfers", label: "page.title.inventory.stocktransfers" },
      { href: "/inventory/stock-counts", label: "page.title.inventory.stockcounts" },
      { href: "/inventory/batches", label: "page.title.inventory.batches" },
    ],
  },
  { kind: "link", href: "/customers", label: "page.title.customers", Icon: Users },
  { kind: "link", href: "/purchase-bills", label: "page.title.purchasebills", Icon: Truck },
  {
    kind: "group", id: "sales", label: "nav.sales", Icon: TrendingUp,
    triggerPaths: ["/bills", "/orders-received", "/sales-overview"],
    children: [
      { href: "/bills", label: "page.title.bills" },
      { href: "/orders-received", label: "page.title.ordersreceived" },
      { href: "/sales-overview", label: "page.title.salesoverview" },
    ],
  },
  { kind: "link", href: "/returns", label: "page.title.returns", Icon: Undo2 },
  { kind: "link", href: "/reports", label: "nav.reports", Icon: BarChart3 },
  { kind: "link", href: "/money-statement", label: "page.title.moneystatement", Icon: Landmark },
  {
    kind: "group", id: "business-tools", label: "nav.businessTools", Icon: ShieldCheck,
    triggerPaths: ["/assurance", "/activity-insights", "/offers", "/loyalty", "/gift-cards"],
    children: [
      { href: "/activity-insights", label: "page.title.activityinsights" },
      { href: "/offers", label: "page.title.offers" },
      { href: "/loyalty", label: "nav.loyalty" },
      { href: "/gift-cards", label: "page.title.giftcards" },
      { href: "/assurance", label: "nav.assurance" },
    ],
  },
  { kind: "link", href: "/expenses", label: "page.title.expenses", Icon: Wallet },
  { kind: "link", href: "/settings", label: "nav.settings", Icon: Settings },
];

/**
 * The core spine with one trade's entries merged into it.
 *
 * `insertAfter` promises an entry lands next to a named href. That used to be
 * honoured only for TOP-LEVEL links, and half the anchors in use are not: a
 * group's own href (`/inventory`) and a group's child (`/products`) both looked
 * like typos to the splice and quietly fell through to the tail. Five trades were
 * affected — Testers, Size Runs, Manufacturing, Menu and Kitchen stock all sat
 * above Settings, nowhere near the screens they belong to.
 *
 * An anchor inside a group places the entry directly after that whole group,
 * which keeps the trade's screen a first-class link with its own icon rather
 * than demoting it to a child row.
 *
 * Pure, and exported, so `vertical-navigation-fit.test.ts` can assemble all
 * twelve sidebars without a browser.
 */
export function buildSidebarNav(
  packNav: readonly VerticalNavEntry[],
  pathEnabled: (href: string) => boolean,
  t: Translate,
): NavItem[] {
  const items: NavItem[] = [];
  const pending = new Set(packNav.filter((entry) => pathEnabled(entry.href)));
  const spliceAfter = (hrefs: string[]) => {
    for (const entry of pending) {
      if (!entry.insertAfter || !hrefs.includes(entry.insertAfter)) continue;
      items.push({ kind: "link", href: entry.href, label: t(entry.label), Icon: entry.Icon });
      pending.delete(entry);
    }
  };

  for (const item of NAV) {
    if (item.kind === "link") {
      // Translated HERE, like every pack entry above. The renderer prints
      // `item.label` as-is, so anything not resolved by this point reaches the
      // shopkeeper as its raw key — or, as it used to be, as English.
      if (pathEnabled(item.href)) items.push({ ...item, label: t(item.label) });
      spliceAfter([item.href]);
      continue;
    }
    // `pathEnabled`, not the module switch alone: a child like Batch & Expiry
    // is gated on a capability, and filtering only by nav key would let it
    // back into the group after being kept out of the top level. It already
    // subsumes the module switch, so one pass over the children is enough.
    const profileChildren = item.children.filter((child) => pathEnabled(child.href));
    if (profileChildren.length === 0) continue;
    items.push({
      ...item,
      label: t(item.label),
      children: profileChildren.map((child) => ({ ...child, label: t(child.label) })),
      triggerPaths: item.triggerPaths.filter((path) => pathEnabled(path)),
      overviewHref: item.overviewHref && pathEnabled(item.overviewHref) ? item.overviewHref : undefined,
    });
    // Anchored to the group itself or to anything under it: the entry follows the
    // whole group. Every child is offered, not just the surviving ones, so an
    // anchor still works when the owner has switched that particular child off.
    spliceAfter([...(item.overviewHref ? [item.overviewHref] : []), ...item.children.map((child) => child.href)]);
  }

  // Entries with no `insertAfter`, or whose anchor is switched off, still have
  // to land somewhere — above Settings, so Settings stays the last item.
  if (pending.size > 0) {
    const tail = items.findIndex((item) => item.kind === "link" && item.href === "/settings");
    const extras: NavItem[] = [...pending].map((entry) =>
      ({ kind: "link", href: entry.href, label: t(entry.label), Icon: entry.Icon }));
    items.splice(tail === -1 ? items.length : tail, 0, ...extras);
  }
  return items;
}

// The counter is a task surface, not the owner's ERP index. Staff retain direct
// access to the five things they use during a shift; every owner-only control
// remains available to owners and administrators through the full navigation.
const CASHIER_NAV_PATHS = new Set([
  "/dashboard",
  "/billing",
  "/bills",
  "/customers",
  "/inventory",
  "/products",
]);

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

/**
 * `pageTitle` overrides the title derived from the URL. Only the catch-all route
 * passes it: an unmatched path has no page to name, and titlecasing its last
 * segment would announce "Also Bogus page loaded" for a screen that does not
 * exist. Every real route leaves it unset and stays URL-driven.
 */
export function Layout({ children, pageTitle }: { children: ReactNode; pageTitle?: string }) {
  const { t } = useAppLanguage();
  const { user, logout, shop } = useAuth();
  const [loc] = useLocation();
  // One source of truth for "keep the corners clear". The till is the one screen
  // where a floating button can land on the keypad mid-sale, so every helper
  // hides there rather than each deciding for itself.
  const floatingHelpersAllowed = cleanPath(loc) !== "/billing";
  const resolvedPageTitle = pageTitle ?? getPageTitle(loc, t);
  const { isOnline, backendStatus, pendingCount, failedCount, conflictCount, isSyncing } = useOfflineStatus();
  const { snapshot } = useSubscriptionSnapshot();
  const { def: btDef } = useBusinessType();
  useBusinessTypeServerSync();

  // Publish the height of the banner strip so full-height pages can subtract it.
  // `--app-desktop-topbar-height` is a static 76px that matches the header
  // exactly, but the trial/offline banners sit BELOW the header and were in
  // nobody's arithmetic. At 1280x800 that pushed Billing's workspace 45px past
  // the fold and a sibling block covered the cash / UPI / udhar tender buttons,
  // so a counter operator could not tender a sale by clicking at all. The
  // variable defaults to 0px, so anything that does not subtract it is
  // unaffected.
  const bannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = bannerRef.current;
    if (!node) return;
    const publish = () => document.documentElement.style.setProperty(
      "--app-banner-height",
      `${Math.round(node.getBoundingClientRect().height)}px`,
    );
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.setProperty("--app-banner-height", "0px");
    };
  }, []);
  const businessProfile = useShopBusinessProfile();
  const { isEnabled: isModuleOn, isHrefEnabled } = useModuleVisibility();
  const verticalPack = useActiveVerticalPack();
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
  //
  // The shop's own trade adds its entries on top: only the active pack's nav is
  // read, so another vertical's screens never appear here to begin with.
  const nav = useMemo(() => {
    const profileNavigation = businessProfile.data?.navigation;
    const profileCapabilities = businessProfile.data?.capabilities;
    const pathEnabled = (href: string) =>
      isHrefEnabled(href)
      && isPathInBusinessProfile(href, profileNavigation)
      // Dated-stock tooling belongs to shops that hold the capability, not to
      // every shop that happens to carry the "inventory" nav key.
      && isPathAllowedByCapabilities(href, profileCapabilities);
    const items = buildSidebarNav(verticalPack.nav, pathEnabled, t);
    if (user?.role !== "staff") return items;

    return items.flatMap((item): NavItem[] => {
      if (item.kind === "link") return CASHIER_NAV_PATHS.has(item.href) ? [item] : [];
      const children = item.children.filter((child) => CASHIER_NAV_PATHS.has(child.href));
      if (!children.length && (!item.overviewHref || !CASHIER_NAV_PATHS.has(item.overviewHref))) return [];
      return [{
        ...item,
        children,
        triggerPaths: item.triggerPaths.filter((path) => CASHIER_NAV_PATHS.has(path)),
        overviewHref: item.overviewHref && CASHIER_NAV_PATHS.has(item.overviewHref) ? item.overviewHref : undefined,
      }];
    });
  }, [businessProfile.data?.navigation, isHrefEnabled, user?.role, verticalPack]);

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

  useEffect(() => {
    if (loc !== "/dashboard") return;
    const cancelBilling = scheduleCoreRoutePreload("/billing", 1_500);
    const cancelCustomers = scheduleCoreRoutePreload("/customers", 2_000);
    const cancelUdhar = scheduleCoreRoutePreload("/udhar", 3_000);
    return () => {
      cancelBilling();
      cancelCustomers();
      cancelUdhar();
    };
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

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (collapsed) return;
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = clampW(sidebarWidth - 8);
    if (event.key === "ArrowRight") nextWidth = clampW(sidebarWidth + 8);
    if (event.key === "Home") nextWidth = MIN_WIDTH;
    if (event.key === "End") nextWidth = MAX_WIDTH;
    if (nextWidth === null) return;
    event.preventDefault();
    liveW.current = nextWidth;
    shellRef.current?.style.setProperty("--app-sidebar-width", `${nextWidth}px`);
    setSidebarWidth(nextWidth);
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
    "/billing": t(btDef.navConfig.billing),
    "/products": t(btDef.navConfig.products),
    "/inventory": t(btDef.navConfig.inventory),
    "/customers": t(btDef.navConfig.udhar),
  };

  return (
    <div ref={shellRef} className="app-shell app-shell-root" style={shellStyle} data-sidebar-resizing={isResizing ? "true" : undefined}>
      <a href="#main-content" className="app-skip-link">{t("chrome.skipToContent")}</a>

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
        <button type="button"
          aria-label={`Resize sidebar, ${sidebarWidth} pixels. Use left and right arrow keys.`}
          title="Drag, use arrow keys, or press Home/End to resize the sidebar"
          disabled={collapsed}
          onPointerDown={handleResize}
          onKeyDown={handleResizeKeyDown}
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
                <div className="mt-1 truncate text-[11px] font-medium leading-none text-white/68">{t(btDef.navConfig.tagline)}</div>
              </div>
            )}
          </Link>
          {!collapsed && (
            <button type="button" aria-label="Collapse sidebar" onClick={() => setCollapsed(true)}
              className="tap-target ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/40 hover:bg-white/10 hover:text-white transition-colors">
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
              {(attentionCount > 0 || !isOnline) && <div className="app-sidebar-sync-card">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", connectionDotClass, !isOnline && "animate-pulse")} />
                  <span className="text-sm font-semibold text-white">
                    {connectionLabel}
                  </span>
                  {attentionCount > 0 && <span className="ml-auto text-[11px] font-bold text-amber-300">{attentionCount}</span>}
                </div>
                <p className="mt-1 text-[11px] text-sidebar-foreground/50">{connectionDetail}</p>
                <Link href="/sync-status" className="app-sidebar-sync-link tap-target">
                  <RefreshCw size={13} aria-hidden="true" /> Sync Now
                </Link>
              </div>}

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
          <div className="app-topbar-heading">
            <h1 className="app-topbar-title">{resolvedPageTitle}</h1>
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

          <Link href="/sync-status" aria-label="Open sync alerts" className="app-topbar-icon-button app-topbar-alerts">
            <Bell size={18} aria-hidden="true" />
            {attentionCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">
                {attentionCount}
              </span>
            )}
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
          pageTitle={resolvedPageTitle}
          storeName={storeName}
          storeLocation={mobileStoreLocation}
          connectionLabel={connectionLabel}
          connectionTone={mobileConnectionTone}
          attentionCount={attentionCount}
          onOpenSearch={() => setPaletteOpen(true)}
          showLocation={locations.length > 1}
        />

        <div ref={bannerRef}>
          <SubscriptionStatusBanner />
          {backendStatus.browserOnline && !backendStatus.backendReachable && backendStatus.checkedAt && (
            <BackendUnreachableBanner apiBaseUrl={getApiBaseUrl()} />
          )}
        </div>

        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "app-main-scroll app-scrollbar min-w-0 flex-1 overflow-auto overscroll-contain pb-[var(--app-mobile-content-bottom-clearance)] lg:pb-0",
            pageHasOwnTopbarActions ? "bg-[#ffffff]" : "bg-white",
          )}
        >
          {/* The banner exists to point at this page — "open Sync Status to review", plus a
              View link. On the page itself that is a loop, and on a phone it spends scarce
              vertical space above the very failure the owner opened the page to read. */}
          {cleanPath(loc) !== "/sync-status" && <SyncAlertBanner />}
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
          userRole={user?.role}
        />
      </div>
      <div className="hidden lg:contents">
        {isModuleOn("voice_assistant") && floatingHelpersAllowed && <VoiceAssistant />}
        {isModuleOn("report_issue") && <ReportIssueButton />}
      </div>
      {/* Not inside the desktop-only block: the shopkeeper asking what is running
          out is usually on the floor with a phone, not at the counter. */}
      {isModuleOn("ask_artha") && floatingHelpersAllowed && <AssistantLauncher />}
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
    <Link
      href={item.href}
      onMouseEnter={() => void preloadCoreRoute(item.href)?.catch(() => undefined)}
      onFocus={() => void preloadCoreRoute(item.href)?.catch(() => undefined)}
      onTouchStart={() => void preloadCoreRoute(item.href)?.catch(() => undefined)}
    >
      {/* No `role="menuitem"` here. It requires a menu/menubar/group parent and
          there is none, so it failed axe's aria-required-parent at critical on
          every sidebar entry. It was also wrong on its own terms: this is a
          navigation link, not an application menu — there is no arrow-key
          roving focus — and the role sat on a div INSIDE the anchor, which
          masked the link semantics the <a> already provides. `aria-current`
          carries the active state. */}
      <div
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
  // The trade's own word for this section. `navConfig.inventory` is set for all
  // twelve trades and was read by nobody: the override is keyed on `/inventory`,
  // which exists only as this group's overview href, and the heading rendered the
  // hardcoded label instead. A chemist's sidebar said "Inventory" where the shop
  // had asked for "Stock", and a parts shop never saw "Godown" at all.
  const label = (item.overviewHref && labelOverrides[item.overviewHref]) || item.label;

  if (collapsed) {
    const firstHref = item.overviewHref ?? item.triggerPaths[0] ?? item.children[0]?.href ?? "#";
    return (
      <Link href={firstHref}>
        <div title={label}
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
            <span className="flex-1 truncate text-left text-[14px] font-semibold">{label}</span>
            {overviewActive ? <span className="sr-only">Current page</span> : null}
          </Link>
          <button type="button" onClick={onToggle} aria-label={`${expanded ? "Collapse" : "Expand"} ${label} menu`} aria-expanded={expanded}
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
                    className={cn("flex min-h-11 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors lg:mouse:min-h-8",
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
        <span className="flex-1 truncate text-left">{label}</span>
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
                  className={cn("flex min-h-11 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors lg:mouse:min-h-8",
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
  // A localhost URL is actionable developer information, but it is misleading
  // in an installed production/PWA build: the cashier only needs to know that
  // cloud backup is paused and local billing remains safe.
  const showLocalhostDiagnostic = import.meta.env.DEV
    && (apiBaseUrl.includes("localhost") || apiBaseUrl.includes("127.0.0.1"));
  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
      <WifiOff size={15} className="shrink-0 text-amber-600" aria-hidden="true" />
      <span className="flex-1 leading-tight">
        {showLocalhostDiagnostic ? "Backend URL points to localhost. Make sure the backend server is running on this machine. " : "Cloud backup is paused because the backend is not reachable. Local billing still works. "}
        <Link href="/sync-status" className="font-semibold underline underline-offset-2">Open Sync Status -&gt;</Link>
      </span>
    </div>
  );
}
