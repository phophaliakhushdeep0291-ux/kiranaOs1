import { apiRequest } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";

const CACHE_PREFIX = "product-knowledge:v1:";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface KnownProductDetails {
  found: true;
  barcode: string;
  name: string;
  brand: string;
  category: string;
  unit: string;
  packSizeValue: number;
  packSizeUnit: string;
  aliases: string[];
  description: string;
  imageUrl: string | null;
  source: string;
}

interface KnowledgeResponse {
  found: boolean;
  barcode: string;
  reason?: string;
}

interface CachedKnowledge {
  checkedAt: number;
  value: KnownProductDetails | null;
}

function cacheKey(barcode: string) {
  return `${CACHE_PREFIX}${barcode}`;
}

export async function lookupKnownProduct(barcode: string, { online = typeof navigator === "undefined" || navigator.onLine !== false, now = Date.now() } = {}) {
  const code = barcode.trim();
  const cached = await offlineDB.getSetting<CachedKnowledge>(cacheKey(code)).catch(() => null);
  if (cached && now - cached.checkedAt < CACHE_TTL_MS) return cached.value;
  if (!online) return cached?.value ?? null;
  try {
    const result = await apiRequest<KnownProductDetails | KnowledgeResponse>(`/products/knowledge/${encodeURIComponent(code)}`, {
      method: "GET",
      timeoutMs: 6_000,
    });
    const value = result.found && "name" in result ? result as KnownProductDetails : null;
    await offlineDB.setSetting(cacheKey(code), { checkedAt: now, value }).catch(() => undefined);
    return value;
  } catch {
    // Billing already has a manual capture sheet. Vendor/API downtime simply falls back
    // to it, and a previously cached public product remains usable offline.
    return cached?.value ?? null;
  }
}
