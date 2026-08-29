export const RESTAURANT_ITEM_TYPES = Object.freeze(["prepared", "packaged", "ingredient"]);

/**
 * Prepared dishes are sale identities, not finished goods sitting on a shelf.
 * Everything else keeps the ordinary stock path, including legacy/null rows.
 */
export function productTracksStock(product) {
  return product?.restaurantItemType !== "prepared";
}

/** Kitchen-only ingredients must never be exposed on a guest-facing menu. */
export function productAppearsOnRestaurantMenu(product) {
  return product?.restaurantItemType !== "ingredient";
}
