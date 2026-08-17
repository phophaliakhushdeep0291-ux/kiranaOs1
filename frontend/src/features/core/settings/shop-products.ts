import type { BusinessType } from "./business-types";
import type { TranslationKey } from "./i18n";
import {
  BATCH_EXPIRY_LINK,
  BOOK_LISTS_LINK,
  CATEGORIES_LINK,
  MENU_LINK,
  ORDER_BOOK_LINK,
  PART_FINDER_LINK,
  PRODUCTION_LINK,
  SERIAL_UNITS_LINK,
  SIZE_RUNS_LINK,
  TESTERS_LINK,
  type ShopTradeLink,
} from "./shop-trade-links";

/**
 * What one row of the catalogue is, trade by trade.
 *
 * The sidebar has always known this: it already labels `/products` "Menu" for a
 * restaurant, "Medicines" for a chemist and "Parts" for a parts counter, out of
 * `navConfig`. The page it opens then said "Total Products" to all three. This
 * map is what closes that gap, so the screen agrees with the link that reached
 * it.
 *
 * The search box is here for the same reason and matters more than the heading:
 * a chemist searches by salt, a parts counter by OEM number, a book shop by
 * ISBN and class. A placeholder naming the wrong identifier is not decoration —
 * it is the screen telling someone their own catalogue is not searchable that
 * way, when it is.
 *
 * Copy is held as dictionary keys, not English text: Hindi is the default
 * language here. A trade happy with the generic wording points back at the
 * generic `products.*` key, which is why several entries below repeat.
 */
export interface ShopProductsProfile {
  /** The metric that counts rows: products, dishes, medicines, parts. */
  totalLabelKey: TranslationKey;
  /** One line under that count, saying what is being counted. */
  totalHintKey: TranslationKey;
  /** The identifier this trade actually searches by. */
  searchPlaceholderKey: TranslationKey;
  /** One line on how this trade should keep its catalogue. */
  focusKey: TranslationKey;
  /** Catalogue screens worth opening from here. */
  links: readonly ShopTradeLink[];
}

export const SHOP_PRODUCTS: Record<BusinessType, ShopProductsProfile> = {
  kirana: {
    totalLabelKey: "products.stats.total",
    totalHintKey: "products.stats.totalHint",
    searchPlaceholderKey: "products.search.placeholder",
    focusKey: "products.trade.focus.kirana",
    links: [CATEGORIES_LINK],
  },
  clothing: {
    totalLabelKey: "products.trade.total.styles",
    totalHintKey: "products.trade.hint.styles",
    searchPlaceholderKey: "products.trade.search.clothing",
    focusKey: "products.trade.focus.clothing",
    links: [CATEGORIES_LINK],
  },
  footwear: {
    totalLabelKey: "products.trade.total.models",
    totalHintKey: "products.trade.hint.models",
    searchPlaceholderKey: "products.trade.search.footwear",
    focusKey: "products.trade.focus.footwear",
    links: [SIZE_RUNS_LINK, CATEGORIES_LINK],
  },
  auto_parts: {
    totalLabelKey: "products.trade.total.parts",
    totalHintKey: "products.trade.hint.parts",
    searchPlaceholderKey: "products.trade.search.autoParts",
    focusKey: "products.trade.focus.autoParts",
    links: [PART_FINDER_LINK, CATEGORIES_LINK],
  },
  electronics: {
    totalLabelKey: "products.trade.total.models",
    totalHintKey: "products.trade.hint.models",
    searchPlaceholderKey: "products.trade.search.electronics",
    focusKey: "products.trade.focus.electronics",
    links: [SERIAL_UNITS_LINK, CATEGORIES_LINK],
  },
  pharmacy: {
    totalLabelKey: "products.trade.total.medicines",
    totalHintKey: "products.trade.hint.medicines",
    searchPlaceholderKey: "products.trade.search.pharmacy",
    focusKey: "products.trade.focus.pharmacy",
    links: [BATCH_EXPIRY_LINK, CATEGORIES_LINK],
  },
  stationery: {
    totalLabelKey: "products.trade.total.titles",
    totalHintKey: "products.trade.hint.titles",
    searchPlaceholderKey: "products.trade.search.stationery",
    focusKey: "products.trade.focus.stationery",
    links: [BOOK_LISTS_LINK, CATEGORIES_LINK],
  },
  furniture: {
    totalLabelKey: "products.trade.total.models",
    totalHintKey: "products.trade.hint.models",
    searchPlaceholderKey: "products.trade.search.furniture",
    focusKey: "products.trade.focus.furniture",
    links: [ORDER_BOOK_LINK, CATEGORIES_LINK],
  },
  cosmetics: {
    totalLabelKey: "products.trade.total.shades",
    totalHintKey: "products.trade.hint.shades",
    searchPlaceholderKey: "products.trade.search.cosmetics",
    focusKey: "products.trade.focus.cosmetics",
    links: [BATCH_EXPIRY_LINK, TESTERS_LINK, CATEGORIES_LINK],
  },
  restaurant: {
    totalLabelKey: "products.trade.total.dishes",
    totalHintKey: "products.trade.hint.dishes",
    searchPlaceholderKey: "products.trade.search.restaurant",
    focusKey: "products.trade.focus.restaurant",
    links: [MENU_LINK, CATEGORIES_LINK],
  },
  manufacturing: {
    totalLabelKey: "products.trade.total.materials",
    totalHintKey: "products.trade.hint.materials",
    searchPlaceholderKey: "products.trade.search.manufacturing",
    focusKey: "products.trade.focus.manufacturing",
    links: [PRODUCTION_LINK, CATEGORIES_LINK],
  },
  other: {
    totalLabelKey: "products.stats.total",
    totalHintKey: "products.stats.totalHint",
    searchPlaceholderKey: "products.search.placeholder",
    focusKey: "products.trade.focus.other",
    links: [CATEGORIES_LINK],
  },
};

export function getShopProductsProfile(businessType: BusinessType): ShopProductsProfile {
  return SHOP_PRODUCTS[businessType];
}
