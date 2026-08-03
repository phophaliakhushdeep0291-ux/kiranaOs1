import type { VerticalPack } from "../types";

/**
 * Pharmacy & medical.
 *
 * Deliberately empty. Batch and expiry tracking stays in `core/inventory`:
 * `shop-workflows` recommends it for cosmetics as well as pharmacy, and dated
 * food and dairy make it useful to a kirana shop too. It is gated by the
 * `batch_expiry` plan feature, not by trade.
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
};
