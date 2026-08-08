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
 * Still to come here: repair tickets as documents of their own rather than a
 * unit parked in `rma`, and picking the specific unit from the billing screen so
 * a sale and its register entry happen in one action instead of two.
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
      label: "IMEI & Serials",
      Icon: ScanLine,
      insertAfter: "/billing",
      mobile: { group: "Sell", helper: "Check a handset, or add units to stock" },
    },
  ],
  capabilities: [
    "BASIC_INVENTORY", "SERIAL_TRACKING", "IMEI_TRACKING", "WARRANTY_TRACKING",
    "REPAIR_TICKETS", "OPEN_BOX_STOCK",
  ],
};
