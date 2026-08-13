import { isEngineId } from "../engines/catalog.js";

export const BUSINESS_TYPES = [
  "kirana", "clothing", "footwear", "auto_parts", "electronics",
  "pharmacy", "stationery", "furniture", "cosmetics", "restaurant", "manufacturing", "other",
];

export const CAPABILITIES = [
  // Baseline
  "BASIC_INVENTORY", "LOOSE_ITEMS", "PACK_CONVERSION", "NEGATIVE_STOCK",
  "UDHAR", "SPLIT_PAYMENTS", "DAILY_CLOSING",
  // Variants
  "PRODUCT_VARIANTS", "SIZE_SYSTEMS", "PAIR_STOCK", "EXCHANGES", "ALTERATIONS",
  // Batch / expiry
  "BATCH_TRACKING", "EXPIRY_TRACKING", "SUPPLIER_RETURNS",
  // Serialised goods
  "SERIAL_TRACKING", "IMEI_TRACKING", "WARRANTY_TRACKING", "REPAIR_TICKETS",
  "OPEN_BOX_STOCK",
  // Parts & fitment
  "VEHICLE_FITMENT", "ALTERNATIVE_PARTS", "RACK_LOCATIONS", "WHOLESALE_PRICING",
  // Pharmacy
  "PRESCRIPTION_TRACKING", "MEDICINE_SUBSTITUTES",
  // Books & institutional
  "ISBN_CATALOG", "ACADEMIC_BOOK_LISTS", "PRODUCT_BUNDLES", "INSTITUTIONAL_ORDERS",
  // Order-driven retail
  "QUOTATIONS", "SALES_ORDERS", "CUSTOM_ORDERS", "ADVANCE_PAYMENTS",
  "STOCK_RESERVATION", "DELIVERY_ORDERS", "INSTALLATION_TRACKING",
  // Beauty
  "TESTER_STOCK", "LOYALTY",
  // Restaurant
  "TABLE_MANAGEMENT", "KOT", "KITCHEN_DISPLAY", "MENU_MODIFIERS",
  "RECIPE_INVENTORY", "SPLIT_BILLING", "TAKEAWAY",
  // Manufacturing, wholesale and export
  "BOM", "PRODUCTION_RUNS", "BATCH_GENEALOGY", "PACKAGING_SKUS",
  "QUALITY_CONTROL", "WASTAGE_TRACKING", "WHOLESALE_ORDERS", "EXPORT_DOCUMENTS",
  // Configurable
  "CUSTOM_FIELDS",
];

/**
 * Every navigation key a profile may declare. The client maps these onto route
 * paths, so a typo here is invisible at runtime — it just silently hides a
 * screen. Validating against this list turns that into a boot failure instead.
 */
export const NAVIGATION_KEYS = [
  // Shared spine
  "dashboard", "customers", "purchases", "suppliers", "sales", "returns",
  "reports", "cash-payments", "expenses", "staff", "settings",
  // Selling surface
  "billing", "pos", "products", "inventory", "menu",
  // Trade-specific
  "udhar", "daily-closing",
  "variants", "size-color-matrix", "exchanges", "alterations", "collections", "rentals",
  "medicines", "batches", "expiry", "prescriptions",
  "serial-numbers", "warranty", "repairs", "defective-stock",
  "part-compatibility", "rack-locations",
  "books", "stationery", "book-sets", "schools-classes", "institutional-orders",
  "quotations", "sales-orders", "custom-orders", "delivery", "installation", "warehouses",
  "shades-variants", "tester-stock", "loyalty", "offers",
  "tables", "orders", "kitchen-kot", "recipes", "takeaway", "reservations",
  "manufacturing", "bom", "production-runs", "packaging-runs", "traceability", "wholesale-orders", "export-documents",
  "custom-fields",
];

/**
 * The spine every shop gets regardless of trade. Authentication, customers,
 * purchasing, money and staff are not trade features, so no vertical should
 * have to remember to list them — and a vertical that forgets must not lose
 * them. Composed onto every profile by `defineBusinessProfile`.
 */
export const SHARED_NAVIGATION = Object.freeze([
  "dashboard", "customers", "purchases", "suppliers", "sales", "returns",
  "reports", "cash-payments", "expenses", "staff", "settings",
]);

/** Trade screens lead; the shared spine follows, in a stable order, no repeats. */
export function buildNavigation(verticalItems = [], sharedItems = SHARED_NAVIGATION) {
  return [...new Set([...verticalItems, ...sharedItems])];
}

const KNOWN_CAPABILITIES = new Set(CAPABILITIES);
const KNOWN_NAVIGATION_KEYS = new Set(NAVIGATION_KEYS);

export function defineBusinessProfile({ businessType, engine, capabilities, navigation }) {
  if (!BUSINESS_TYPES.includes(businessType)) throw new Error(`Unknown business type: ${businessType}`);
  if (!isEngineId(engine)) throw new Error(`${businessType} uses unknown engine: ${engine}`);

  const unknownCapabilities = capabilities.filter((capability) => !KNOWN_CAPABILITIES.has(capability));
  if (unknownCapabilities.length) throw new Error(`${businessType} has unknown capabilities: ${unknownCapabilities.join(", ")}`);

  const unknownKeys = navigation.filter((key) => !KNOWN_NAVIGATION_KEYS.has(key));
  if (unknownKeys.length) throw new Error(`${businessType} has unknown navigation keys: ${unknownKeys.join(", ")}`);

  return Object.freeze({
    businessType,
    engine,
    capabilities: Object.freeze([...capabilities]),
    /** Trade-specific entries only — what this vertical adds to the spine. */
    verticalNavigation: Object.freeze([...navigation]),
    /** What the client actually filters on: trade entries plus the shared spine. */
    navigation: Object.freeze(buildNavigation(navigation)),
  });
}
