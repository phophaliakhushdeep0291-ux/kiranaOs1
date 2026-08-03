import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  BadgeIndianRupee,
  BarChart3,
  Bell,
  Boxes,
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
import { useModuleVisibility } from "@/features/settings/modules";
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
}

type NavIcon = LucideIcon;

interface NavigationItem {
  href: string;
  label: string;
  helper: string;
  Icon: NavIcon;
}

const MORE_GROUPS: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "Sell",
    items: [
      { href: "/bills", label: "Bills & receipts", helper: "Find, share, return", Icon: FileText },
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
      { href: "/audit-logs", label: "Audit trail", helper: "Review important actions", Icon: ShieldCheck },
      { href: "/sync-status", label: "Backup & sync", helper: "Offline queue and health", Icon: WifiOff },
      { href: "/help", label: "Ask Artha", helper: "Answers from your own data", Icon: Sparkles },
      { href: "/settings", label: "Settings", helper: "Store and app setup", Icon: Settings },
    ],
  },
];

const TOP_LEVEL_TABS: Array<{ href: string; label: string; Icon: NavIcon; matches: string[] }> = [
  { href: "/dashboard", label: "Home", Icon: Home, matches: ["/dashboard"] },
  { href: "/billing", label: "Sell", Icon: ShoppingCart, matches: ["/billing"] },
  { href: "/inventory", label: "Stock", Icon: Boxes, matches: ["/inventory", "/products", "/categories"] },
  { href: "/customers", label: "Customers", Icon: Users, matches: ["/customers"] },
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
}: MobileTopBarProps) {
  return (
    <header data-app-mobile-topbar="true" className="mobile-app-topbar lg:hidden">
      <div className="mobile-app-topbar-row">
        <Link href="/dashboard" className="mobile-brand-mark" aria-label="Artha home">
          <BadgeIndianRupee size={22} strokeWidth={2.25} aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="mobile-app-page-title">{pageTitle}</h1>
            <span className={cn("mobile-connection-dot", toneClass(connectionTone))} aria-hidden="true" />
          </div>
          <p className="mobile-app-store-line">
            <span className="truncate">{storeName}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{storeLocation}</span>
            <span className="sr-only">{connectionLabel}</span>
          </p>
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

function MoreNavigation({ location }: { location: string }) {
  const { isHrefEnabled } = useModuleVisibility();
  // Modules switched off in Settings leave the drawer; a section with nothing
  // left in it drops its heading too rather than sitting there empty.
  const groups = useMemo(
    () => MORE_GROUPS
      .map((group) => ({ ...group, items: group.items.filter((item) => isHrefEnabled(item.href)) }))
      .filter((group) => group.items.length > 0),
    [isHrefEnabled],
  );

  return (
    <div className="mobile-more-groups">
      {groups.map((group) => (
        <section key={group.label} aria-labelledby={`mobile-more-${group.label.replace(/\W+/g, "-").toLowerCase()}`}>
          <h3 id={`mobile-more-${group.label.replace(/\W+/g, "-").toLowerCase()}`} className="mobile-more-group-title">{group.label}</h3>
          <div className="mobile-more-grid">
            {group.items.map(({ href, label, helper, Icon }) => {
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
}: MobileBottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { isHrefEnabled } = useModuleVisibility();
  const tabs = useMemo(() => TOP_LEVEL_TABS.filter((tab) => isHrefEnabled(tab.href)), [isHrefEnabled]);

  return (
    <nav data-app-mobile-bottom-nav="true" aria-label="Primary navigation" className="mobile-tabbar mx-3 mb-3 mt-2 shrink-0 lg:hidden">
      {/* The tab count changes with the owner's module choices, so the columns
          are driven from it instead of the stylesheet's default of five. */}
      <div className="mobile-tabbar-grid" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
        {tabs.map(({ href, label, Icon, matches }) => {
          const active = pathMatches(location, matches);
          return (
            <Link key={href} href={href} className={cn("mobile-tab", active && "mobile-tab-active")} aria-current={active ? "page" : undefined}>
              <span className="mobile-tab-icon"><Icon size={21} strokeWidth={active ? 2.35 : 2} aria-hidden="true" /></span>
              <span>{label}</span>
            </Link>
          );
        })}

        <Drawer open={moreOpen} onOpenChange={setMoreOpen} shouldScaleBackground={false}>
          <DrawerTrigger asChild>
            <button type="button" className={cn("mobile-tab", moreOpen && "mobile-tab-active")} aria-label="Open all app areas" aria-expanded={moreOpen}>
              <span className="mobile-tab-icon"><Settings size={21} strokeWidth={moreOpen ? 2.35 : 2} aria-hidden="true" /></span>
              <span>More</span>
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
              <MoreNavigation location={location} />
              <button type="button" onClick={onLogout} className="mobile-logout-button"><LogOut size={18} aria-hidden="true" /> Sign out safely</button>
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </nav>
  );
}
