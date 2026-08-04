import { ChefHat, LayoutGrid } from "lucide-react";
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
 * Still to come here: modifiers as first-class options rather than line notes,
 * recipe-level stock depletion, and splitting one table's bill across guests.
 */
export const restaurantPack: VerticalPack = {
  id: "restaurant",
  label: "Restaurant & Café",
  businessTypes: ["restaurant"],
  paths: ["/tables", "/kitchen"],
  routes: [
    { path: "/tables", page: "restaurant/tables" },
    { path: "/kitchen", page: "restaurant/kitchen" },
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
      insertAfter: "/tables",
      mobile: { group: "Sell", helper: "Work off the kitchen tickets" },
    },
  ],
  capabilities: [
    "BASIC_INVENTORY", "TABLE_MANAGEMENT", "KOT", "KITCHEN_DISPLAY",
    "MENU_MODIFIERS", "RECIPE_INVENTORY", "SPLIT_BILLING", "TAKEAWAY",
    "DELIVERY_ORDERS",
  ],
};
