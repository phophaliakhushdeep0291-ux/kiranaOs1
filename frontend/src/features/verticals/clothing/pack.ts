import { Shirt } from "lucide-react";
import type { VerticalPack } from "../types";

/**
 * Clothing & fashion.
 *
 * Rentals lives here because renting stock out for a run of days is a garment
 * trade — a kirana or pharmacy shop has no use for it and now cannot reach it.
 *
 * Still to come here: size/colour variants, and exchanges (swapping a garment
 * for another size against the original bill, which is not the same thing as
 * the refund flow in `core/returns`).
 */
export const clothingPack: VerticalPack = {
  id: "clothing",
  label: "Clothing & Fashion",
  businessTypes: ["clothing"],
  paths: ["/rentals"],
  routes: [
    { path: "/rentals", page: "clothing/rentals", featureName: "clothing_rentals" },
  ],
  nav: [
    {
      href: "/rentals",
      label: "shopType.nav.rentals",
      Icon: Shirt,
      insertAfter: "/returns",
      mobile: { group: "Sell", helper: "shopType.nav.rentals.helper" },
    },
  ],
  capabilities: [
    "BASIC_INVENTORY", "PRODUCT_VARIANTS", "EXCHANGES", "ALTERATIONS", "PRODUCT_BUNDLES",
    "QUOTATIONS"
  ],
};
