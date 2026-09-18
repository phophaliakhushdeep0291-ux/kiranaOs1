import assert from "node:assert/strict";
import db from "../src/db.js";
import { registerShop } from "../src/modules/auth/auth.service.js";

/**
 * A new shop must have a phone number on it from the moment it is opened.
 *
 * Signup asks for one number and puts it on the owner's user row. `Shop.phone`
 * is a separate column no screen in the signup flow fills, so every shop started
 * life with it null — and `Shop.phone` is what goes on printed bills and on the
 * customer QR ordering page.
 *
 * The shopkeeper's first screen after signup then opened on "Store profile —
 * Needed — Add shop name, phone, and address", asking for three things they had
 * just typed, with no way to tell which one was actually missing. Meanwhile the
 * bills coming out of the printer had no number a customer could call.
 *
 * A kirana's counter number IS the owner's mobile, so it is the right default.
 * A shop with a separate landline still sets its own, and that wins.
 */

const base = (over = {}) => ({
  shopName: "Phone Default Store", ownerName: "Owner", city: "Indore",
  address: "12 Test Street", mobile: "9000000201", password: "correct-horse",
  ownerPin: "1234", businessType: "kirana",
  ...over,
});

const shopFor = async (auth) => {
  const shopId = auth.shop?.id ?? auth.user?.shopId;
  assert.ok(shopId, "registration must return the shop it opened");
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  assert.ok(shop, "and that shop must exist");
  return shop;
};

/* ------------------- signup gives one number: it becomes the shop's number */

const registered = await registerShop(base(), { deviceId: "till-1" });
const shop = await shopFor(registered);
assert.equal(
  shop.phone, "9000000201",
  "a shop that stated no separate number is reachable on its owner's",
);

/* ----------------------------- a stated shop number is never overwritten */

const withLandline = await registerShop(
  base({ shopName: "Landline Store", mobile: "9000000202", phone: "07314567890" }),
  { deviceId: "till-2" },
);
const landlineShop = await shopFor(withLandline);
assert.equal(
  landlineShop.phone, "07314567890",
  "a shop that gave its own number keeps it, not the owner's mobile",
);

/* -------- and the owner's login mobile stays the owner's, not the shop's */

const owner = await db.user.findFirst({
  where: { shopId: landlineShop.id, role: "owner" },
});
assert.equal(
  owner?.mobile, "9000000202",
  "the two numbers are separate fields and must not have been folded together",
);

console.log("Shop phone from registration examples passed");
