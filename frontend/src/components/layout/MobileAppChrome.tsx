import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Activity,
  BadgeIndianRupee,
  BarChart3,
  Bell,
  Boxes,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  HandCoins,
  Home,
  Landmark,
  LogOut,
  Package,
  ReceiptIndianRupee,
  Search,
  Settings,
  ShieldCheck,
  Shirt,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  Users,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppLanguage, type TranslationKey } from "@/features/core/settings/i18n";
import { useModuleVisibility } from "@/features/core/settings/modules";
import { useActiveVerticalPack } from "@/features/verticals/registry";
import { isPathAllowedByCapabilities, isPathInBusinessProfile, useShopBusinessProfile } from "@/features/core/settings/business-profile-bootstrap";
import { preloadCoreRoute } from "@/app/route-preload";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

export interface MobileStoreLocation {
  id: string;
  name: string;
  code?: string | null;
  city?: string | null;
  isPrimary?: boolean;
}

interface MobileTopBarProps {
  pageTitle: string;
  storeName: string;
  storeLocation: string;
  connectionLabel: string;
  connectionTone: "good" | "busy" | "attention" | "offline";
  attentionCount: number;
  onOpenSearch: () => void;
  /**
   * Whether the shop actually has somewhere else to be. A single-location shop
   * learns nothing from a line naming the one counter it owns, so the bar drops
   * it and gives the row back to the page title.
   */
  showLocation?: boolean;
}

interface MobileBottomNavProps {
  location: string;
  storeName: string;
  storeLocation: string;
  connectionLabel: string;
  connectionDetail: string;
  connectionTone: MobileTopBarProps["connectionTone"];
  locations: MobileStoreLocation[];
  activeLocationId?: string;
  onSwitchLocation: (locationId: string) => void;
  onOpenSearch: () => void;
  onLogout: () => void;
  userRole?: string;
}

type NavIcon = LucideIcon;

interface NavigationItem {
  href: string;
  label: string;
  helper: string;
  Icon: NavIcon;
  /**
   * A section that owns several screens. The row becomes a disclosure instead
   * of a link, so the drawer stays a short index of sections while everything
   * underneath is still one tap away — the phone's answer to the sidebar's
   * expandable groups, which used to be the only way in for these pages.
   * A section with an overview page of its own lists it as the first child.
   */
  children?: Array<{ href: string; label: string }>;
}

/**
 * Sections of the phone's "More" drawer.
 *
 * A pack joins one of these by NAME (`mobile.group`), so a name that is not here
 * silently drops the entry — indistinguishable from a pack that meant to stay
 * desktop-only. Exported so `vertical-navigation-fit.test.ts` can check every
 * pack lands somewhere.
 */
export const MORE_GROUPS: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "Sell",
    items: [
      // Named as the page names itself, so someone hunting for "billing
      // history" finds it here rather than concluding the phone hasn't got it.
      { href: "/bills", label: "Billing history", helper: "Find, share, return", Icon: FileText },
      { href: "/orders-received", label: "Customer orders", helper: "Review QR orders", Icon: ClipboardList },
      { href: "/returns", label: "Returns", helper: "Refund or exchange", Icon: ReceiptIndianRupee },
      { href: "/sales-overview", label: "Sales overview", helper: "Sales and collections", Icon: BarChart3 },
    ],
  },
  {
    label: "Stock & buying",
    items: [
      { href: "/products", label: "Products", helper: "Catalog and prices", Icon: Package },
      { href: "/categories", label: "Categories", helper: "Organize products", Icon: Package },
      {
        href: "/inventory",
        label: "Stock movements",
        helper: "Stock in, out, counts, batches",
        Icon: Boxes,
        children: [
          { href: "/inventory/stock-in", label: "Stock in" },
          { href: "/inventory/stock-out", label: "Stock out" },
          { href: "/inventory/adjustments", label: "Adjustments" },
          { href: "/inventory/stock-transfers", label: "Stock transfers" },
          { href: "/inventory/stock-counts", label: "Stock counts" },
          { href: "/inventory/batches", label: "Batch & expiry" },
        ],
      },
      { href: "/purchase-bills", label: "Purchases", helper: "Receive supplier stock", Icon: Truck },
      { href: "/suppliers", label: "Suppliers", helper: "Dues and payments", Icon: Truck },
    ],
  },
  {
    label: "Money & growth",
    items: [
      { href: "/expenses", label: "Expenses", helper: "Track shop spending", Icon: ReceiptIndianRupee },
      { href: "/money-statement", label: "Money statement", helper: "Cash, bank and UPI", Icon: Landmark },
      { href: "/reports", label: "Reports", helper: "Profit and performance", Icon: BarChart3 },
      { href: "/daily-closing", label: "Daily closing", helper: "Close and verify today", Icon: ShieldCheck },
      { href: "/offers", label: "Offers", helper: "Discount rules", Icon: BarChart3 },
      { href: "/loyalty", label: "Loyalty", helper: "Points and members", Icon: HandCoins },
      { href: "/gift-cards", label: "Gift cards", helper: "Issue and redeem", Icon: HandCoins },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/staff", label: "Staff", helper: "Access and permissions", Icon: Users },
      {
        href: "/assurance",
        label: "Financial assurance",
        helper: "Findings, evidence, audit runs",
        Icon: ShieldCheck,
        children: [
          { href: "/assurance", label: "Dashboard" },
          { href: "/assurance/findings", label: "Findings" },
          { href: "/assurance/review-queue", label: "Review queue" },
          { href: "/assurance/evidence", label: "Evidence requests" },
          { href: "/assurance/cases", label: "Investigation cases" },
          { href: "/assurance/runs", label: "Audit runs" },
          { href: "/assurance/rules", label: "Rules & thresholds" },
          { href: "/assurance/report", label: "Assurance report" },
        ],
      },
      { href: "/activity-insights", label: "Activity & insights", helper: "How this shop uses Artha", Icon: Activity },
      { href: "/audit-logs", label: "Audit trail", helper: "Review important actions", Icon: ShieldCheck },
      { href: "/sync-status", label: "Backup & sync", helper: "Offline queue and health", Icon: WifiOff },
      { href: "/help", label: "Ask Artha", helper: "Answers from your own data", Icon: Sparkles },
      { href: "/settings", label: "Settings", helper: "Store and app setup", Icon: Settings },
    ],
  },
];

// These five words are the most-seen text in the product — they sit under the
// thumb on every screen — so they carry a key rather than a baked English label.
const TOP_LEVEL_TABS: Array<{ href: string; labelKey: TranslationKey; Icon: NavIcon; matches: string[] }> = [
  { href: "/dashboard", labelKey: "chrome.tab.home", Icon: Home, matches: ["/dashboard"] },
  { href: "/billing", labelKey: "chrome.tab.sell", Icon: ShoppingCart, matches: ["/billing"] },
  { href: "/inventory", labelKey: "chrome.tab.stock", Icon: Boxes, matches: ["/inventory", "/products", "/categories"] },
  { href: "/customers", labelKey: "chrome.tab.customers", Icon: Users, matches: ["/customers"] },
];

function cleanPath(value: string) {
  return value.split(/[?#]/)[0].replace(/\/$/, "") || "/";
}

function pathMatches(location: string, roots: string[]) {
  const current = cleanPath(location);
  return roots.some((root) => current === root || current.startsWith(`${root}/`));
}

function toneClass(tone: MobileTopBarProps["connectionTone"]) {
  if (tone === "good") return "mobile-connection-good";
  if (tone === "busy") return "mobile-connection-busy";
  if (tone === "attention") return "mobile-connection-attention";
  return "mobile-connection-offline";
}

export function MobileTopBar({
  pageTitle,
  storeName,
  storeLocation,
  connectionLabel,
  connectionTone,
  attentionCount,
  onOpenSearch,
  showLocation = false,
}: MobileTopBarProps) {
  return (
    <header data-app-mobile-topbar="true" className="mobile-app-topbar lg:hidden">
      <div className="mobile-app-topbar-row">
        <Link href="/dashboard" className="mobile-brand-mark" aria-label="Artha home">
          <BadgeIndianRupee size={22} strokeWidth={2.25} aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          {/* The title used to share its row with a shop-name line that clipped at
              both ends — "Mobile UX Audit … · MAIN · Jai…" told a shopkeeper
              neither which shop nor which city. The name is now the drawer's job,
              where it has room; here the page keeps the line it needs to be read
              at a glance, and the location appears only when there is a choice
              of them to be wrong about. */}
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="mobile-app-page-title">{pageTitle}</h1>
            <span className={cn("mobile-connection-dot", toneClass(connectionTone))} aria-hidden="true" />
          </div>
          {showLocation ? (
            <p className="mobile-app-store-line">
              <Store size={11} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{storeLocation}</span>
              <span className="sr-only">{connectionLabel}</span>
            </p>
          ) : (
            <span className="sr-only">{storeName} · {connectionLabel}</span>
          )}
        </div>
        <button type="button" onClick={onOpenSearch} className="mobile-topbar-action" aria-label="Search products, bills, and customers">
          <Search size={21} strokeWidth={2.1} aria-hidden="true" />
        </button>
        <Link href="/sync-status" className="mobile-topbar-action relative" aria-label="Open backup and sync status">
          <Bell size={21} strokeWidth={2.1} aria-hidden="true" />
          {attentionCount > 0 ? <span className="mobile-notification-count">{Math.min(attentionCount, 99)}</span> : null}
        </Link>
      </div>
    </header>
  );
}

/**
 * Which child a route is currently on, longest href first so a detail page like
 * /assurance/findings/42 lights up "Findings" rather than the section overview
 * it also sits under. Null when the section holds nothing for this route.
 */
function activeChildHref(location: string, children: Array<{ href: string }>) {
  return children.reduce<string | null>(
    (best, child) =>
      pathMatches(location, [child.href]) && (!best || child.href.length > best.length) ? child.href : best,
    null,
  );
}

function MoreSection({ item, location }: { item: NavigationItem & { children: NonNullable<NavigationItem["children"]> }; location: string }) {
  const { label, helper, Icon, children } = item;
  const openChild = activeChildHref(location, children);
  // Null until the row is touched, so the section follows the route on open and
  // obeys the owner from then on — no effect needed to keep the two in step.
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? openChild !== null;

  return (
    <div className="mobile-more-section">
      <button
        type="button"
        onClick={() => setOverride(!expanded)}
        className={cn("mobile-more-item w-full text-left", openChild && "mobile-more-item-active")}
        aria-expanded={expanded}
      >
        <span className="mobile-more-icon"><Icon size={20} strokeWidth={2} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="mobile-more-label">{label}</span>
          <span className="mobile-more-helper">{helper}</span>
        </span>
        <ChevronDown size={17} className={cn("mobile-more-chevron", expanded && "mobile-more-chevron-open")} aria-hidden="true" />
      </button>
      {expanded ? (
        <div className="mobile-more-subitems">
          {children.map((child) => (
            <DrawerClose key={child.href} asChild>
              <Link
                href={child.href}
                className={cn("mobile-more-subitem", child.href === openChild && "mobile-more-subitem-active")}
                aria-current={child.href === openChild ? "page" : undefined}
              >
                <span className="mobile-more-subdot" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{child.label}</span>
              </Link>
            </DrawerClose>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const CASHIER_MORE_PATHS = new Set(["/bills", "/products", "/inventory", "/sync-status"]);

function MoreNavigation({ location, userRole }: { location: string; userRole?: string }) {
  const { isHrefEnabled } = useModuleVisibility();
  const verticalPack = useActiveVerticalPack();
  const businessProfile = useShopBusinessProfile();
  // The trade's own drawer rows carry dictionary keys, so this section needs the
  // translator too — not just the tab bar below.
  const { t } = useAppLanguage();
  // Modules switched off in Settings leave the drawer; a section with nothing
  // left in it drops its heading too rather than sitting there empty. The active
  // trade's own entries join their named group — another trade's never do.
  const groups = useMemo(() => {
    const navigation = businessProfile.data?.navigation;
    const reachable = (path: string) => isHrefEnabled(path) && isPathInBusinessProfile(path, navigation, businessProfile.data?.shop.businessType);
    const extras = verticalPack.nav.filter((entry) => entry.mobile && isHrefEnabled(entry.href));
    const visibleGroups = userRole === "staff"
      ? MORE_GROUPS.map((group) => ({
          ...group,
          items: group.items
            .filter((item) => CASHIER_MORE_PATHS.has(item.href))
            .map((item) => item.children ? { ...item, children: undefined } : item),
        }))
      : MORE_GROUPS;
    return visibleGroups
      .map((group) => ({
        ...group,
        items: ([
          ...group.items,
          ...extras
            .filter((entry) => entry.mobile?.group === group.label)
            .map((entry) => ({ href: entry.href, label: t(entry.label), helper: t(entry.mobile!.helper), Icon: entry.Icon })),
        ] as NavigationItem[])
          // A section is judged by its screens, not its own href: it survives on
          // whichever children are still switched on, and goes when none are.
          .flatMap<NavigationItem>((item) => {
            if (!item.children) return reachable(item.href) ? [item] : [];
            const children = item.children.filter((child) => reachable(child.href));
            return children.length > 0 ? [{ ...item, children }] : [];
          }),
      }))
      .filter((group) => group.items.length > 0);
  }, [businessProfile.data?.navigation, businessProfile.data?.shop.businessType, isHrefEnabled, t, userRole, verticalPack]);

  return (
    <div className="mobile-more-groups">
      {groups.map((group) => (
        <section key={group.label} aria-labelledby={`mobile-more-${group.label.replace(/\W+/g, "-").toLowerCase()}`}>
          <h3 id={`mobile-more-${group.label.replace(/\W+/g, "-").toLowerCase()}`} className="mobile-more-group-title">{group.label}</h3>
          <div className="mobile-more-grid">
            {group.items.map((item) => {
              if (item.children) return <MoreSection key={item.href} item={{ ...item, children: item.children }} location={location} />;
              const { href, label, helper, Icon } = item;
              const active = pathMatches(location, [href]);
              return (
                <DrawerClose key={href} asChild>
                  <Link href={href} className={cn("mobile-more-item", active && "mobile-more-item-active")} aria-current={active ? "page" : undefined}>
                    <span className="mobile-more-icon"><Icon size={20} strokeWidth={2} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="mobile-more-label">{label}</span>
                      <span className="mobile-more-helper">{helper}</span>
                    </span>
                    <ChevronRight size={17} className="mobile-more-chevron" aria-hidden="true" />
                  </Link>
                </DrawerClose>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function MobileBottomNav({
  location,
  storeName,
  storeLocation,
  connectionLabel,
  connectionDetail,
  connectionTone,
  locations,
  activeLocationId,
  onSwitchLocation,
  onOpenSearch,
  onLogout,
  userRole,
}: MobileBottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { t } = useAppLanguage();
  const { isHrefEnabled } = useModuleVisibility();
  const businessProfile = useShopBusinessProfile();
  const tabs = useMemo(
    () => TOP_LEVEL_TABS.filter((tab) => isHrefEnabled(tab.href))
      .filter((tab) => isPathInBusinessProfile(tab.href, businessProfile.data?.navigation, businessProfile.data?.shop.businessType)),
    [businessProfile.data?.navigation, businessProfile.data?.shop.businessType, isHrefEnabled],
  );

  return (
    <nav data-app-mobile-bottom-nav="true" aria-label="Primary navigation" className="mobile-tabbar mx-3 mb-3 mt-2 shrink-0 lg:hidden">
      {/* The tab count changes with the owner's module choices, so the columns
          are driven from it instead of the stylesheet's default of five. */}
      <div className="mobile-tabbar-grid" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
        {tabs.map(({ href, labelKey, Icon, matches }) => {
          const active = pathMatches(location, matches);
          return (
            <Link
              key={href}
              href={href}
              className={cn("mobile-tab", active && "mobile-tab-active")}
              aria-current={active ? "page" : undefined}
              onMouseEnter={() => void preloadCoreRoute(href)?.catch(() => undefined)}
              onFocus={() => void preloadCoreRoute(href)?.catch(() => undefined)}
              onTouchStart={() => void preloadCoreRoute(href)?.catch(() => undefined)}
            >
              <span className="mobile-tab-icon"><Icon size={21} strokeWidth={active ? 2.35 : 2} aria-hidden="true" /></span>
              <span>{t(labelKey)}</span>
            </Link>
          );
        })}

        <Drawer open={moreOpen} onOpenChange={setMoreOpen} shouldScaleBackground={false}>
          <DrawerTrigger asChild>
            <button type="button" className={cn("mobile-tab", moreOpen && "mobile-tab-active")} aria-label="Open all app areas" aria-expanded={moreOpen}>
              <span className="mobile-tab-icon"><Settings size={21} strokeWidth={moreOpen ? 2.35 : 2} aria-hidden="true" /></span>
              <span>{t("chrome.tab.more")}</span>
            </button>
          </DrawerTrigger>
          <DrawerContent className="mobile-more-drawer">
            <div className="mobile-more-handle" aria-hidden="true" />
            <DrawerHeader className="mobile-more-header">
              <div className="flex min-w-0 items-center gap-3 text-left">
                <span className="mobile-profile-avatar">{storeName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "A"}</span>
                <div className="min-w-0 flex-1">
                  <DrawerTitle className="truncate font-display text-[19px] font-black text-[var(--brand-ink)]">{storeName}</DrawerTitle>
                  <DrawerDescription className="mt-0.5 truncate text-[12px] font-semibold text-[#62708b]">{storeLocation}</DrawerDescription>
                </div>
                <DrawerClose asChild>
                  <button type="button" className="mobile-sheet-close" aria-label="Close app menu"><X size={20} aria-hidden="true" /></button>
                </DrawerClose>
              </div>
              <Link href="/sync-status" onClick={() => setMoreOpen(false)} className={cn("mobile-connection-card", toneClass(connectionTone))}>
                <span className="mobile-connection-card-dot" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-left">
                  <span className="mobile-connection-card-label">{connectionLabel}</span>
                  <span className="mobile-connection-card-detail">{connectionDetail}</span>
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </Link>
              <button type="button" onClick={() => { setMoreOpen(false); onOpenSearch(); }} className="mobile-global-search">
                <Search size={19} aria-hidden="true" />
                <span>Search products, bills, customers…</span>
              </button>
              {locations.length > 1 ? (
                <div className="mobile-location-switcher" role="group" aria-label="Working location">
                  {locations.map((store) => (
                    <button
                      key={store.id}
                      type="button"
                      onClick={() => onSwitchLocation(store.id)}
                      className={cn("mobile-location-pill", store.id === activeLocationId && "mobile-location-pill-active")}
                    >
                      <Store size={14} aria-hidden="true" />
                      <span className="truncate">{store.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </DrawerHeader>
            <div className="mobile-more-scroll">
              <MoreNavigation location={location} userRole={userRole} />
              <button type="button" onClick={onLogout} className="mobile-logout-button"><LogOut size={18} aria-hidden="true" /> Sign out safely</button>
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </nav>
  );
}
