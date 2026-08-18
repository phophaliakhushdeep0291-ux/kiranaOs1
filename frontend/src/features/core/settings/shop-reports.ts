import type { BusinessType } from "./business-types";
import type { TranslationKey } from "./i18n";
import { SHOP_CREDIT_WORD } from "./shop-credit";
import {
  BATCH_EXPIRY_LINK,
  BOOK_LISTS_LINK,
  KITCHEN_STOCK_LINK,
  ORDER_BOOK_LINK,
  PART_FINDER_LINK,
  PRESCRIPTIONS_LINK,
  PRODUCTION_LINK,
  SERIAL_UNITS_LINK,
  SIZE_RUNS_LINK,
  TESTERS_LINK,
  type ShopTradeLink,
} from "./shop-trade-links";

/**
 * The same numbers, read the way each trade reads them.
 *
 * A restaurant's top line is revenue and a factory's is dispatch value; money a
 * customer owes is udhar in a kirana store, a patient account in a pharmacy and
 * a tab in a café. Those are not decorations — an owner scanning a report reads
 * the label before the number, and a word from someone else's trade makes them
 * stop and re-read.
 *
 * Only the words that change are listed. Cash, UPI, bank, expenses and net
 * profit mean the same thing everywhere and keep the shared strings.
 *
 * Copy is held as dictionary keys, not English text: Hindi is the default
 * language here. Trades happy with the generic wording point back at the generic
 * key, which is why several entries repeat.
 */
export interface ShopReportsProfile {
  /** Heading over the whole report. */
  headingKey: TranslationKey;
  /** The top-line money metric: sales, revenue, dispatch value. */
  salesLabelKey: TranslationKey;
  /**
   * What money owed by a customer is called here. Interpolated rather than
   * spelled out per trade, so "Outstanding {credit}" and "Top Customers
   * ({credit})" stay one string each in both languages.
   */
  creditWordKey: TranslationKey;
  /** Title of the best-sellers table: products, dishes, medicines, parts. */
  topItemsKey: TranslationKey;
  /** One line on what this trade should actually watch in these numbers. */
  watchKey: TranslationKey;
  /** Trade screens worth opening from a report. */
  links: readonly ShopTradeLink[];
}

export const SHOP_REPORTS: Record<BusinessType, ShopReportsProfile> = {
  kirana: {
    headingKey: "reports.trade.heading.general",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: SHOP_CREDIT_WORD.kirana,
    topItemsKey: "reports.table.topProducts",
    watchKey: "reports.trade.watch.kirana",
    links: [BATCH_EXPIRY_LINK],
  },
  clothing: {
    headingKey: "reports.trade.heading.clothing",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: SHOP_CREDIT_WORD.clothing,
    topItemsKey: "reports.table.topStyles",
    watchKey: "reports.trade.watch.clothing",
    links: [],
  },
  footwear: {
    headingKey: "reports.trade.heading.footwear",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: SHOP_CREDIT_WORD.footwear,
    topItemsKey: "reports.table.topModels",
    watchKey: "reports.trade.watch.footwear",
    links: [SIZE_RUNS_LINK],
  },
  auto_parts: {
    headingKey: "reports.trade.heading.autoParts",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: SHOP_CREDIT_WORD.auto_parts,
    topItemsKey: "reports.table.topParts",
    watchKey: "reports.trade.watch.autoParts",
    links: [PART_FINDER_LINK],
  },
  electronics: {
    headingKey: "reports.trade.heading.electronics",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: SHOP_CREDIT_WORD.electronics,
    topItemsKey: "reports.table.topModels",
    watchKey: "reports.trade.watch.electronics",
    links: [SERIAL_UNITS_LINK],
  },
  pharmacy: {
    headingKey: "reports.trade.heading.pharmacy",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: SHOP_CREDIT_WORD.pharmacy,
    topItemsKey: "reports.table.topMedicines",
    watchKey: "reports.trade.watch.pharmacy",
    links: [BATCH_EXPIRY_LINK, PRESCRIPTIONS_LINK],
  },
  stationery: {
    headingKey: "reports.trade.heading.stationery",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: SHOP_CREDIT_WORD.stationery,
    topItemsKey: "reports.table.topTitles",
    watchKey: "reports.trade.watch.stationery",
    links: [BOOK_LISTS_LINK],
  },
  furniture: {
    headingKey: "reports.trade.heading.furniture",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: SHOP_CREDIT_WORD.furniture,
    topItemsKey: "reports.table.topModels",
    watchKey: "reports.trade.watch.furniture",
    links: [ORDER_BOOK_LINK],
  },
  cosmetics: {
    headingKey: "reports.trade.heading.cosmetics",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: SHOP_CREDIT_WORD.cosmetics,
    topItemsKey: "reports.table.topShades",
    watchKey: "reports.trade.watch.cosmetics",
    links: [BATCH_EXPIRY_LINK, TESTERS_LINK],
  },
  restaurant: {
    headingKey: "reports.trade.heading.restaurant",
    salesLabelKey: "reports.kpi.totalRevenue",
    creditWordKey: SHOP_CREDIT_WORD.restaurant,
    topItemsKey: "reports.table.topDishes",
    watchKey: "reports.trade.watch.restaurant",
    links: [KITCHEN_STOCK_LINK, BATCH_EXPIRY_LINK],
  },
  manufacturing: {
    headingKey: "reports.trade.heading.manufacturing",
    salesLabelKey: "reports.kpi.dispatchValue",
    creditWordKey: SHOP_CREDIT_WORD.manufacturing,
    topItemsKey: "reports.table.topDispatched",
    watchKey: "reports.trade.watch.manufacturing",
    links: [PRODUCTION_LINK, BATCH_EXPIRY_LINK],
  },
  other: {
    headingKey: "reports.trade.heading.general",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: SHOP_CREDIT_WORD.other,
    topItemsKey: "reports.table.topProducts",
    watchKey: "reports.trade.watch.other",
    links: [],
  },
};

export function getShopReportsProfile(businessType: BusinessType): ShopReportsProfile {
  return SHOP_REPORTS[businessType];
}
