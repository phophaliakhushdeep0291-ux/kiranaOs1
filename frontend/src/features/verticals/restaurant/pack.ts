import { ChefHat, LayoutGrid, Soup, Utensils } from "lucide-react";
import type { VerticalPack } from "../types";

/**
 * Restaurant & café.
 *
 * Tables (a bill that stays open against a seat), KOT (the kitchen ticket a
 * table's items fire to), and the kitchen display are the three pieces, and
 * they hang together: a table holds the open bill, KOT is how it reaches the
 * kitchen, and the display is where it is worked off.
 *
 * A table's order is deliberately not a new document — it is the parked cart
 * (`HeldBill`) the counter already uses, so a table sale settles through the
 * same pricing, tax, tender and sync path as every other bill. See
 * `service/table-store.ts`.
 *
 * Two more screens exist because a kitchen is not a shelf:
 *
 * - **Menu** owns what a menu adds and a catalogue has no word for — course,
 *   veg mark, spice, kitchen time, and the "86" switch that says "run out
 *   tonight" rather than "we don't sell this".
 * - **Kitchen stock** owns the recipes. Without them a restaurant's inventory is
 *   fiction: the POS decrements the dish, and nobody buys or stores a dish.
 *
 * Configured add-ons are first-class cart and bill rows; splitting one table's
 * bill across guests remains a separate settlement concern.
 */
export const restaurantPack: VerticalPack = {
  id: "restaurant",
  label: "Restaurant & Café",
  businessTypes: ["restaurant"],
  paths: ["/tables", "/kitchen", "/menu", "/kitchen-stock"],
  routes: [
    { path: "/tables", page: "restaurant/tables", featureName: "restaurant_tables" },
    { path: "/kitchen", page: "restaurant/kitchen", featureName: "restaurant_kot" },
    { path: "/menu", page: "restaurant/menu", featureName: "restaurant_menu" },
    { path: "/kitchen-stock", page: "restaurant/kitchen-stock", featureName: "restaurant_recipe_inventory" },
  ],
  nav: [
    {
      href: "/tables",
      label: "Tables",
      Icon: LayoutGrid,
      insertAfter: "/billing",
      mobile: { group: "Sell", helper: "Seat a table and open its order" },
    },
    {
      href: "/kitchen",
      label: "Kitchen",
      Icon: ChefHat,
      // Anchored to the core entry, not to "/tables": the sidebar only splices
      // after items in the shared list, so anchoring to a sibling vertical entry
      // would drop this one to the tail. Pack order keeps Tables ahead of it.
      insertAfter: "/billing",
      mobile: { group: "Sell", helper: "Work off the kitchen tickets" },
    },
    {
      href: "/menu",
      label: "Menu",
      Icon: Utensils,
      // Anchored to the catalogue rather than to a sibling vertical entry: the
      // menu IS this trade's catalogue view, and it reads next to Products.
      insertAfter: "/products",
      mobile: { group: "Catalogue", helper: "Courses, veg marks and tonight's 86 list" },
    },
    {
      href: "/kitchen-stock",
      label: "Kitchen stock",
      Icon: Soup,
      insertAfter: "/products",
      mobile: { group: "Catalogue", helper: "Recipes, what's left and what can't be served" },
    },
  ],
  // Contributes the add-on dialog to shared billing, so core never imports
  // restaurant. Named rather than imported — see `VerticalSlotId`.
  billingSlots: ["restaurant/addons"],
  capabilities: [
    // Mirrors backend/src/verticals/restaurant/capabilities.js. The two lists
    // are read by DIFFERENT gates and must agree: this one drives
    // `useShopCapability` (which fields the product form offers), while the
    // server's drives the sidebar's `isPathAllowedByCapabilities`.
    "BASIC_INVENTORY", "BATCH_TRACKING", "EXPIRY_TRACKING",
    "TABLE_MANAGEMENT", "KOT", "KITCHEN_DISPLAY",
    "MENU_MODIFIERS", "RECIPE_INVENTORY", "SPLIT_BILLING", "TAKEAWAY",
    "DELIVERY_ORDERS",
  ],
};
