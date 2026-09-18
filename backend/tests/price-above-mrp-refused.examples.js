import assert from "node:assert/strict";
import db from "../src/db.js";
import { createProduct, updateProduct, getProduct } from "../src/modules/products/products.service.js";
import { pushOfflineActions } from "../src/modules/sync/sync.service.js";
import bcrypt from "bcryptjs";

/**
 * A price above the product's own MRP is refused at the edit, not at the till.
 *
 * Billing caps every line at the selling unit's ceiling and throws
 * PRICE_ABOVE_CONFIGURED_MAXIMUM. Nothing stopped an edit from setting a price
 * above that ceiling in the first place, through either write path, so the
 * product was saved into a state where it could not be sold at its own listed
 * price — and nobody was told.
 *
 * Observed on a running shop: a ₹10 biscuit was raised to ₹25 without touching
 * its ₹10 MRP. Both the REST route and offline sync returned success. The
 * catalogue and the billing grid then advertised ₹25 while the counter quietly
 * rang ₹10 from the retail tier. The shop is not overcharging anyone — it is
 * losing the margin it believes it has just taken, silently, on every sale.
 */

const shop = await db.shop.create({
  data: {
    name: "MRP ceiling proof", ownerName: "Owner", city: "Indore", address: "1 Test Road",
    settingsJson: JSON.stringify({ businessProfile: { businessType: "kirana" } }),
  },
});
const owner = await db.user.create({
  data: {
    shopId: shop.id, name: "Owner", mobile: "9000000501", role: "owner",
    passwordHash: await bcrypt.hash("password", 10), pinHash: await bcrypt.hash("4242", 10),
  },
});
const user = { userId: owner.id, id: owner.id, role: "owner", shopId: shop.id };

const base = {
  name: "Ceiling Biscuit", category: "Biscuits",
  displayUnit: "piece", baseUnit: "piece", rateUnit: "piece",
  defaultPricePerRateUnit: 10, costPerRateUnit: 8, mrp: 10,
  stockBaseQty: 0, gstRate: 0, isLooseItem: false,
};

const product = await createProduct(shop.id, base, { actor: { userId: owner.id } });
assert.equal(product.defaultPricePerRateUnit, 10, "a price at the MRP is fine");

/* ------------------------------ the REST/service path refuses it ----------- */

await assert.rejects(
  () => updateProduct(shop.id, product.id, { defaultPricePerRateUnit: 25 }, { actor: { userId: owner.id } }),
  (error) => {
    assert.equal(error.code, "PRICE_ABOVE_CONFIGURED_MAXIMUM", "refusal must carry the billing vocabulary");
    assert.match(String(error.message), /above its MRP/i, "and must say which rule it broke");
    assert.match(String(error.message), /25/, "naming the price the owner typed");
    assert.match(String(error.message), /10/, "and the ceiling it passed");
    return true;
  },
  "a price above MRP must not be saved",
);

const unchanged = await getProduct(shop.id, product.id);
assert.equal(unchanged.defaultPricePerRateUnit, 10, "the refused edit must leave the price alone");

/* --------------------------- offline sync refuses it the same way ---------- */

// The till writes through sync, not the REST route. A guard only the REST route
// honours is no guard at all for an offline-first product.
const eventId = "event_price_above_mrp";
const push = await pushOfflineActions(shop.id, [{
  eventId, clientEventId: eventId, type: "UPDATE_PRODUCT",
  payload: { ownerPin: "4242", productId: product.id, changes: { defaultPricePerRateUnit: 25 } },
}], user);
assert.equal(push.applied, 0, "sync must refuse it too");
assert.equal(push.failed, 1);

const afterSync = await getProduct(shop.id, product.id);
assert.equal(afterSync.defaultPricePerRateUnit, 10, "and must not have moved the price");

/* ------------------- raising the MRP with the price is allowed ------------- */

// The owner's real intent — the item now costs more and its printed MRP says so.
const raised = await updateProduct(
  shop.id, product.id, { defaultPricePerRateUnit: 25, mrp: 25 }, { actor: { userId: owner.id } },
);
assert.equal(raised.defaultPricePerRateUnit, 25, "price and MRP raised together must be accepted");
const unit = await db.productSellingUnit.findFirst({ where: { shopId: shop.id, productId: product.id, isDefault: true } });
assert.equal(Number(unit.defaultPrice), 25);
assert.equal(Number(unit.maximumPrice), 25, "the unit's ceiling moves with it, so the till can sell it");

/* ------------------------- a product with no MRP is unconstrained ---------- */

// MRP is optional: loose goods, services and unbranded items have none, and a
// missing ceiling must not become a ceiling of zero that blocks every price.
const noMrp = await createProduct(
  shop.id, { ...base, name: "Loose Item", mrp: 0, defaultPricePerRateUnit: 40 }, { actor: { userId: owner.id } },
);
assert.equal(noMrp.defaultPricePerRateUnit, 40, "no MRP means no ceiling");

console.log("Price above MRP refused examples passed");
