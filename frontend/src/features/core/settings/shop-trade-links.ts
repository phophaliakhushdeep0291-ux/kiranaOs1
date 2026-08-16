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

/** Batch & expiry, gated exactly as its route and the sidebar gate it. */
export const BATCH_EXPIRY_LINK: ShopTradeLink = {
  labelKey: "inventory.page.batchExpiry",
  href: "/inventory/batches",
  capabilities: ["BATCH_TRACKING", "EXPIRY_TRACKING"],
};
