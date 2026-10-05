import { AppError } from "../../shared/errors/index.js";

// A market is an accounting contract, not a display preference. Existing shops
// were created by an INR-only ledger. Never infer their currency from the old
// free-text storeProfile.country/currency fields.
export const LIVE_MARKET = Object.freeze({
  version: 1, countryCode: "IN", currencyCode: "INR", locale: "en-IN",
  timeZone: "Asia/Kolkata", taxRegime: "GST",
});

export function assertLiveMarket(countryCode = "IN", currencyCode = "INR") {
  if (countryCode !== "IN" || currencyCode !== "INR") {
    throw new AppError("UAE trading is not available yet. The UAE workspace is a preview; existing shop balances remain in INR.", 409, "MARKET_NOT_LIVE");
  }
}

export function settingsWithMarketPolicy(next, previous = {}) {
  const region = next.region;
  if (region !== undefined) {
    if (!region || typeof region !== "object" || Array.isArray(region)
      || Object.entries(region).some(([key, value]) => !(key in LIVE_MARKET) || LIVE_MARKET[key] !== value)) {
      throw new AppError("Country, currency and accounting time zone cannot be changed through shop preferences.", 409, "MARKET_CHANGE_REQUIRES_MIGRATION");
    }
  }
  const profile = next.storeProfile;
  if (profile && typeof profile === "object" && !Array.isArray(profile)) {
    const oldProfile = previous.storeProfile ?? {};
    const aliases = { country: ["India", "IN"], currency: ["INR", "₹ Indian Rupee", "Indian Rupee (INR)"] };
    for (const [key, allowed] of Object.entries(aliases)) {
      const value = profile[key];
      // An unchanged legacy label can be repaired by an ordinary settings save.
      if (value && value !== oldProfile[key] && !allowed.includes(value)) {
        throw new AppError("Changing a country or currency label does not convert shop balances. Use a separately supported shop market.", 409, "MARKET_CHANGE_REQUIRES_MIGRATION");
      }
    }
  }
  return {
    ...next, region: { ...LIVE_MARKET },
    ...(profile && typeof profile === "object" && !Array.isArray(profile)
      ? { storeProfile: { ...profile, country: "India", currency: "Indian Rupee (INR)" } } : {}),
  };
}
