import type { BusinessType } from "./business-types";
import type { TranslationKey } from "./i18n";
import { BATCH_EXPIRY_LINK, type ShopTradeLink } from "./shop-trade-links";

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
    creditWordKey: "reports.credit.udhar",
    topItemsKey: "reports.table.topProducts",
    watchKey: "reports.trade.watch.kirana",
    links: [BATCH_EXPIRY_LINK],
  },
  clothing: {
    headingKey: "reports.trade.heading.clothing",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: "reports.credit.credit",
    topItemsKey: "reports.table.topStyles",
    watchKey: "reports.trade.watch.clothing",
    links: [],
  },
  footwear: {
    headingKey: "reports.trade.heading.footwear",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: "reports.credit.dues",
    topItemsKey: "reports.table.topModels",
    watchKey: "reports.trade.watch.footwear",
    links: [{ labelKey: "inventory.trade.link.sizeRuns", href: "/size-runs" }],
  },
  auto_parts: {
    headingKey: "reports.trade.heading.autoParts",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: "reports.credit.partyCredit",
    topItemsKey: "reports.table.topParts",
    watchKey: "reports.trade.watch.autoParts",
    links: [{ labelKey: "inventory.trade.link.partFinder", href: "/fitment" }],
  },
  electronics: {
    headingKey: "reports.trade.heading.electronics",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: "reports.credit.credit",
    topItemsKey: "reports.table.topModels",
    watchKey: "reports.trade.watch.electronics",
    links: [{ labelKey: "inventory.trade.link.serialUnits", href: "/serial-units" }],
  },
  pharmacy: {
    headingKey: "reports.trade.heading.pharmacy",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: "reports.credit.patientAccounts",
    topItemsKey: "reports.table.topMedicines",
    watchKey: "reports.trade.watch.pharmacy",
    links: [BATCH_EXPIRY_LINK, { labelKey: "inventory.trade.link.prescriptions", href: "/prescriptions" }],
  },
  stationery: {
    headingKey: "reports.trade.heading.stationery",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: "reports.credit.credit",
    topItemsKey: "reports.table.topTitles",
    watchKey: "reports.trade.watch.stationery",
    links: [{ labelKey: "inventory.trade.link.bookLists", href: "/book-lists" }],
  },
  furniture: {
    headingKey: "reports.trade.heading.furniture",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: "reports.credit.dues",
    topItemsKey: "reports.table.topModels",
    watchKey: "reports.trade.watch.furniture",
    links: [{ labelKey: "inventory.trade.link.orderBook", href: "/orders" }],
  },
  cosmetics: {
    headingKey: "reports.trade.heading.cosmetics",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: "reports.credit.credit",
    topItemsKey: "reports.table.topShades",
    watchKey: "reports.trade.watch.cosmetics",
    links: [BATCH_EXPIRY_LINK, { labelKey: "inventory.trade.link.testers", href: "/testers" }],
  },
  restaurant: {
    headingKey: "reports.trade.heading.restaurant",
    salesLabelKey: "reports.kpi.totalRevenue",
    creditWordKey: "reports.credit.tabs",
    topItemsKey: "reports.table.topDishes",
    watchKey: "reports.trade.watch.restaurant",
    links: [{ labelKey: "inventory.trade.link.kitchenStock", href: "/kitchen-stock" }, BATCH_EXPIRY_LINK],
  },
  manufacturing: {
    headingKey: "reports.trade.heading.manufacturing",
    salesLabelKey: "reports.kpi.dispatchValue",
    creditWordKey: "reports.credit.receivables",
    topItemsKey: "reports.table.topDispatched",
    watchKey: "reports.trade.watch.manufacturing",
    links: [{ labelKey: "inventory.trade.link.production", href: "/manufacturing" }, BATCH_EXPIRY_LINK],
  },
  other: {
    headingKey: "reports.trade.heading.general",
    salesLabelKey: "reports.kpi.totalSales",
    creditWordKey: "reports.credit.credit",
    topItemsKey: "reports.table.topProducts",
    watchKey: "reports.trade.watch.other",
    links: [],
  },
};

export function getShopReportsProfile(businessType: BusinessType): ShopReportsProfile {
  return SHOP_REPORTS[businessType];
}
