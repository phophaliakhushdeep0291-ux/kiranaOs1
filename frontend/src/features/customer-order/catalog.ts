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
  products: CustomerCatalogProduct[];
  cachedAt: string;
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
export function readCachedCatalog(shopCode: string): CustomerCatalog | null {
  return localStorageCatalogStore.read(shopCode);
}

/** Fetch the live customer-safe catalog from the public endpoint. */
export async function fetchCustomerCatalog(shopCode: string): Promise<CustomerCatalog> {
  const url = `${getApiBaseUrl()}/public/shops/${encodeURIComponent(shopCode)}/catalog`;
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
}

export interface SubmitOrderResult {
  orderId: string;
  itemCount: number;
  estimatedTotal: number;
  shopName: string;
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
): Promise<LoadCatalogResult> {
  const fetcher = deps.fetcher ?? fetchCustomerCatalog;
  const storage = deps.storage ?? localStorageCatalogStore;

  try {
    const catalog = await fetcher(shopCode);
    storage.write(shopCode, catalog);
    return { catalog, source: "network" };
  } catch (err) {
    if (err instanceof CatalogUnavailableError) {
      storage.remove(shopCode);
      throw err;
    }
    const cached = storage.read(shopCode);
    if (cached) return { catalog: cached, source: "cache" };
    throw err;
  }
}
