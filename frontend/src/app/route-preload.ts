import type { ComponentType } from "react";

type RouteModule = { default: ComponentType };
type RouteLoader = () => Promise<RouteModule>;

export const loadBillingRoute: RouteLoader = () => import("@/features/core/billing/pages/BillingPage");
export const loadCustomersRoute: RouteLoader = () => import("@/features/core/customers/pages/CustomersPage");
export const loadInventoryRoute: RouteLoader = () => import("@/features/core/inventory/pages/InventoryPage");
export const loadPurchasesRoute: RouteLoader = () => import("@/features/core/purchases/pages/PurchaseBillsPage");
export const loadSalesOverviewRoute: RouteLoader = () => import("@/features/core/sales/pages/SalesOverviewPage");

const loaders: Record<string, RouteLoader> = {
  "/billing": loadBillingRoute,
  "/customers": loadCustomersRoute,
  // "/udhar" redirects to the customer credit view, so warming it warms that chunk.
  "/udhar": loadCustomersRoute,
  "/inventory": loadInventoryRoute,
  "/purchases": loadPurchasesRoute,
  "/sales/overview": loadSalesOverviewRoute,
};
const pending = new Map<string, Promise<RouteModule>>();

function routeKey(href: string): string {
  return href.split(/[?#]/)[0].replace(/\/$/, "") || "/";
}

/** Warm a high-frequency route without adding it to the startup bundle. */
export function preloadCoreRoute(href: string): Promise<RouteModule> | null {
  const key = routeKey(href);
  const loader = loaders[key];
  if (!loader) return null;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = loader().catch((error) => {
    pending.delete(key);
    throw error;
  });
  pending.set(key, request);
  return request;
}

/**
 * Start parsing a route only after the current screen yields. The timeout keeps
 * busy shop devices from postponing the warm-up forever, while pointer/focus
 * preloading still wins immediately when the user heads for the link.
 */
export function scheduleCoreRoutePreload(href: string, timeout = 2_000): () => void {
  if (typeof window === "undefined") return () => undefined;
  const browserWindow = window as typeof window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (browserWindow.requestIdleCallback) {
    const id = browserWindow.requestIdleCallback(() => void preloadCoreRoute(href)?.catch(() => undefined), { timeout });
    return () => browserWindow.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(() => void preloadCoreRoute(href)?.catch(() => undefined), Math.min(timeout, 750));
  return () => window.clearTimeout(id);
}
