import { validateGstin } from "./gst.js";

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizedRegistration(rawGstin) {
  if (!rawGstin) return { gstin: null, stateCode: null, valid: false };
  const validation = validateGstin(rawGstin);
  return validation.valid
    ? { gstin: validation.normalized, stateCode: validation.stateCode, valid: true }
    : { gstin: null, stateCode: null, valid: false };
}

/**
 * Build the legal seller identity for a location. A present location is
 * authoritative even when its GSTIN is null: null can represent an explicitly
 * unregistered branch and must not silently inherit the shop registration.
 */
export function locationSellerIdentity(location, shop) {
  const rawGstin = location ? location.gstNumber : shop?.gstNumber;
  const registration = normalizedRegistration(rawGstin);
  return {
    sellerGstin: registration.gstin,
    sellerStateCode: registration.stateCode,
    sellerLegalName: location?.gstLegalName || shop?.name || location?.name || null,
    sellerTradeName: location?.gstTradeName || location?.name || shop?.name || null,
    sellerAddress: location?.address || shop?.address || null,
    sellerCity: location?.city || shop?.city || null,
    gstRegistrationType: location?.gstRegistrationType || null,
    registrationValid: registration.valid,
  };
}

/**
 * Prefer the immutable identity captured on the bill. Shop identity is used
 * only for legacy plain objects that predate the seller snapshot fields.
 */
export function billSellerIdentity(bill, shop) {
  const hasSnapshot = hasOwn(bill, "sellerGstin") || hasOwn(bill, "sellerLegalName");
  const rawGstin = hasSnapshot ? bill?.sellerGstin : shop?.gstNumber;
  const registration = normalizedRegistration(rawGstin);
  return {
    sellerGstin: registration.gstin,
    sellerStateCode: registration.stateCode || (hasSnapshot ? bill?.sellerStateCode : null) || null,
    sellerLegalName: (hasSnapshot ? bill?.sellerLegalName : null) || shop?.name || null,
    sellerTradeName: (hasSnapshot ? bill?.sellerTradeName : null) || (hasSnapshot ? bill?.sellerLegalName : null) || shop?.name || null,
    sellerAddress: (hasSnapshot ? bill?.sellerAddress : null) || shop?.address || null,
    sellerCity: (hasSnapshot ? bill?.sellerCity : null) || shop?.city || null,
    registrationValid: registration.valid,
  };
}