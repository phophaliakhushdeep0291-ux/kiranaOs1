import { getApiBaseUrl } from "@/lib/api/http";

/**
 * Customer-side catalog for the QR self-order page (`/order/:shopCode`). The page is public
 * (no login), so it fetches a storefront-safe catalog from the public backend endpoint once
 * while online and caches it locally — after that it reopens offline. We deliberately use a
 * plain fetch (no auth header) and a per-shopCode localStorage snapshot rather than the
 * tenant-scoped offline DB, because the customer is not a logged-in tenant.
 */

export interface CustomerCatalogProduct {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  price: number;
  mrp: number | null;
  imageUrl: string | null;
}

export interface CustomerCatalog {
  shop: { id: string; name: string; city: string | null };
  location: CustomerStoreLocation;
  locations: CustomerStoreLocation[];
  products: CustomerCatalogProduct[];
  cachedAt: string;
}

export interface CustomerStoreLocation {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  isPrimary: boolean;
}

/** Thrown when the shop is unknown or not accepting online orders (a definitive 404, not offline). */
export class CatalogUnavailableError extends Error {
  constructor(message = "This shop is not accepting online orders right now.") {
    super(message);
    this.name = "CatalogUnavailableError";
  }
}

const CACHE_PREFIX = "kirana:customer-catalog:";

export interface CatalogStorage {
  read(shopCode: string): CustomerCatalog | null;
  write(shopCode: string, catalog: CustomerCatalog): void;
  remove(shopCode: string): void;
}

const localStorageCatalogStore: CatalogStorage = {
  read(shopCode) {
    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}${shopCode}`);
      return raw ? (JSON.parse(raw) as CustomerCatalog) : null;
    } catch {
      return null;
    }
  },
  write(shopCode, catalog) {
    try {
      localStorage.setItem(`${CACHE_PREFIX}${shopCode}`, JSON.stringify(catalog));
    } catch {
      // Storage may be unavailable/full (private mode, big catalog). The in-session copy still works.
    }
  },
  remove(shopCode) {
    try {
      localStorage.removeItem(`${CACHE_PREFIX}${shopCode}`);
    } catch {
      /* ignore */
    }
  },
};

/** Read the cached catalog snapshot (if any) for an instant first paint before revalidating. */
function scopedCatalogKey(shopCode: string, locationId?: string) {
  return locationId ? `${shopCode}:location:${locationId}` : shopCode;
}

export function readCachedCatalog(shopCode: string, locationId?: string): CustomerCatalog | null {
  return localStorageCatalogStore.read(scopedCatalogKey(shopCode, locationId));
}

/** Fetch the live customer-safe catalog from the public endpoint. */
export async function fetchCustomerCatalog(shopCode: string, locationId?: string): Promise<CustomerCatalog> {
  const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
  const url = `${getApiBaseUrl()}/public/shops/${encodeURIComponent(shopCode)}/catalog${query}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    // Network failure (offline / DNS). Surface as a generic error so callers fall back to cache.
    throw new Error("Could not reach the shop. Check your internet and try again.", { cause: err });
  }
  if (res.status === 404) throw new CatalogUnavailableError();
  if (!res.ok) throw new Error(`Catalog request failed (${res.status}).`);

  const json = (await res.json()) as { data?: Omit<CustomerCatalog, "cachedAt"> };
  if (!json.data) throw new Error("Catalog response was malformed.");
  return { ...json.data, cachedAt: new Date().toISOString() };
}

export interface CustomerOrderDetails {
  customerName: string;
  customerMobile: string;
  customerAddress?: string;
  note?: string;
  locationId: string;
  fulfillmentType: "delivery" | "pickup";
  promisedSlot?: string;
}

export interface SubmitOrderResult {
  orderId: string;
  itemCount: number;
  estimatedTotal: number;
  shopName: string;
  locationId: string | null;
  fulfillmentType: "delivery" | "pickup";
  status: "new";
  duplicate?: boolean;
}

/**
 * Submit the customer's order to the shop online (public, no auth). The backend re-prices every
 * line from the shop's own catalog, so we only send productId + qty. Lands in the owner's inbox.
 */
export async function submitCustomerOrder(
  shopCode: string,
  details: CustomerOrderDetails,
  items: Array<{ productId: string; qty: number }>,
  idempotencyKey?: string,
): Promise<SubmitOrderResult> {
  const url = `${getApiBaseUrl()}/public/shops/${encodeURIComponent(shopCode)}/orders`;
  let res: Response;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...details, items, idempotencyKey }),
    });
  } catch (err) {
    throw new Error("Could not reach the shop. Check your internet and try again.", { cause: err });
  }
  const json = (await res.json().catch(() => ({}))) as { data?: SubmitOrderResult; error?: string };
  if (!res.ok || !json.data) {
    throw new Error(json.error || `Could not place the order (${res.status}).`);
  }
  return json.data;
}

// ─── Order tracking (customer's own order, by its unguessable id) ────────────

export type OrderStage = "received" | "preparing" | "ready" | "declined";

export interface CustomerOrderStatus {
  orderId: string;
  status: "new" | "accepted" | "ready" | "fulfilled" | "rejected" | "cancelled";
  stage: OrderStage;
  fulfillmentType: "delivery" | "pickup";
  promisedSlot: string | null;
  location: Pick<CustomerStoreLocation, "id" | "name" | "address" | "city" | "phone"> | null;
  itemCount: number;
  estimatedTotal: number;
  items: Array<{ name: string; qty: number; price: number; unit: string }>;
  shopName: string;
  createdAt: string;
  updatedAt: string;
}

/** Thrown when the tracked order no longer exists (or the shop turned ordering off). */
export class OrderNotFoundError extends Error {
  constructor(message = "We couldn't find that order.") {
    super(message);
    this.name = "OrderNotFoundError";
  }
}

/** Poll a single order's status for the customer's tracker. */
export async function fetchOrderStatus(shopCode: string, orderId: string): Promise<CustomerOrderStatus> {
  const url = `${getApiBaseUrl()}/public/shops/${encodeURIComponent(shopCode)}/orders/${encodeURIComponent(orderId)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new Error("Could not reach the shop. Check your internet and try again.", { cause: err });
  }
  if (res.status === 404) throw new OrderNotFoundError();
  if (!res.ok) throw new Error(`Order status request failed (${res.status}).`);
  const json = (await res.json()) as { data?: CustomerOrderStatus };
  if (!json.data) throw new Error("Order status response was malformed.");
  return json.data;
}

const MY_ORDER_PREFIX = "kirana:customer-order:my:";

export interface MyOrderPointer {
  orderId: string;
  placedAt: string;
}

/** Remember the customer's most recent order for this shop so they can reopen and track it. */
export function rememberMyOrder(shopCode: string, orderId: string): void {
  try {
    localStorage.setItem(`${MY_ORDER_PREFIX}${shopCode}`, JSON.stringify({ orderId, placedAt: new Date().toISOString() }));
  } catch {
    /* storage unavailable — tracking just won't persist across reloads */
  }
}

export function readMyOrder(shopCode: string): MyOrderPointer | null {
  try {
    const raw = localStorage.getItem(`${MY_ORDER_PREFIX}${shopCode}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MyOrderPointer;
    return parsed?.orderId ? parsed : null;
  } catch {
    return null;
  }
}

export function forgetMyOrder(shopCode: string): void {
  try {
    localStorage.removeItem(`${MY_ORDER_PREFIX}${shopCode}`);
  } catch {
    /* ignore */
  }
}

export interface LoadCatalogResult {
  catalog: CustomerCatalog;
  source: "network" | "cache";
}

/**
 * Network-first with offline fallback: fetch + refresh the cache when reachable; fall back to the
 * cached snapshot when the network fails. A definitive "not available" (404) clears the cache and
 * propagates, so a shop that turned ordering off doesn't keep serving a stale storefront.
 */
export async function loadCustomerCatalog(
  shopCode: string,
  deps: { fetcher?: typeof fetchCustomerCatalog; storage?: CatalogStorage } = {},
  locationId?: string,
): Promise<LoadCatalogResult> {
  const fetcher = deps.fetcher ?? fetchCustomerCatalog;
  const storage = deps.storage ?? localStorageCatalogStore;

  try {
    const catalog = await fetcher(shopCode, locationId);
    storage.write(scopedCatalogKey(shopCode, locationId), catalog);
    return { catalog, source: "network" };
  } catch (err) {
    if (err instanceof CatalogUnavailableError) {
      storage.remove(scopedCatalogKey(shopCode, locationId));
      throw err;
    }
    const cached = storage.read(scopedCatalogKey(shopCode, locationId));
    if (cached) return { catalog: cached, source: "cache" };
    throw err;
  }
}
