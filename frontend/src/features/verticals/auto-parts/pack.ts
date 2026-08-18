import { Car } from "lucide-react";
import type { VerticalPack } from "../types";

/**
 * Auto parts & hardware.
 *
 * The trade's distinguishing question is "does this part fit?", which nothing
 * in the shared catalogue can answer — hence `VEHICLE_FITMENT` and
 * `ALTERNATIVE_PARTS`. A hardware shop runs the same pack with fitment unused,
 * which is why the screen is gated on the capability rather than the trade.
 *
 * The fitment book is reference data, not stock: it records which vehicles a
 * part fits and what else will do when the right one is not on the shelf. That
 * is knowledge which today lives only in the head of whoever is behind the
 * counter, and walks out of the door with them.
 *
 * Still to come here: rack locations (`RACK_LOCATIONS` — "bin 14, third shelf"),
 * and reaching fitment from the billing screen so a counter can search by
 * vehicle mid-bill instead of in another tab.
 */
export const autoPartsPack: VerticalPack = {
  id: "auto-parts",
  label: "Auto Parts & Hardware",
  businessTypes: ["auto_parts"],
  paths: ["/fitment"],
  routes: [
    { path: "/fitment", page: "auto-parts/fitment", featureName: "vehicle_fitment" },
  ],
  nav: [
    {
      href: "/fitment",
      label: "shopType.nav.fitment",
      Icon: Car,
      insertAfter: "/billing",
      mobile: { group: "Sell", helper: "shopType.nav.fitment.helper" },
    },
  ],
  capabilities: [
    "BASIC_INVENTORY", "VEHICLE_FITMENT", "ALTERNATIVE_PARTS", "RACK_LOCATIONS",
    "WHOLESALE_PRICING", "QUOTATIONS", "WARRANTY_TRACKING",
  ],
};
