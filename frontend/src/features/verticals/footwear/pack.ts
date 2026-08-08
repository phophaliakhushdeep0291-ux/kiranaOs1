import { Footprints } from "lucide-react";
import type { VerticalPack } from "../types";

/**
 * Footwear & shoes.
 *
 * Shares the variant machinery with clothing but stays its own pack: a shoe is
 * sold by the pair in a size *system* (UK/US/EU), which a garment size chart
 * cannot express. `SIZE_SYSTEMS` and `PAIR_STOCK` are what mark that apart.
 *
 * The size-run screen deliberately holds no stock of its own. A run is read from
 * the variant grid core already has — a Size axis on the Product, one selling
 * unit per size carrying its own `onHandQty` — so pairs live in exactly one
 * place. What this pack adds is the one thing those variants cannot say: whether
 * the numbers on them are UK, EU, US or centimetres, and therefore what a
 * customer's own number means against them.
 *
 * Still to come here: exchanges (swapping a pair for another size against the
 * original bill, which is not the refund flow in `core/returns`), and reaching
 * the size grid from the billing screen mid-sale.
 */
export const footwearPack: VerticalPack = {
  id: "footwear",
  label: "Footwear & Shoes",
  businessTypes: ["footwear"],
  paths: ["/size-runs"],
  routes: [
    { path: "/size-runs", page: "footwear/size-runs", featureName: "footwear_size_runs" },
  ],
  nav: [
    {
      href: "/size-runs",
      label: "Size Runs",
      Icon: Footprints,
      insertAfter: "/inventory",
      mobile: { group: "Stock & buying", helper: "Find a size, and see the gaps in each run" },
    },
  ],
  capabilities: [
    "BASIC_INVENTORY", "PRODUCT_VARIANTS", "SIZE_SYSTEMS", "PAIR_STOCK", "EXCHANGES",
  ],
};
