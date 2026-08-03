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

const PATH_NAVIGATION_KEYS: Array<[RegExp, string[]]> = [
  [/^\/dashboard(?:\/|$)/, ["dashboard"]],
  [/^\/billing(?:\/|$)/, ["billing", "pos"]],
  [/^\/products(?:\/|$)|^\/categories(?:\/|$)/, ["products", "menu", "medicines"]],
  [/^\/inventory\/batches(?:\/|$)/, ["batches", "expiry", "inventory"]],
  [/^\/inventory(?:\/|$)/, ["inventory"]],
  [/^\/customers(?:\/|$)|^\/udhar(?:\/|$)/, ["customers"]],
  [/^\/purchase-bills(?:\/|$)|^\/suppliers(?:\/|$)/, ["purchases"]],
  [/^\/bills(?:\/|$)|^\/sales-overview(?:\/|$)|^\/orders-received(?:\/|$)/, ["sales", "orders"]],
  [/^\/returns(?:\/|$)/, ["returns", "exchanges"]],
  [/^\/reports(?:\/|$)/, ["reports"]],
  [/^\/money-statement(?:\/|$)|^\/daily-closing(?:\/|$)/, ["cash-payments"]],
  [/^\/expenses(?:\/|$)/, ["expenses"]],
  [/^\/rentals(?:\/|$)/, ["rentals"]],
];

/** Unknown/shared-core routes remain visible; only profile-mapped trade routes are filtered. */
export function isPathInBusinessProfile(path: string, navigation?: string[]) {
  if (!navigation) return true;
  const rule = PATH_NAVIGATION_KEYS.find(([pattern]) => pattern.test(path));
  return !rule || rule[1].some((key) => navigation.includes(key));
}

export function profileHasCapability(capabilities: string[] | undefined, capability: string) {
  return capabilities?.includes(capability) ?? false;
}
