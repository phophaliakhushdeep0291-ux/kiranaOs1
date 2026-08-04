import type { VerticalPack } from "../types";

/**
 * Auto parts & hardware.
 *
 * The trade's distinguishing question is "does this part fit?", which nothing
 * in the shared catalogue can answer — hence `VEHICLE_FITMENT` and
 * `ALTERNATIVE_PARTS`. A hardware shop runs the same pack with fitment unused.
 */
export const autoPartsPack: VerticalPack = {
  id: "auto-parts",
  label: "Auto Parts & Hardware",
  businessTypes: ["auto_parts"],
  paths: [],
  routes: [],
  nav: [],
  capabilities: [
    "BASIC_INVENTORY", "VEHICLE_FITMENT", "ALTERNATIVE_PARTS", "RACK_LOCATIONS",
    "WHOLESALE_PRICING", "QUOTATIONS", "WARRANTY_TRACKING",
  ],
};
