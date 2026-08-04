import type { VerticalPack } from "../types";

/**
 * Restaurant & café.
 *
 * Registered but empty — none of it is built yet. Tables (a bill that stays
 * open against a seat), KOT (the kitchen ticket a table's items print to), and
 * the kitchen display are the three pieces, and they hang together: a table
 * holds the open bill, KOT is how it reaches the kitchen, and the display is
 * where it is worked off.
 *
 * The pack exists now so that work lands in one place instead of being sprayed
 * across billing and the layout.
 */
export const restaurantPack: VerticalPack = {
  id: "restaurant",
  label: "Restaurant & Café",
  businessTypes: ["restaurant"],
  paths: [],
  routes: [],
  nav: [],
  capabilities: [
    "BASIC_INVENTORY", "TABLE_MANAGEMENT", "KOT", "KITCHEN_DISPLAY",
    "MENU_MODIFIERS", "RECIPE_INVENTORY", "SPLIT_BILLING", "TAKEAWAY",
    "DELIVERY_ORDERS",
  ],
};
