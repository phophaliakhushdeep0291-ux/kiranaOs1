import { ScanLine } from "lucide-react";
import type { VerticalPack } from "../types";

/**
 * Electronics & mobiles.
 *
 * Stock here is not fungible: the shop sells *that* handset, identified by IMEI
 * or serial, and a return or warranty claim has to find the same unit again.
 * That is what separates it from every other trade in the app, and it is what
 * the unit register exists for — one row per physical piece, from the day the
 * box is opened to the day cover runs out.
 *
 * The register deliberately does NOT replace the product's stock count. Billing
 * and reports still read `stockBaseQty`; this answers "which one, and where did
 * it go", which a count cannot.
 *
 * Billing selects and reserves each unit with its stock and money transaction.
 * Repair tickets remain a future document workflow beyond a unit parked in `rma`.
 */
export const electronicsPack: VerticalPack = {
  id: "electronics",
  label: "Electronics & Mobiles",
  businessTypes: ["electronics"],
  paths: ["/serial-units"],
  routes: [
    { path: "/serial-units", page: "electronics/units", featureName: "serial_imei_tracking" },
  ],
  nav: [
    {
      href: "/serial-units",
      label: "shopType.nav.serialUnits",
      Icon: ScanLine,
      insertAfter: "/billing",
      mobile: { group: "Sell", helper: "shopType.nav.serialUnits.helper" },
    },
  ],
  billingSlots: ["electronics/units"],
  capabilities: [
    "BASIC_INVENTORY", "SERIAL_TRACKING", "IMEI_TRACKING", "WARRANTY_TRACKING",
    "REPAIR_TICKETS", "OPEN_BOX_STOCK",
  ],
};
