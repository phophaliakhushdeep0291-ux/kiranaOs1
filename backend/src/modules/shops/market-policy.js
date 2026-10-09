import { AppError } from "../../shared/errors/index.js";

// A market is an accounting contract, not a display preference. Existing shops
// were created by an INR-only ledger. Never infer their currency from the old
// free-text storeProfile.country/currency fields.
export const LIVE_MARKET = Object.freeze({
  version: 1, countryCode: "IN", currencyCode: "INR", locale: "en-IN",
  timeZone: "Asia/Kolkata", taxRegime: "GST",
});

export const UAE_MARKET = Object.freeze({
  version: 1, countryCode: "AE", currencyCode: "AED", locale: "en-AE",
  timeZone: "Asia/Dubai", taxRegime: "VAT",
});

export function marketProfile(source = {}) {
  const profile = source.countryCode === "AE" ? UAE_MARKET : LIVE_MARKET;
  if ((source.countryCode !== undefined && source.countryCode !== profile.countryCode)
    || (source.currencyCode !== undefined && source.currencyCode !== profile.currencyCode)) {
    throw new AppError("Unsupported accounting market", 409, "MARKET_NOT_LIVE");
  }
  return profile;
}

export function normalizeUaeMobile(input) {
  let value = String(input ?? "").trim().replace(/[\s()-]/g, "");
  if (value.startsWith("00971")) value = `+971${value.slice(5)}`;
  else if (/^971\d{9}$/.test(value)) value = `+${value}`;
  else if (/^05\d{8}$/.test(value)) value = `+971${value.slice(1)}`;
  return /^\+9715[024568]\d{7}$/.test(value) ? value : null;
}

export function assertUaeRegistration(shop) {
  if (shop.countryCode !== "AE") return;
  if (shop.vatRegistered && !/^\d{15}$/.test(shop.taxRegistrationNumber ?? "")) {
    throw new AppError("VAT registration requires a 15-digit UAE TRN", 422, "UAE_TRN_REQUIRED");
  }
  if (!shop.vatRegistered && shop.taxRegistrationNumber) {
    throw new AppError("Only a VAT-registered shop can provide a TRN", 422, "UAE_REGISTRATION_MISMATCH");
  }
}

export function assertLiveMarket(countryCode = "IN", currencyCode = "INR") {
  if (countryCode !== "IN" || currencyCode !== "INR") {
    throw new AppError("UAE trading is not available yet. The UAE workspace is a preview; existing shop balances remain in INR.", 409, "MARKET_NOT_LIVE");
  }
}

export function settingsWithMarketPolicy(next, previous = {}, source = {}) {
  const profileMarket = marketProfile(source);
  const region = next.region;
  if (region !== undefined) {
    if (!region || typeof region !== "object" || Array.isArray(region)
      || Object.entries(region).some(([key, value]) => !(key in profileMarket) || profileMarket[key] !== value)) {
      throw new AppError("Country, currency and accounting time zone cannot be changed through shop preferences.", 409, "MARKET_CHANGE_REQUIRES_MIGRATION");
    }
  }
  const profile = next.storeProfile;
  if (profile && typeof profile === "object" && !Array.isArray(profile)) {
    const oldProfile = previous.storeProfile ?? {};
    const aliases = profileMarket.countryCode === "AE" ? { country: ["United Arab Emirates", "UAE", "AE"], currency: ["AED", "UAE Dirham (AED)"] } : { country: ["India", "IN"], currency: ["INR", "₹ Indian Rupee", "Indian Rupee (INR)"] };
    for (const [key, allowed] of Object.entries(aliases)) {
      const value = profile[key];
      // An unchanged legacy label can be repaired by an ordinary settings save.
      if (value && value !== oldProfile[key] && !allowed.includes(value)) {
        throw new AppError("Changing a country or currency label does not convert shop balances. Use a separately supported shop market.", 409, "MARKET_CHANGE_REQUIRES_MIGRATION");
      }
    }
  }
  return {
    ...next, region: { ...profileMarket },
    ...(profile && typeof profile === "object" && !Array.isArray(profile)
      ? { storeProfile: { ...profile, country: profileMarket.countryCode === "AE" ? "United Arab Emirates" : "India", currency: profileMarket.currencyCode === "AED" ? "UAE Dirham (AED)" : "Indian Rupee (INR)" } } : {}),
  };
}

// Column snapshot for invoices and linked returns. Missing fields are legacy INR
// records; explicit unsupported values must never silently become rupees.
export function accountingMarketSnapshot(source = {}) {
  const profile = marketProfile(source);
  const snapshot = {
    countryCode: source.countryCode === undefined ? profile.countryCode : source.countryCode,
    currencyCode: source.currencyCode === undefined ? profile.currencyCode : source.currencyCode,
    accountingTimeZone: source.accountingTimeZone === undefined ? profile.timeZone : source.accountingTimeZone,
    taxRegime: source.taxRegime === undefined ? profile.taxRegime : source.taxRegime,
  };
  if (snapshot.accountingTimeZone !== profile.timeZone || snapshot.taxRegime !== profile.taxRegime) {
    throw new AppError("Unsupported accounting market", 409, "MARKET_NOT_LIVE");
  }
  return snapshot;
}

export function assertAccountingMarketClaim(input, snapshot) {
  for (const key of ["countryCode", "currencyCode", "accountingTimeZone", "taxRegime"]) {
    if (input[key] !== undefined && input[key] !== snapshot[key]) {
      throw new AppError("Transaction market does not match the original accounting record", 409, "ACCOUNTING_MARKET_MISMATCH");
    }
  }
}


export async function shopAccountingMarket(client, shopId) {
  const shop = await client.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
  return accountingMarketSnapshot(shop);
}
