import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/core/auth/useAuth";
import { getShopBootstrap, readCachedShopBootstrap } from "./api";
import { getStoredBusinessType, saveBusinessType } from "./business-type-store";
import { useModuleVisibility } from "./modules";

export const SHOP_BOOTSTRAP_QUERY_KEY = ["shop-bootstrap"] as const;

export function useShopBusinessProfile() {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: SHOP_BOOTSTRAP_QUERY_KEY,
    queryFn: getShopBootstrap,
    enabled: isAuthenticated,
    initialData: () => readCachedShopBootstrap(),
    staleTime: 30_000,
  });

  useEffect(() => {
    const businessType = query.data?.shop.businessType;
    if (businessType && businessType !== getStoredBusinessType()) saveBusinessType(businessType);
  }, [query.data?.shop.businessType]);

  return query;
}

/**
 * Route path -> the navigation keys that unlock it. First match wins, so keep the
 * narrower pattern above the broader one (/inventory/batches before /inventory).
 *
 * A key the server sends but nothing lists here is inert, and a path listed here
 * whose keys no profile carries is unreachable — see the shared-spine test in
 * vertical-boundaries.test.ts, which pins the core routes to SHARED_NAVIGATION.
 */
const PATH_NAVIGATION_KEYS: Array<[RegExp, string[]]> = [
  [/^\/dashboard(?:\/|$)/, ["dashboard"]],
  [/^\/billing(?:\/|$)/, ["billing", "pos"]],
  [/^\/products(?:\/|$)|^\/categories(?:\/|$)/, ["products", "menu", "medicines"]],
  // `/inventory/batches` is deliberately absent: it is gated on the CAPABILITY
  // instead, by `isPathAllowedByCapabilities` below. See the note there.
  [/^\/inventory(?:\/|$)/, ["inventory"]],
  [/^\/udhar(?:\/|$)/, ["udhar", "customers"]],
  [/^\/customers(?:\/|$)/, ["customers"]],
  [/^\/suppliers(?:\/|$)/, ["suppliers", "purchases"]],
  [/^\/purchase-bills(?:\/|$)/, ["purchases"]],
  [/^\/bills(?:\/|$)|^\/sales-overview(?:\/|$)|^\/orders-received(?:\/|$)/, ["sales", "orders"]],
  [/^\/returns(?:\/|$)/, ["returns", "exchanges"]],
  [/^\/reports(?:\/|$)/, ["reports"]],
  [/^\/daily-closing(?:\/|$)/, ["daily-closing", "cash-payments"]],
  [/^\/money-statement(?:\/|$)/, ["cash-payments"]],
  [/^\/expenses(?:\/|$)/, ["expenses"]],
  [/^\/rentals(?:\/|$)/, ["rentals"]],
  [/^\/prescriptions(?:\/|$)/, ["prescriptions"]],
  [/^\/serial-units(?:\/|$)/, ["serial-numbers", "warranty"]],
  [/^\/fitment(?:\/|$)/, ["part-compatibility"]],
  [/^\/size-runs(?:\/|$)/, ["variants"]],
  [/^\/book-lists(?:\/|$)/, ["book-sets", "schools-classes"]],
  [/^\/orders(?:\/|$)/, ["sales-orders", "quotations"]],
  [/^\/testers(?:\/|$)/, ["tester-stock"]],
  [/^\/tables(?:\/|$)/, ["tables"]],
  [/^\/kitchen(?:\/|$)/, ["kitchen-kot"]],
];

/**
 * The spine every shop gets regardless of trade, mirroring SHARED_NAVIGATION in
 * backend/src/verticals/profile.js. Kept here so the client can assert the core
 * routes stay reachable without importing server code.
 */
export const SHARED_NAVIGATION = [
  "dashboard", "customers", "purchases", "suppliers", "sales", "returns",
  "reports", "cash-payments", "expenses", "staff", "settings",
] as const;

/** Unknown/shared-core routes remain visible; only profile-mapped trade routes are filtered. */
export function isPathInBusinessProfile(path: string, navigation?: string[]) {
  if (!navigation) return true;
  const rule = PATH_NAVIGATION_KEYS.find(([pattern]) => pattern.test(path));
  return !rule || rule[1].some((key) => navigation.includes(key));
}

export function profileHasCapability(capabilities: string[] | undefined, capability: string) {
  return capabilities?.includes(capability) ?? false;
}

/**
 * Screens that belong to a capability rather than to a navigation key.
 *
 * Batch & Expiry used to be unlocked by the plain "inventory" key, which every
 * trade carries — so a garment shop, a shoe shop and a spare-parts counter all
 * found dated-stock tooling in the sidebar. The obvious fix was to demand the
 * "batches"/"expiry" nav keys instead, but only pharmacy and cosmetics list
 * those; a kirana store holds BATCH_TRACKING and sells dated food, and would
 * have lost the screen until its server profile caught up.
 *
 * Asking the capability is both the more truthful question and the one that
 * needs no deploy ordering: it is answered correctly by servers old and new.
 */
const PATH_CAPABILITIES: Array<[RegExp, string[]]> = [
  [/^\/inventory\/batches(?:\/|$)/, ["BATCH_TRACKING", "EXPIRY_TRACKING"]],
];

export function isPathAllowedByCapabilities(path: string, capabilities?: string[]) {
  // Bootstrap can be unavailable offline; the gate must not lock the app then.
  if (!capabilities) return true;
  const rule = PATH_CAPABILITIES.find(([pattern]) => pattern.test(path));
  return !rule || rule[1].some((capability) => capabilities.includes(capability));
}

/**
 * All three gates at once — the module switches and the client's vertical gate,
 * the server's navigation list, and the server's capability list.
 *
 * The sidebar composes exactly these to decide what to show. Any screen that
 * offers its own shortcut to another route has to ask the same question, or it
 * becomes the one place in the app that hands a shop a link to a screen the
 * sidebar knows it does not have.
 */
export function useIsShopPathVisible(): (href: string) => boolean {
  const { isHrefEnabled } = useModuleVisibility();
  const profile = useShopBusinessProfile();
  const navigation = profile.data?.navigation;
  const capabilities = profile.data?.capabilities;
  return useCallback(
    (href: string) =>
      isHrefEnabled(href)
      && isPathInBusinessProfile(href, navigation)
      && isPathAllowedByCapabilities(href, capabilities),
    [capabilities, isHrefEnabled, navigation],
  );
}
