import type { BusinessType } from "./business-types";
import type { TranslationKey } from "./i18n";
import {
  BOOK_LISTS_LINK,
  ORDER_BOOK_LINK,
  PART_FINDER_LINK,
  PRODUCTION_LINK,
  SIZE_RUNS_LINK,
  TESTERS_LINK,
  type ShopTradeLink,
} from "./shop-trade-links";

/**
 * Who this trade actually buys from.
 *
 * "Supplier" is the generic, and it is wrong often enough to matter. A chemist
 * does not buy from suppliers, it buys from stockists and distributors holding
 * their own drug licences. A factory buys from vendors. A kitchen buys from a
 * vegetable vendor daily and a distributor monthly. The word decides whether an
 * owner recognises the screen as the place their purchase contacts live.
 *
 * Two forms per trade, for the same reason the till needed two credit words:
 * the heading and the count read as a plural ("12 distributors") while the
 * button and the dialog title read as a singular ("Add Distributor").
 */
export interface ShopSuppliersProfile {
  /** Heading over the list. */
  headingKey: TranslationKey;
  /** Plural, lowercase — goes into counts and empty states. */
  pluralWordKey: TranslationKey;
  /** Singular, capitalised — goes into buttons and dialog titles. */
  singularWordKey: TranslationKey;
  /** One line on what this trade must get right about its buying. */
  focusKey: TranslationKey;
  /** Where this trade goes next from a supplier record. */
  links: readonly ShopTradeLink[];
}

/** Every trade books its goods in through the same screen. */
const PURCHASES: ShopTradeLink = { labelKey: "suppliers.trade.link.purchases", href: "/purchase-bills" };

const SUPPLIERS = {
  pluralWordKey: "suppliers.word.suppliers",
  singularWordKey: "suppliers.word.supplier",
} as const;
const DISTRIBUTORS = {
  pluralWordKey: "suppliers.word.distributors",
  singularWordKey: "suppliers.word.distributor",
} as const;
const VENDORS = {
  pluralWordKey: "suppliers.word.vendors",
  singularWordKey: "suppliers.word.vendor",
} as const;

export const SHOP_SUPPLIERS: Record<BusinessType, ShopSuppliersProfile> = {
  kirana: {
    headingKey: "suppliers.trade.heading.kirana",
    ...SUPPLIERS,
    focusKey: "suppliers.trade.focus.kirana",
    links: [PURCHASES],
  },
  clothing: {
    headingKey: "suppliers.trade.heading.general",
    ...SUPPLIERS,
    focusKey: "suppliers.trade.focus.clothing",
    links: [PURCHASES],
  },
  footwear: {
    headingKey: "suppliers.trade.heading.general",
    ...SUPPLIERS,
    focusKey: "suppliers.trade.focus.footwear",
    links: [PURCHASES, SIZE_RUNS_LINK],
  },
  auto_parts: {
    headingKey: "suppliers.trade.heading.distributors",
    ...DISTRIBUTORS,
    focusKey: "suppliers.trade.focus.autoParts",
    links: [PURCHASES, PART_FINDER_LINK],
  },
  electronics: {
    headingKey: "suppliers.trade.heading.distributors",
    ...DISTRIBUTORS,
    focusKey: "suppliers.trade.focus.electronics",
    links: [PURCHASES],
  },
  pharmacy: {
    headingKey: "suppliers.trade.heading.distributors",
    ...DISTRIBUTORS,
    focusKey: "suppliers.trade.focus.pharmacy",
    links: [PURCHASES],
  },
  stationery: {
    headingKey: "suppliers.trade.heading.distributors",
    ...DISTRIBUTORS,
    focusKey: "suppliers.trade.focus.stationery",
    links: [PURCHASES, BOOK_LISTS_LINK],
  },
  furniture: {
    headingKey: "suppliers.trade.heading.general",
    ...SUPPLIERS,
    focusKey: "suppliers.trade.focus.furniture",
    links: [PURCHASES, ORDER_BOOK_LINK],
  },
  cosmetics: {
    headingKey: "suppliers.trade.heading.distributors",
    ...DISTRIBUTORS,
    focusKey: "suppliers.trade.focus.cosmetics",
    links: [PURCHASES, TESTERS_LINK],
  },
  restaurant: {
    headingKey: "suppliers.trade.heading.vendors",
    ...VENDORS,
    focusKey: "suppliers.trade.focus.restaurant",
    links: [PURCHASES],
  },
  manufacturing: {
    headingKey: "suppliers.trade.heading.vendors",
    ...VENDORS,
    focusKey: "suppliers.trade.focus.manufacturing",
    links: [PURCHASES, PRODUCTION_LINK],
  },
  other: {
    headingKey: "suppliers.trade.heading.general",
    ...SUPPLIERS,
    focusKey: "suppliers.trade.focus.other",
    links: [PURCHASES],
  },
};

export function getShopSuppliersProfile(businessType: BusinessType): ShopSuppliersProfile {
  return SHOP_SUPPLIERS[businessType];
}
