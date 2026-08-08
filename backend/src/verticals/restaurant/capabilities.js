/** Features enabled for a Restaurant & cafe shop. */
export const capabilities = [
  "BASIC_INVENTORY",
  // A kitchen keeps the most perishable stock of any trade here — dairy, meat,
  // produce — so it tracks supplier lots and use-by dates like a chemist does.
  // These also unlock /inventory/batches, which is gated on the CAPABILITY
  // rather than on a navigation key (see isPathAllowedByCapabilities).
  "BATCH_TRACKING",
  "EXPIRY_TRACKING",
  "TABLE_MANAGEMENT",
  "KOT",
  "KITCHEN_DISPLAY",
  "MENU_MODIFIERS",
  "RECIPE_INVENTORY",
  "SPLIT_BILLING",
  "TAKEAWAY",
  "DELIVERY_ORDERS",
];

export default capabilities;
