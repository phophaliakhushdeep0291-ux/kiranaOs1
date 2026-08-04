import type { VerticalPack } from "../types";

/**
 * Pharmacy & medical.
 *
 * No exclusive screens yet. Batch and expiry tracking stays in `core/inventory`
 * and is reached through the `BATCH_TRACKING`/`EXPIRY_TRACKING` capabilities,
 * which kirana and cosmetics also carry — dated stock is not a chemist's
 * private problem, so the code cannot live in this folder.
 *
 * What belongs here is what only a chemist needs — prescription capture,
 * schedule-H register, salt/generic substitution.
 */
export const pharmacyPack: VerticalPack = {
  id: "pharmacy",
  label: "Pharmacy & Medical",
  businessTypes: ["pharmacy"],
  paths: [],
  routes: [],
  nav: [],
  capabilities: [
    "BASIC_INVENTORY", "BATCH_TRACKING", "EXPIRY_TRACKING", "PRESCRIPTION_TRACKING",
    "MEDICINE_SUBSTITUTES", "SUPPLIER_RETURNS",
  ],
};
