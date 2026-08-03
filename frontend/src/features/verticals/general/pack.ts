import type { VerticalPack } from "../types";

/**
 * The trades that have no exclusive features of their own — they run on the
 * core spine alone, relabelled by `business-types`.
 *
 * This pack is what stops a shop type from falling off the end of the registry:
 * every BusinessType must be claimed by exactly one pack, and this one claims
 * the remainder. When one of these trades grows features that only it wants,
 * give it its own pack and drop it from this list.
 */
export const generalPack: VerticalPack = {
  id: "general",
  label: "General Retail",
  businessTypes: ["footwear", "auto_parts", "electronics", "stationery", "furniture", "cosmetics", "other"],
  paths: [],
  routes: [],
  nav: [],
};
