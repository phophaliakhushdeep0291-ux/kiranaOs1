import type { Personalization } from "./api";

/**
 * Pure helpers that turn the personalization payload into UI ordering.
 *
 * They live apart from the components for two reasons: the rules are the part
 * worth testing, and every one of them has to degrade to "change nothing" when
 * there is no history. A shop on day one must get exactly the app it would have
 * had without this feature.
 */

/**
 * Stable-sort `items` by learned usage, highest first.
 *
 * Anything the user has no history for keeps its original relative position at
 * the end, rather than being pushed to an arbitrary place — a screen that
 * reshuffles unfamiliar items is worse than one that never reorders at all.
 */
export function orderByUsage<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  scores: ReadonlyMap<string, number>,
): T[] {
  if (scores.size === 0) return [...items];
  return items
    .map((item, index) => ({ item, index, score: scores.get(keyOf(item)) ?? -1 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

/** `dashboardOrder` as a lookup, for `orderByUsage`. */
export function usageScores(order: Personalization["dashboardOrder"] | undefined): Map<string, number> {
  return new Map((order ?? []).map((row) => [row.key, row.score]));
}

/**
 * Products to suggest for the *next* line of the current bill.
 *
 * Two different questions, depending on where the user is:
 *
 *  - **Empty cart** → "what does this user usually bill at this hour?" The
 *    time-of-day prediction, which is only offered when it has enough history
 *    behind it.
 *  - **Non-empty cart** → "what goes with what is already in it?" Combinations
 *    are looked up from the most recently added line, because that is what the
 *    user is thinking about; earlier lines are already handled.
 *
 * Anything already in the cart is filtered out — suggesting what someone just
 * added is noise, and on a POS noise costs a tap during a sale.
 */
export function suggestNextProducts(
  personalization: Personalization | undefined,
  cartProductIds: readonly string[],
  limit = 4,
): { reason: "predicted" | "combo" | null; productIds: string[] } {
  if (!personalization) return { reason: null, productIds: [] };
  const inCart = new Set(cartProductIds);

  if (cartProductIds.length === 0) {
    const predicted = personalization.predictedProducts;
    if (!predicted?.sufficientData) return { reason: null, productIds: [] };
    const productIds = predicted.products.map((row) => row.productId).filter((id) => !inCart.has(id));
    return productIds.length > 0 ? { reason: "predicted", productIds: productIds.slice(0, limit) } : { reason: null, productIds: [] };
  }

  // Most recent line first, then work backwards, so the strongest signal leads
  // but a two-line cart still contributes if the last line has no pairs.
  const scored = new Map<string, number>();
  for (const productId of [...cartProductIds].reverse()) {
    for (const pair of personalization.productCombos?.[productId] ?? []) {
      if (inCart.has(pair.productId)) continue;
      scored.set(pair.productId, (scored.get(pair.productId) ?? 0) + pair.score);
    }
  }
  const productIds = [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  return productIds.length > 0 ? { reason: "combo", productIds } : { reason: null, productIds: [] };
}

/**
 * Past queries offered as auto-complete.
 *
 * With something typed these are prefix/substring matches on what the user has
 * searched before; with an empty box they are simply their most frequent
 * searches. The current query itself is never offered back.
 */
export function matchSearchSuggestions(
  personalization: Personalization | undefined,
  query: string,
  limit = 5,
): string[] {
  const suggestions = personalization?.searchSuggestions ?? [];
  const typed = query.trim().toLowerCase();
  return suggestions
    .filter((row) => row.query !== typed)
    .filter((row) => (typed.length === 0 ? true : row.query.includes(typed)))
    .slice(0, limit)
    .map((row) => row.query);
}

/** Product ids trending in online sessions, for a "trending" marker. */
export function trendingProductIds(personalization: Personalization | undefined, limit = 5): Set<string> {
  const rows = personalization?.onlineTrending ?? [];
  return new Set(rows.slice(0, limit).map((row) => row.key));
}

/**
 * The filter this user most often applies on a screen, or null.
 *
 * Restoring a filter changes what the user *sees*, so the bar is higher than for
 * a reordering: `preferredFilters` is already floored at three uses server-side,
 * and returning null here keeps the screen on its normal default.
 */
export function preferredFilterFor(
  personalization: Personalization | undefined,
  screen: string,
): string | null {
  const entries = personalization?.preferredFilters?.[screen] ?? [];
  return entries[0]?.filter ?? null;
}
