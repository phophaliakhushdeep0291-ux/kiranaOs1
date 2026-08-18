import type { BusinessType } from "./business-types";
import type { TranslationKey } from "./i18n";
import {
  BATCH_EXPIRY_LINK,
  BOOK_LISTS_LINK,
  KITCHEN_STOCK_LINK,
  ORDER_BOOK_LINK,
  PART_FINDER_LINK,
  PRODUCTION_LINK,
  SERIAL_UNITS_LINK,
  SIZE_RUNS_LINK,
  STOCK_COUNTS_LINK,
  type ShopTradeLink,
} from "./shop-trade-links";

/**
 * What still has to happen after the goods are booked in.
 *
 * Receiving is where a trade's second record gets made, and the purchase screen
 * is the only moment the shop is holding the delivery: a chemist has the strips
 * in hand with the lot and expiry printed on them, an electronics counter has
 * the boxes with the IMEIs still readable, a shoe shop has the run open on the
 * floor. Booking the bill does not capture any of that, and none of it can be
 * reconstructed a week later.
 *
 * So this profile is mostly links rather than vocabulary — the words on a
 * purchase bill are the same in every trade, but the next step is not, and this
 * screen had no next step at all.
 */
export interface ShopPurchasesProfile {
  /** One line on what this trade must record while the delivery is still open. */
  focusKey: TranslationKey;
  /** Where the goods just received still need to be written down. */
  links: readonly ShopTradeLink[];
}

export const SHOP_PURCHASES: Record<BusinessType, ShopPurchasesProfile> = {
  kirana: {
    focusKey: "purchases.trade.focus.kirana",
    links: [BATCH_EXPIRY_LINK, STOCK_COUNTS_LINK],
  },
  clothing: {
    focusKey: "purchases.trade.focus.clothing",
    links: [STOCK_COUNTS_LINK],
  },
  footwear: {
    focusKey: "purchases.trade.focus.footwear",
    links: [SIZE_RUNS_LINK, STOCK_COUNTS_LINK],
  },
  auto_parts: {
    focusKey: "purchases.trade.focus.autoParts",
    links: [PART_FINDER_LINK, STOCK_COUNTS_LINK],
  },
  electronics: {
    focusKey: "purchases.trade.focus.electronics",
    links: [SERIAL_UNITS_LINK, STOCK_COUNTS_LINK],
  },
  pharmacy: {
    focusKey: "purchases.trade.focus.pharmacy",
    links: [BATCH_EXPIRY_LINK, STOCK_COUNTS_LINK],
  },
  stationery: {
    focusKey: "purchases.trade.focus.stationery",
    links: [BOOK_LISTS_LINK, STOCK_COUNTS_LINK],
  },
  furniture: {
    focusKey: "purchases.trade.focus.furniture",
    links: [ORDER_BOOK_LINK, STOCK_COUNTS_LINK],
  },
  cosmetics: {
    focusKey: "purchases.trade.focus.cosmetics",
    links: [BATCH_EXPIRY_LINK, STOCK_COUNTS_LINK],
  },
  restaurant: {
    focusKey: "purchases.trade.focus.restaurant",
    links: [KITCHEN_STOCK_LINK, BATCH_EXPIRY_LINK],
  },
  manufacturing: {
    focusKey: "purchases.trade.focus.manufacturing",
    links: [PRODUCTION_LINK, BATCH_EXPIRY_LINK],
  },
  other: {
    focusKey: "purchases.trade.focus.other",
    links: [STOCK_COUNTS_LINK],
  },
};

export function getShopPurchasesProfile(businessType: BusinessType): ShopPurchasesProfile {
  return SHOP_PURCHASES[businessType];
}
