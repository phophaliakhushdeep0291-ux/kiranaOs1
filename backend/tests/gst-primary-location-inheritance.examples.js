import assert from "node:assert/strict";
import { locationSellerIdentity } from "../src/utils/gstIdentity.js";

// A GST-registered shop could not issue a single GST invoice. Every bill came back
// SELLER_GSTIN_REQUIRED (422) — "This location needs a valid GSTIN" — while the
// owner was looking at their GSTIN, correctly saved, in Business Profile.
//
// ensurePrimaryLocation snapshots the shop's gst columns onto the primary location
// when it auto-creates the row. If that happened before a GSTIN existed, the
// snapshot said "unregistered" forever: saving a GSTIN writes Shop.gstNumber and
// nothing propagates it. No settings screen exposes a per-location GSTIN, so there
// was no way for the owner to fix it from inside the app.

const GSTIN = "27AAPFU0939F1ZV";
const shop = { name: "Om Hari Traders", gstNumber: GSTIN, city: "Pune" };

// ── the production failure ──────────────────────────────────────────
const staleprimary = { isPrimary: true, name: "Main", gstNumber: null, gstRegistrationType: "unregistered" };
const recovered = locationSellerIdentity(staleprimary, shop);
assert.equal(recovered.registrationValid, true, "the primary location must inherit the shop's registration");
assert.equal(recovered.sellerGstin, GSTIN, "and bill under the shop's GSTIN");
assert.equal(recovered.sellerStateCode, "27", "with the state code derived from it, so CGST/SGST vs IGST stays correct");

// ── a deliberately distinct primary registration still wins ─────────
const ownGstin = "29AAPFU0939F1ZR";
const distinct = { isPrimary: true, name: "Main", gstNumber: ownGstin, gstRegistrationType: "regular" };
assert.equal(locationSellerIdentity(distinct, shop).sellerGstin, ownGstin, "a primary with its own GSTIN is not overridden");

// ── secondary branches keep the strict behaviour ────────────────────
// This is the case the original design protected and it must not regress: a branch
// created with registrationMode "unregistered" bills unregistered even though the
// parent shop is registered. Inheriting there would put the shop's GSTIN on an
// invoice issued by a branch that has no registration.
const unregisteredBranch = { isPrimary: false, name: "Kothrud", gstNumber: null, gstRegistrationType: "unregistered" };
const branch = locationSellerIdentity(unregisteredBranch, shop);
assert.equal(branch.registrationValid, false, "an unregistered branch must NOT inherit the shop GSTIN");
assert.equal(branch.sellerGstin, null);

// A branch with its own registration is unaffected.
const branchGstin = "29AAPFU0939F1ZR";
assert.equal(
  locationSellerIdentity({ isPrimary: false, gstNumber: branchGstin }, shop).sellerGstin,
  branchGstin,
);

// ── unregistered shops are still unregistered ───────────────────────
// Inheriting must not invent a registration that does not exist.
const noGstShop = { name: "Chhoti Dukan", gstNumber: null };
assert.equal(
  locationSellerIdentity({ isPrimary: true, gstNumber: null }, noGstShop).registrationValid,
  false,
  "a shop with no GSTIN stays unregistered",
);

// An invalid GSTIN must never read as valid, wherever it came from.
assert.equal(
  locationSellerIdentity({ isPrimary: true, gstNumber: null }, { gstNumber: "NOTAGSTIN" }).registrationValid,
  false,
  "a malformed shop GSTIN is not laundered into a valid registration by inheritance",
);

// ── no location at all (legacy path) is unchanged ───────────────────
assert.equal(locationSellerIdentity(null, shop).sellerGstin, GSTIN);

console.log("gst-primary-location-inheritance.examples.js OK");
