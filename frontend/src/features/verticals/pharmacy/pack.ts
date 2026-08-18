import { Stethoscope } from "lucide-react";
import type { VerticalPack } from "../types";

/**
 * Pharmacy & medical.
 *
 * The prescription register lives here because it is the one record only a
 * chemist keeps: Schedule H, H1 and X medicines may not be sold without it, and
 * it is what a drug inspector asks to see. It is a record rather than a
 * transaction — the sale itself is an ordinary bill, linked back by `billId`.
 *
 * Batch and expiry tracking deliberately does NOT live here. It stays in
 * `core/inventory` behind the `BATCH_TRACKING`/`EXPIRY_TRACKING` capabilities,
 * which kirana and cosmetics also carry — dated stock is not a chemist's
 * private problem, so the code cannot live in this folder.
 *
 * Still to come here: a `drugSchedule` flag on the medicine itself, so billing
 * can stop a Schedule H sale that has no register entry rather than relying on
 * the counter to remember, and salt/generic substitution.
 */
export const pharmacyPack: VerticalPack = {
  id: "pharmacy",
  label: "Pharmacy & Medical",
  businessTypes: ["pharmacy"],
  paths: ["/prescriptions"],
  routes: [
    { path: "/prescriptions", page: "pharmacy/prescriptions", featureName: "prescription_tracking" },
  ],
  nav: [
    {
      href: "/prescriptions",
      label: "shopType.nav.prescriptions",
      Icon: Stethoscope,
      insertAfter: "/billing",
      mobile: { group: "Sell", helper: "shopType.nav.prescriptions.helper" },
    },
  ],
  // Contributes the prescription control to shared billing, so core never
  // imports pharmacy. Named rather than imported — see `VerticalSlotId`.
  // Server twin: shared/sale-guards.js.
  billingSlots: ["pharmacy/prescription"],
  capabilities: [
    "BASIC_INVENTORY", "BATCH_TRACKING", "EXPIRY_TRACKING", "PRESCRIPTION_TRACKING",
    "MEDICINE_SUBSTITUTES", "SUPPLIER_RETURNS",
  ],
};
