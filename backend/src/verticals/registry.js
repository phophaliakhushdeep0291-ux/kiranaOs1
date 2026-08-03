import { AppError } from "../shared/errors/index.js";
import { BUSINESS_TYPES, CAPABILITIES } from "./profile.js";
import kirana from "./kirana/profile.js";
import clothing from "./clothing/profile.js";
import footwear from "./footwear/profile.js";
import autoParts from "./auto-parts/profile.js";
import electronics from "./electronics/profile.js";
import pharmacy from "./pharmacy/profile.js";
import stationery from "./stationery/profile.js";
import furniture from "./furniture/profile.js";
import cosmetics from "./cosmetics/profile.js";
import restaurant from "./restaurant/profile.js";
import other from "./other/profile.js";

export { BUSINESS_TYPES, CAPABILITIES } from "./profile.js";

export const BUSINESS_PROFILE_LIST = Object.freeze([
  kirana, clothing, footwear, autoParts, electronics, pharmacy,
  stationery, furniture, cosmetics, restaurant, other,
]);

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
