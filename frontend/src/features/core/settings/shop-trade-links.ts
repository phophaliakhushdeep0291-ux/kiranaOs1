import { useMemo } from "react";
import { useIsShopPathVisible } from "./business-profile-bootstrap";
import { useShopCapability, type Capability } from "./capabilities";
import type { TranslationKey } from "./i18n";

/**
 * A shortcut one trade gets on a screen every trade shares.
 *
 * Declared as a plain path, never as an import: these modules are core, and core
 * may not import a vertical pack (`src/tests/vertical-boundaries.test.ts`). The
 * label is a dictionary key for the same reason the trade copy is — Hindi is the
 * default language, so an English literal here would be English for most shops.
 */
export interface ShopTradeLink {
  labelKey: TranslationKey;
  href: string;
  /**
   * Offered only to a shop holding one of these. Absent means "any shop" — the
   * path gate still has the last word.
   */
  capabilities?: readonly Capability[];
}

/**
 * The links this shop may actually follow.
 *
 * Capability first, because it is answered from the pack and is therefore
 * correct offline and on first paint; then the path gate, which applies the
 * owner's module switches, the client's vertical gate and the server's own
 * navigation list. A screen offering a shortcut has to ask everything the
 * sidebar asks, or it becomes the one place in the app that hands a shop a link
 * the sidebar knows it does not have.
 */
export function useVisibleTradeLinks(links: readonly ShopTradeLink[]): ShopTradeLink[] {
  const hasCapability = useShopCapability();
  const isShopPathVisible = useIsShopPathVisible();
  return useMemo(
    () =>
      links.filter(
        (link) =>
          (!link.capabilities || link.capabilities.some(hasCapability))
          && isShopPathVisible(link.href),
      ),
    [hasCapability, isShopPathVisible, links],
  );
}

/**
 * The screens a trade shortcut can point at, written once.
 *
 * Every screen that offers shortcuts — stock, catalogue, reports, receiving —
 * reaches for the same entries, so one name per screen is enough. Declared here
 * rather than inline per profile because a second copy of "Size runs" is a
 * second place for it to be renamed, and the two would then disagree depending
 * on which page an owner happened to be standing on.
 */

/** Batch & expiry, gated exactly as its route and the sidebar gate it. */
export const BATCH_EXPIRY_LINK: ShopTradeLink = {
  labelKey: "inventory.page.batchExpiry",
  href: "/inventory/batches",
  capabilities: ["BATCH_TRACKING", "EXPIRY_TRACKING"],
};

/** Every trade ends up counting the shelf by hand at some point. */
export const STOCK_COUNTS_LINK: ShopTradeLink = { labelKey: "page.title.inventory.stockcounts", href: "/inventory/stock-counts" };
/** How every trade groups its catalogue, whatever the rows are called. */
export const CATEGORIES_LINK: ShopTradeLink = { labelKey: "products.trade.link.categories", href: "/categories" };

export const SIZE_RUNS_LINK: ShopTradeLink = { labelKey: "inventory.trade.link.sizeRuns", href: "/size-runs" };
export const PART_FINDER_LINK: ShopTradeLink = { labelKey: "inventory.trade.link.partFinder", href: "/fitment" };
export const SERIAL_UNITS_LINK: ShopTradeLink = { labelKey: "inventory.trade.link.serialUnits", href: "/serial-units" };
export const PRESCRIPTIONS_LINK: ShopTradeLink = { labelKey: "inventory.trade.link.prescriptions", href: "/prescriptions" };
export const BOOK_LISTS_LINK: ShopTradeLink = { labelKey: "inventory.trade.link.bookLists", href: "/book-lists" };
export const ORDER_BOOK_LINK: ShopTradeLink = { labelKey: "inventory.trade.link.orderBook", href: "/orders" };
export const TESTERS_LINK: ShopTradeLink = { labelKey: "inventory.trade.link.testers", href: "/testers" };
export const KITCHEN_STOCK_LINK: ShopTradeLink = { labelKey: "inventory.trade.link.kitchenStock", href: "/kitchen-stock" };
export const PRODUCTION_LINK: ShopTradeLink = { labelKey: "inventory.trade.link.production", href: "/manufacturing" };
export const MENU_LINK: ShopTradeLink = { labelKey: "products.trade.link.menu", href: "/menu" };
