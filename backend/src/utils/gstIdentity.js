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
 * Build the legal seller identity for a location. A secondary location is
 * authoritative even when its GSTIN is null: null there can represent an
 * explicitly unregistered branch (the "unregistered" registration mode) and must
 * not silently inherit the shop registration.
 *
 * The PRIMARY location is different — it is the business itself, not a branch, and
 * cannot hold a registration status the shop does not. Its gst columns are only
 * ever a snapshot taken by ensurePrimaryLocation when the row was auto-created. If
 * that happened before the owner entered a GSTIN, the snapshot says "unregistered"
 * permanently: entering a GSTIN in Business Profile writes Shop.gstNumber, and
 * nothing propagates it to the location. Every GST invoice then failed with
 * SELLER_GSTIN_REQUIRED (422), telling the owner to add a GSTIN they had already
 * added, with no field anywhere in the UI that could have fixed it — the only
 * GSTIN input on the settings screens writes to the shop.
 *
 * So the primary location falls back to the shop's registration when it has none
 * of its own. Its own GSTIN still wins when set, which keeps a deliberately
 * distinct primary registration working.
 */
export function locationSellerIdentity(location, shop) {
  const inheritsShopRegistration = !location || location.isPrimary === true;
  const rawGstin = inheritsShopRegistration
    ? location?.gstNumber || shop?.gstNumber
    : location.gstNumber;
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