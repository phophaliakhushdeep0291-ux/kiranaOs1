import type { BusinessType } from "./business-types";
import type { TranslationKey } from "./i18n";
import { SHOP_CREDIT_WORD } from "./shop-credit";
import {
  ORDER_BOOK_LINK,
  PRESCRIPTIONS_LINK,
  PRODUCTION_LINK,
  SERIAL_UNITS_LINK,
  type ShopTradeLink,
} from "./shop-trade-links";

/**
 * Who the person on the other side of the counter is, trade by trade.
 *
 * The sidebar already knows: `navConfig` labels `/customers` "Khata" on a parts
 * counter, "Accounts" at a chemist, "Tabs" in a café and "Trade Receivables" in
 * a factory. The screen behind that link said "Customer credit" to all of them.
 *
 * The credit word itself is not defined here — it comes from `shop-credit.ts`,
 * the same map the report reads, because an owner who follows "Patient Accounts"
 * off a report should not land on a screen that calls it udhar.
 *
 * Copy is held as dictionary keys, not English text: Hindi is the default
 * language. A trade happy with the generic heading points back at the generic
 * `customers.*` key.
 */
export interface ShopCustomersProfile {
  /** Heading over the customer list. */
  headingKey: TranslationKey;
  /** One line under it, describing what the screen is for in this trade. */
  subtitleKey: TranslationKey;
  /** What money owed is called here — interpolated into the shared phrases. */
  creditWordKey: TranslationKey;
  /** One line on how this trade should work its outstanding balances. */
  focusKey: TranslationKey;
  /** Trade screens worth opening from a customer account. */
  links: readonly ShopTradeLink[];
}

export const SHOP_CUSTOMERS: Record<BusinessType, ShopCustomersProfile> = {
  kirana: {
    headingKey: "customers.trade.heading.kirana",
    subtitleKey: "customers.subtitle",
    creditWordKey: SHOP_CREDIT_WORD.kirana,
    focusKey: "customers.trade.focus.kirana",
    links: [],
  },
  clothing: {
    headingKey: "customers.title",
    subtitleKey: "customers.subtitle",
    creditWordKey: SHOP_CREDIT_WORD.clothing,
    focusKey: "customers.trade.focus.clothing",
    links: [],
  },
  footwear: {
    headingKey: "customers.title",
    subtitleKey: "customers.subtitle",
    creditWordKey: SHOP_CREDIT_WORD.footwear,
    focusKey: "customers.trade.focus.footwear",
    links: [],
  },
  auto_parts: {
    headingKey: "customers.trade.heading.autoParts",
    subtitleKey: "customers.trade.subtitle.autoParts",
    creditWordKey: SHOP_CREDIT_WORD.auto_parts,
    focusKey: "customers.trade.focus.autoParts",
    links: [],
  },
  electronics: {
    headingKey: "customers.title",
    subtitleKey: "customers.trade.subtitle.electronics",
    creditWordKey: SHOP_CREDIT_WORD.electronics,
    focusKey: "customers.trade.focus.electronics",
    links: [SERIAL_UNITS_LINK],
  },
  pharmacy: {
    headingKey: "customers.trade.heading.pharmacy",
    subtitleKey: "customers.trade.subtitle.pharmacy",
    creditWordKey: SHOP_CREDIT_WORD.pharmacy,
    focusKey: "customers.trade.focus.pharmacy",
    links: [PRESCRIPTIONS_LINK],
  },
  stationery: {
    headingKey: "customers.trade.heading.stationery",
    subtitleKey: "customers.trade.subtitle.stationery",
    creditWordKey: SHOP_CREDIT_WORD.stationery,
    focusKey: "customers.trade.focus.stationery",
    links: [],
  },
  furniture: {
    headingKey: "customers.trade.heading.furniture",
    subtitleKey: "customers.trade.subtitle.furniture",
    creditWordKey: SHOP_CREDIT_WORD.furniture,
    focusKey: "customers.trade.focus.furniture",
    links: [ORDER_BOOK_LINK],
  },
  cosmetics: {
    headingKey: "customers.title",
    subtitleKey: "customers.subtitle",
    creditWordKey: SHOP_CREDIT_WORD.cosmetics,
    focusKey: "customers.trade.focus.cosmetics",
    links: [],
  },
  restaurant: {
    headingKey: "customers.trade.heading.restaurant",
    subtitleKey: "customers.trade.subtitle.restaurant",
    creditWordKey: SHOP_CREDIT_WORD.restaurant,
    focusKey: "customers.trade.focus.restaurant",
    links: [],
  },
  manufacturing: {
    headingKey: "customers.trade.heading.manufacturing",
    subtitleKey: "customers.trade.subtitle.manufacturing",
    creditWordKey: SHOP_CREDIT_WORD.manufacturing,
    focusKey: "customers.trade.focus.manufacturing",
    links: [PRODUCTION_LINK],
  },
  other: {
    headingKey: "customers.title",
    subtitleKey: "customers.subtitle",
    creditWordKey: SHOP_CREDIT_WORD.other,
    focusKey: "customers.trade.focus.other",
    links: [],
  },
};

export function getShopCustomersProfile(businessType: BusinessType): ShopCustomersProfile {
  return SHOP_CUSTOMERS[businessType];
}
