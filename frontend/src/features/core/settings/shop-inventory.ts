import type { BusinessType } from "./business-types";
import type { TranslationKey } from "./i18n";
import { BATCH_EXPIRY_LINK, type ShopTradeLink } from "./shop-trade-links";

/**
 * What the stock screen is called in each trade, and which stock screens that
 * trade actually works from.
 *
 * A kirana store counts SKUs on a shelf, a pharmacy counts medicines by batch,
 * a restaurant counts what the kitchen will burn through tonight, and a factory
 * counts raw material on its way to becoming something else. Those are the same
 * numbers with different names and different next steps — so the page stays one
 * screen and only its vocabulary and its onward links move.
 *
 * Copy is held as dictionary KEYS rather than English text. Hindi is the default
 * language here, so per-trade strings written in English would be English for
 * most shops; a trade happy with the generic wording simply points back at the
 * generic key, which is why several entries below repeat `inventory.page.*`.
 *
 * Links are declared as plain paths, never as imports: this module is core, and
 * core may not import a vertical pack (`src/tests/vertical-boundaries.test.ts`).
 * Every path is filtered through the same gate the sidebar uses before it is
 * shown, so a trade route that this shop does not run is never offered.
 */
/** The shape is shared with every other screen that offers a trade shortcut. */
export type ShopInventoryLink = ShopTradeLink;

export interface ShopInventoryProfile {
  /** Heading over the stock list. */
  stockTitleKey: TranslationKey;
  /** The metric that counts rows: SKUs, dishes, medicines, parts. */
  itemsLabelKey: TranslationKey;
  /** The tile that brings stock in. */
  receiveLabelKey: TranslationKey;
  /** The tile that writes stock off — damage, wastage, expiry. */
  wastageLabelKey: TranslationKey;
  /** One line of trade guidance, shown above the stock list. */
  focusKey: TranslationKey;
  /** Where this trade goes next from the stock screen. */
  links: readonly ShopInventoryLink[];
}

// Mirrors the route's own gate in app/routes.tsx and the sidebar's, so a trade
// that sells nothing dated is not sent to a screen it cannot open.
const BATCHES = BATCH_EXPIRY_LINK;

/** Every trade ends up counting the shelf by hand at some point. */
const STOCK_COUNTS: ShopInventoryLink = {
  labelKey: "page.title.inventory.stockcounts",
  href: "/inventory/stock-counts",
};

export const SHOP_INVENTORY: Record<BusinessType, ShopInventoryProfile> = {
  kirana: {
    stockTitleKey: "inventory.page.productStock",
    itemsLabelKey: "inventory.page.totalSkus",
    receiveLabelKey: "inventory.page.addStock",
    wastageLabelKey: "inventory.page.damageTile",
    focusKey: "inventory.trade.kirana.focus",
    links: [BATCHES, STOCK_COUNTS],
  },
  clothing: {
    stockTitleKey: "inventory.trade.clothing.stock",
    itemsLabelKey: "inventory.trade.clothing.items",
    receiveLabelKey: "inventory.page.addStock",
    wastageLabelKey: "inventory.trade.clothing.wastage",
    focusKey: "inventory.trade.clothing.focus",
    links: [STOCK_COUNTS],
  },
  footwear: {
    stockTitleKey: "inventory.trade.footwear.stock",
    itemsLabelKey: "inventory.trade.footwear.items",
    receiveLabelKey: "inventory.trade.footwear.receive",
    wastageLabelKey: "inventory.trade.footwear.wastage",
    focusKey: "inventory.trade.footwear.focus",
    links: [{ labelKey: "inventory.trade.link.sizeRuns", href: "/size-runs" }, STOCK_COUNTS],
  },
  auto_parts: {
    stockTitleKey: "inventory.trade.autoParts.stock",
    itemsLabelKey: "inventory.trade.autoParts.items",
    receiveLabelKey: "inventory.trade.autoParts.receive",
    wastageLabelKey: "inventory.trade.autoParts.wastage",
    focusKey: "inventory.trade.autoParts.focus",
    links: [{ labelKey: "inventory.trade.link.partFinder", href: "/fitment" }, STOCK_COUNTS],
  },
  electronics: {
    stockTitleKey: "inventory.trade.electronics.stock",
    itemsLabelKey: "inventory.trade.electronics.items",
    receiveLabelKey: "inventory.trade.electronics.receive",
    wastageLabelKey: "inventory.trade.electronics.wastage",
    focusKey: "inventory.trade.electronics.focus",
    links: [{ labelKey: "inventory.trade.link.serialUnits", href: "/serial-units" }, STOCK_COUNTS],
  },
  pharmacy: {
    stockTitleKey: "inventory.trade.pharmacy.stock",
    itemsLabelKey: "inventory.trade.pharmacy.items",
    receiveLabelKey: "inventory.trade.pharmacy.receive",
    wastageLabelKey: "inventory.trade.pharmacy.wastage",
    focusKey: "inventory.trade.pharmacy.focus",
    links: [BATCHES, { labelKey: "inventory.trade.link.prescriptions", href: "/prescriptions" }, STOCK_COUNTS],
  },
  stationery: {
    stockTitleKey: "inventory.trade.stationery.stock",
    itemsLabelKey: "inventory.trade.stationery.items",
    receiveLabelKey: "inventory.page.addStock",
    wastageLabelKey: "inventory.trade.stationery.wastage",
    focusKey: "inventory.trade.stationery.focus",
    links: [{ labelKey: "inventory.trade.link.bookLists", href: "/book-lists" }, STOCK_COUNTS],
  },
  furniture: {
    stockTitleKey: "inventory.trade.furniture.stock",
    itemsLabelKey: "inventory.trade.furniture.items",
    receiveLabelKey: "inventory.trade.furniture.receive",
    wastageLabelKey: "inventory.trade.furniture.wastage",
    focusKey: "inventory.trade.furniture.focus",
    links: [{ labelKey: "inventory.trade.link.orderBook", href: "/orders" }, STOCK_COUNTS],
  },
  cosmetics: {
    stockTitleKey: "inventory.trade.cosmetics.stock",
    itemsLabelKey: "inventory.trade.cosmetics.items",
    receiveLabelKey: "inventory.trade.cosmetics.receive",
    wastageLabelKey: "inventory.trade.cosmetics.wastage",
    focusKey: "inventory.trade.cosmetics.focus",
    links: [BATCHES, { labelKey: "inventory.trade.link.testers", href: "/testers" }, STOCK_COUNTS],
  },
  restaurant: {
    stockTitleKey: "inventory.trade.restaurant.stock",
    itemsLabelKey: "inventory.trade.restaurant.items",
    receiveLabelKey: "inventory.trade.restaurant.receive",
    wastageLabelKey: "inventory.trade.restaurant.wastage",
    focusKey: "inventory.trade.restaurant.focus",
    // A kitchen holds dated stock too — the pack carries BATCH_TRACKING for the
    // packaged and perishable ingredients behind the dishes, not for the dishes.
    links: [{ labelKey: "inventory.trade.link.kitchenStock", href: "/kitchen-stock" }, BATCHES, STOCK_COUNTS],
  },
  manufacturing: {
    stockTitleKey: "inventory.trade.manufacturing.stock",
    itemsLabelKey: "inventory.trade.manufacturing.items",
    receiveLabelKey: "inventory.trade.manufacturing.receive",
    wastageLabelKey: "inventory.trade.manufacturing.wastage",
    focusKey: "inventory.trade.manufacturing.focus",
    links: [{ labelKey: "inventory.trade.link.production", href: "/manufacturing" }, BATCHES, STOCK_COUNTS],
  },
  other: {
    stockTitleKey: "inventory.page.productStock",
    itemsLabelKey: "inventory.page.totalSkus",
    receiveLabelKey: "inventory.page.addStock",
    wastageLabelKey: "inventory.page.damageTile",
    focusKey: "inventory.trade.other.focus",
    links: [STOCK_COUNTS],
  },
};

export function getShopInventoryProfile(businessType: BusinessType): ShopInventoryProfile {
  return SHOP_INVENTORY[businessType];
}

/**
 * The trade's own units first, then every other unit the app supports.
 *
 * Ordered rather than filtered on purpose: a shop that changes its business type
 * — or a product created before it did — must still be able to pick the unit its
 * stock is actually held in. A pharmacy simply should not have to scroll past
 * "yard" and "plate" to reach "strip".
 */
export function tradeFirstUnits(primaryUnits: readonly string[], units: readonly string[]): string[] {
  const preferred = primaryUnits.filter((unit) => units.includes(unit));
  return [...new Set([...preferred, ...units])];
}
