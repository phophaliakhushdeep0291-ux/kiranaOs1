import type { BusinessType } from "./business-types";
import type { TranslationKey } from "./i18n";
import {
  MENU_LINK,
  ORDER_BOOK_LINK,
  PART_FINDER_LINK,
  PRESCRIPTIONS_LINK,
  PRODUCTION_LINK,
  SERIAL_UNITS_LINK,
  SIZE_RUNS_LINK,
  type ShopTradeLink,
} from "./shop-trade-links";

/**
 * What an incoming order is, and what this trade must check before accepting it.
 *
 * "Online orders" is right for a shop whose orders arrive through the QR link
 * and wrong for the three trades that run an order book as their main business:
 * a restaurant's orders are simply its orders, a showroom's are customer orders
 * against a lead time, a factory's are buyer orders against capacity.
 *
 * The focus line carries more weight on this screen than on the others, because
 * accepting is a promise made to a named person who is already waiting. What
 * makes that promise fail is different per trade and is not obvious from the
 * order itself — a size that is out of the run, a shade that cannot be returned
 * once opened, a prescription that has not been seen.
 */
export interface ShopOrdersProfile {
  /** Heading over the queue. */
  headingKey: TranslationKey;
  /** What this trade must confirm before accepting an order. */
  focusKey: TranslationKey;
  /** Where this trade goes to check that, before it accepts. */
  links: readonly ShopTradeLink[];
}

export const SHOP_ORDERS: Record<BusinessType, ShopOrdersProfile> = {
  kirana: {
    headingKey: "orders.trade.heading.online",
    focusKey: "orders.trade.focus.kirana",
    links: [],
  },
  clothing: {
    headingKey: "orders.trade.heading.online",
    focusKey: "orders.trade.focus.clothing",
    links: [],
  },
  footwear: {
    headingKey: "orders.trade.heading.online",
    focusKey: "orders.trade.focus.footwear",
    links: [SIZE_RUNS_LINK],
  },
  auto_parts: {
    headingKey: "orders.trade.heading.online",
    focusKey: "orders.trade.focus.autoParts",
    links: [PART_FINDER_LINK],
  },
  electronics: {
    headingKey: "orders.trade.heading.online",
    focusKey: "orders.trade.focus.electronics",
    links: [SERIAL_UNITS_LINK],
  },
  pharmacy: {
    headingKey: "orders.trade.heading.pharmacy",
    focusKey: "orders.trade.focus.pharmacy",
    links: [PRESCRIPTIONS_LINK],
  },
  stationery: {
    headingKey: "orders.trade.heading.online",
    focusKey: "orders.trade.focus.stationery",
    links: [],
  },
  furniture: {
    headingKey: "orders.trade.heading.furniture",
    focusKey: "orders.trade.focus.furniture",
    links: [ORDER_BOOK_LINK],
  },
  cosmetics: {
    headingKey: "orders.trade.heading.online",
    focusKey: "orders.trade.focus.cosmetics",
    links: [],
  },
  restaurant: {
    headingKey: "orders.trade.heading.restaurant",
    focusKey: "orders.trade.focus.restaurant",
    links: [MENU_LINK],
  },
  manufacturing: {
    headingKey: "orders.trade.heading.manufacturing",
    focusKey: "orders.trade.focus.manufacturing",
    links: [PRODUCTION_LINK],
  },
  other: {
    headingKey: "orders.trade.heading.online",
    focusKey: "orders.trade.focus.other",
    links: [],
  },
};

export function getShopOrdersProfile(businessType: BusinessType): ShopOrdersProfile {
  return SHOP_ORDERS[businessType];
}
