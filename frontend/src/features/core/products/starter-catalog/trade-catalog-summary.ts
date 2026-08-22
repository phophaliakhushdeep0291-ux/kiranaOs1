export const TRADE_STARTER_CATALOG_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  restaurant: 12,
  pharmacy: 10,
  auto_parts: 10,
  electronics: 10,
  clothing: 11,
  footwear: 10,
  cosmetics: 10,
  stationery: 11,
  furniture: 10,
  manufacturing: 8,
  other: 6,
});

export function tradeStarterCatalogCount(businessType?: string): number {
  if (!businessType) return 0;
  if (businessType === "kirana") return 560;
  return TRADE_STARTER_CATALOG_COUNTS[businessType] ?? 0;
}
