import { AppError } from "../shared/errors/index.js";
import { BUSINESS_TYPES, CAPABILITIES } from "./profile.js";
import kirana from "./kirana/profile.js";
import clothing from "./clothing/profile.js";
import footwear from "./footwear/profile.js";
import autoParts from "./auto-parts/profile.js";
import electronics from "./electronics/profile.js";
import pharmacy from "./pharmacy/profile.js";
import stationery from "./stationery-books/profile.js";
import furniture from "./furniture-home/profile.js";
import cosmetics from "./beauty-cosmetics/profile.js";
import restaurant from "./restaurant/profile.js";
import custom from "./custom/profile.js";

export { BUSINESS_TYPES, CAPABILITIES } from "./profile.js";

export const BUSINESS_PROFILE_LIST = Object.freeze([
  kirana, clothing, footwear, autoParts, electronics, pharmacy,
  stationery, furniture, cosmetics, restaurant, custom,
]);

/**
 * Where each business type's code lives.
 *
 * The directory names read as trade names; the `businessType` keys are written
 * into every shop's settingsJson and cannot move without a data migration. Four
 * of them therefore differ, and this map is the only place that knows it —
 * anything resolving a path from a type reads it from here rather than guessing.
 */
export const BUSINESS_TYPE_DIRECTORIES = Object.freeze({
  kirana: "kirana",
  clothing: "clothing",
  footwear: "footwear",
  auto_parts: "auto-parts",
  electronics: "electronics",
  pharmacy: "pharmacy",
  stationery: "stationery-books",
  furniture: "furniture-home",
  cosmetics: "beauty-cosmetics",
  restaurant: "restaurant",
  other: "custom",
});

export const BUSINESS_PROFILES = Object.freeze(Object.fromEntries(
  BUSINESS_PROFILE_LIST.map((profile) => [profile.businessType, profile]),
));

assertCompleteRegistry();

function assertCompleteRegistry() {
  const registered = BUSINESS_PROFILE_LIST.map((profile) => profile.businessType);
  const duplicates = registered.filter((type, index) => registered.indexOf(type) !== index);
  const missing = BUSINESS_TYPES.filter((type) => !registered.includes(type));
  if (duplicates.length || missing.length) {
    throw new Error(`Invalid business-profile registry. Missing: ${missing.join(", ") || "none"}; duplicates: ${[...new Set(duplicates)].join(", ") || "none"}`);
  }
}

export function normalizeBusinessType(value) {
  return BUSINESS_TYPES.includes(value) ? value : null;
}

export function settingsForBusinessType(businessType, existing = {}) {
  const key = normalizeBusinessType(businessType);
  if (!key) throw new AppError("Select a supported business type", 422, "INVALID_BUSINESS_TYPE");
  const selected = BUSINESS_PROFILES[key];
  const existingType = businessTypeFromSettings(existing);
  const allowedCapabilities = key === "other" ? CAPABILITIES : selected.capabilities;
  const capabilities = existingType === key && Array.isArray(existing.businessProfile?.capabilities)
    ? existing.businessProfile.capabilities.filter((capability) => allowedCapabilities.includes(capability))
    : [...selected.capabilities];
  return {
    ...existing,
    storeProfile: { ...(existing.storeProfile ?? {}), businessTypeKey: key },
    businessProfile: {
      businessType: key,
      engine: selected.engine,
      profileVersion: 1,
      capabilities,
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
    engine: preset.engine,
    capabilities: configured,
    navigation: [...preset.navigation],
    setupStatus: settings.businessProfile?.setupStatus ?? "pending",
  };
}

export function hasCapability(shop, capability) {
  return bootstrapForShop(shop, null).capabilities.includes(capability);
}
