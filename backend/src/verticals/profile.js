export const BUSINESS_TYPES = [
  "kirana", "clothing", "footwear", "auto_parts", "electronics",
  "pharmacy", "stationery", "furniture", "cosmetics", "restaurant", "other",
];

export const CAPABILITIES = [
  "BASIC_INVENTORY", "LOOSE_ITEMS", "UDHAR", "PRODUCT_VARIANTS",
  "BATCH_TRACKING", "EXPIRY_TRACKING", "SERIAL_TRACKING",
  "WARRANTY_TRACKING", "VEHICLE_FITMENT", "QUOTATIONS",
  "DELIVERY_ORDERS", "TABLE_MANAGEMENT", "KOT", "RECIPE_INVENTORY",
];

const KNOWN_CAPABILITIES = new Set(CAPABILITIES);

export function defineBusinessProfile({ businessType, engine, capabilities, navigation }) {
  if (!BUSINESS_TYPES.includes(businessType)) throw new Error(`Unknown business type: ${businessType}`);
  if (!isEngineId(engine)) throw new Error(`${businessType} uses unknown engine: ${engine}`);
  const unknown = capabilities.filter((capability) => !KNOWN_CAPABILITIES.has(capability));
  if (unknown.length) throw new Error(`${businessType} has unknown capabilities: ${unknown.join(", ")}`);
  return Object.freeze({
    businessType,
    engine,
    capabilities: Object.freeze([...capabilities]),
    navigation: Object.freeze([...navigation]),
  });
}

export const SHARED_RETAIL_NAVIGATION = Object.freeze([
  "dashboard", "billing", "products", "inventory", "customers",
  "purchases", "sales", "returns", "reports",
]);
import { isEngineId } from "../engines/catalog.js";
