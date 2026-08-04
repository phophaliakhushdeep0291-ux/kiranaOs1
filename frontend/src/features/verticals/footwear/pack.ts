import type { VerticalPack } from "../types";

/**
 * Footwear & shoes.
 *
 * Shares the variant machinery with clothing but stays its own pack: a shoe is
 * sold by the pair in a size *system* (UK/US/EU), which a garment size chart
 * cannot express. `SIZE_SYSTEMS` and `PAIR_STOCK` are what mark that apart.
 */
export const footwearPack: VerticalPack = {
  id: "footwear",
  label: "Footwear & Shoes",
  businessTypes: ["footwear"],
  paths: [],
  routes: [],
  nav: [],
  capabilities: [
    "BASIC_INVENTORY", "PRODUCT_VARIANTS", "SIZE_SYSTEMS", "PAIR_STOCK", "EXCHANGES",
  ],
};
