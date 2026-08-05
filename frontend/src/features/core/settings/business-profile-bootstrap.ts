import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/core/auth/useAuth";
import { getShopBootstrap } from "./api";
import { getStoredBusinessType, saveBusinessType } from "./business-type-store";

export const SHOP_BOOTSTRAP_QUERY_KEY = ["shop-bootstrap"] as const;

export function useShopBusinessProfile() {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: SHOP_BOOTSTRAP_QUERY_KEY,
    queryFn: getShopBootstrap,
    enabled: isAuthenticated,
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
  [/^\/inventory\/batches(?:\/|$)/, ["batches", "expiry", "inventory"]],
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
