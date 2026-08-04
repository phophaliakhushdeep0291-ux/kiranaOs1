import type { VerticalPack } from "../types";

/**
 * Kirana / general store — the trade the app was first built for.
 *
 * Deliberately empty. The two things a kirana shop is known for, loose selling
 * and udhar, are *not* kirana-exclusive and must not be moved here:
 *
 * - Loose / selling-unit handling runs through billing, products, inventory,
 *   pricing, purchases, reports and returns. A fabric shop sells by the metre
 *   and a pharmacy by the strip on exactly the same machinery.
 * - Udhar is every shop's credit ledger. Clothing calls it "Credit", pharmacy
 *   "Patient Accounts", restaurant "Tabs" — one implementation in
 *   `core/customers` + `core/ledger`, relabelled per trade in `business-types`.
 *
 * What belongs here is anything only a kirana shop would ever want.
 */
export const kiranaPack: VerticalPack = {
  id: "kirana",
  label: "Kirana / General Store",
  businessTypes: ["kirana"],
  paths: [],
  routes: [],
  nav: [],
  capabilities: [
    "BASIC_INVENTORY", "LOOSE_ITEMS", "PACK_CONVERSION", "NEGATIVE_STOCK", "UDHAR",
    "SPLIT_PAYMENTS", "DAILY_CLOSING", "BATCH_TRACKING", "EXPIRY_TRACKING"
  ],
};
