/**
 * Trade-specific sidebar entries for Kirana / general store. The shared spine
 * (dashboard, customers, purchases, money, staff, settings) is composed on by
 * `defineBusinessProfile` and must not be repeated here.
 */
export const navigation = [
  "billing",
  "products",
  "inventory",
  // A kirana shop sells dated stock — dairy, atta, packaged food — and the pack
  // carries BATCH_TRACKING/EXPIRY_TRACKING to say so. The keys were missing here,
  // and the client papered over it by letting plain "inventory" unlock the
  // Batch & Expiry screen, which handed it to every trade including garments.
  "batches",
  "expiry",
  "udhar",
  "daily-closing",
];

export default navigation;
