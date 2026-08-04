/**
 * Catalog availability filters — the seam that lets one trade hide stock the
 * shared catalogue would otherwise happily show.
 *
 * A sherwani promised to a wedding party is not on anybody's rack today, but
 * only the clothing pack knows that. The shared catalogue must not import
 * clothing to find out: shared code that names one trade makes that trade's
 * bugs and releases every shop's problem. So a vertical registers its filter
 * here at load time and the catalogue asks the registry instead.
 *
 * The arrow points one way. A shop with no rentals runs exactly the same
 * catalogue path with an empty filter list and one `Set` allocation saved.
 */

const filters = [];

/**
 * @param {(shopId: string, products: Array<{ id: string }>, options: object) => Promise<Iterable<string>> | Iterable<string>} filter
 *   Returns the ids that are unavailable right now, out of the products handed to it.
 */
export function registerCatalogAvailabilityFilter(filter) {
  if (typeof filter !== "function") throw new TypeError("A catalog availability filter must be a function");
  filters.push(filter);
}

/**
 * Ids of products that exist and are in stock, yet cannot be sold right now.
 * Empty when no vertical has registered a filter — the common case.
 */
export async function unavailableProductIds(shopId, products, options = {}) {
  if (filters.length === 0) return new Set();
  const blocked = new Set();
  for (const filter of filters) {
    const ids = await filter(shopId, products, options);
    if (ids) for (const id of ids) blocked.add(id);
  }
  return blocked;
}

/** Test seam: drop every registration so one suite cannot leak into the next. */
export function resetCatalogAvailabilityFilters() {
  filters.length = 0;
}
