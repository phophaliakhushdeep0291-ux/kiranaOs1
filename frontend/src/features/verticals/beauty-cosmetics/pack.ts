import type { VerticalPack } from "../types";

/**
 * Beauty & cosmetics.
 *
 * Shade is a variant axis, and stock is dated — which is why this trade carries
 * `BATCH_TRACKING`/`EXPIRY_TRACKING` alongside pharmacy and kirana, and why
 * neither of those belongs to any single vertical. Testers are stock that is
 * never sold, so they are counted apart from what is.
 */
export const cosmeticsPack: VerticalPack = {
  id: "beauty-cosmetics",
  label: "Beauty & Cosmetics",
  businessTypes: ["cosmetics"],
  paths: [],
  routes: [],
  nav: [],
  capabilities: [
    "BASIC_INVENTORY", "PRODUCT_VARIANTS", "BATCH_TRACKING", "EXPIRY_TRACKING",
    "TESTER_STOCK", "LOYALTY", "PRODUCT_BUNDLES",
  ],
};
