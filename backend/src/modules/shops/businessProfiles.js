import { AppError } from "../../middleware/error.js";

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

const sharedRetailNav = ["dashboard", "billing", "products", "inventory", "customers", "purchases", "sales", "returns", "reports"];

export const BUSINESS_PROFILES = Object.freeze({
  kirana: profile("RETAIL", ["BASIC_INVENTORY", "LOOSE_ITEMS", "UDHAR", "BATCH_TRACKING", "EXPIRY_TRACKING"], ["dashboard", "billing", "inventory", "customers", "purchases", "sales", "returns", "reports", "cash-payments", "expenses"]),
  clothing: profile("VARIANT_RETAIL", ["BASIC_INVENTORY", "PRODUCT_VARIANTS", "QUOTATIONS"], ["dashboard", "billing", "products", "variants", "inventory", "customers", "purchases", "exchanges", "rentals", "sales", "reports"]),
  footwear: profile("VARIANT_RETAIL", ["BASIC_INVENTORY", "PRODUCT_VARIANTS"], ["dashboard", "billing", "products", "variants", "inventory", "customers", "purchases", "exchanges", "sales", "reports"]),
  auto_parts: profile("FITMENT_RETAIL", ["BASIC_INVENTORY", "VEHICLE_FITMENT", "QUOTATIONS", "WARRANTY_TRACKING"], [...sharedRetailNav, "quotations"]),
  electronics: profile("SERIALIZED_RETAIL", ["BASIC_INVENTORY", "SERIAL_TRACKING", "WARRANTY_TRACKING"], ["dashboard", "billing", "products", "serial-numbers", "inventory", "warranty", "purchases", "returns", "reports"]),
  pharmacy: profile("BATCH_RETAIL", ["BASIC_INVENTORY", "BATCH_TRACKING", "EXPIRY_TRACKING"], ["dashboard", "billing", "medicines", "batches", "expiry", "purchases", "customers", "prescriptions", "returns", "reports"]),
  stationery: profile("RETAIL", ["BASIC_INVENTORY", "LOOSE_ITEMS", "QUOTATIONS"], sharedRetailNav),
  furniture: profile("ORDER_RETAIL", ["BASIC_INVENTORY", "QUOTATIONS", "DELIVERY_ORDERS", "PRODUCT_VARIANTS"], [...sharedRetailNav, "quotations", "delivery"]),
  cosmetics: profile("VARIANT_BATCH_RETAIL", ["BASIC_INVENTORY", "PRODUCT_VARIANTS", "BATCH_TRACKING", "EXPIRY_TRACKING"], sharedRetailNav),
  restaurant: profile("RESTAURANT", ["TABLE_MANAGEMENT", "KOT", "RECIPE_INVENTORY", "DELIVERY_ORDERS"], ["dashboard", "pos", "tables", "orders", "kitchen-kot", "menu", "inventory", "customers", "delivery", "reports", "expenses"]),
  other: profile("CONFIGURABLE_RETAIL", ["BASIC_INVENTORY"], sharedRetailNav),
});

function profile(engine, capabilities, navigation) {
  return Object.freeze({ engine, capabilities: Object.freeze(capabilities), navigation: Object.freeze(navigation) });
}

export function normalizeBusinessType(value) {
  return BUSINESS_TYPES.includes(value) ? value : null;
}

export function settingsForBusinessType(businessType, existing = {}) {
  const key = normalizeBusinessType(businessType);
  if (!key) throw new AppError("Select a supported business type", 422, "INVALID_BUSINESS_TYPE");
  const selected = BUSINESS_PROFILES[key];
  return {
    ...existing,
    storeProfile: { ...(existing.storeProfile ?? {}), businessTypeKey: key },
    businessProfile: {
      businessType: key,
      engine: selected.engine,
      profileVersion: 1,
      capabilities: [...selected.capabilities],
      setupStatus: existing.businessProfile?.setupStatus ?? "pending",
    },
  };
}

export function parseShopSettings(settingsJson) {
  try {
    const parsed = JSON.parse(settingsJson || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function businessTypeFromSettings(settings) {
  return normalizeBusinessType(settings?.businessProfile?.businessType)
    ?? normalizeBusinessType(settings?.storeProfile?.businessTypeKey)
    ?? "kirana";
}

export function bootstrapForShop(shop, role) {
  const settings = parseShopSettings(shop.settingsJson);
  const businessType = businessTypeFromSettings(settings);
  const preset = BUSINESS_PROFILES[businessType];
  const configured = Array.isArray(settings.businessProfile?.capabilities)
    ? settings.businessProfile.capabilities.filter((item) => CAPABILITIES.includes(item) && (preset.capabilities.includes(item) || businessType === "other"))
    : [...preset.capabilities];
  return {
    shop: { id: shop.id, name: shop.name, businessType, profileVersion: settings.businessProfile?.profileVersion ?? 1 },
    role,
    engine: settings.businessProfile?.engine ?? preset.engine,
    capabilities: configured,
    navigation: [...preset.navigation],
    setupStatus: settings.businessProfile?.setupStatus ?? "pending",
  };
}

export function hasCapability(shop, capability) {
  return bootstrapForShop(shop, null).capabilities.includes(capability);
}
