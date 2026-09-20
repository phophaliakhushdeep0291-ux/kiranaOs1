import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import db from "../src/db.js";
import { pushOfflineActions } from "../src/modules/sync/sync.service.js";

/**
 * One owner approval is one proof, however many operations it covers.
 *
 * The owner types the PIN once and approves one batch, and every event in that
 * batch carries the same four digits. Verifying each event separately meant a
 * bcrypt compare per event — 63ms on the machine this was found on — plus four
 * audit reads and an audit write each. The starter catalog is 560 products
 * behind a single PIN entry, so loading it spent 35 seconds re-hashing the same
 * PIN and wrote 560 identical OWNER_PIN_VERIFIED rows. It was ~84% of the whole
 * push, and it is why a new shop watched "backing up" for minutes.
 *
 * What must not change is what the PIN is for. The cases below are the contract:
 * a wrong PIN still refuses every operation it was attached to, a missing one
 * still refuses, two PINs in one batch are two separate proofs, and the proof
 * never outlives the request that made it.
 */

const pin = "4242";
const shop = await db.shop.create({
  data: {
    name: "Owner PIN batch proof", ownerName: "Owner", city: "Indore", address: "1 Test Road",
    settingsJson: JSON.stringify({ businessProfile: { businessType: "kirana" } }),
  },
});
const owner = await db.user.create({
  data: {
    shopId: shop.id, name: "Owner", mobile: "9000000401", role: "owner",
    passwordHash: await bcrypt.hash("password", 10), pinHash: await bcrypt.hash(pin, 10),
  },
});
const user = { userId: owner.id, id: owner.id, role: "owner", shopId: shop.id };

let sequence = 0;
function productEvent(ownerPin, tag) {
  sequence += 1;
  const localId = `product_${tag}_${sequence}`;
  const eventId = `event_${tag}_${sequence}`;
  return {
    eventId, clientEventId: eventId, type: "CREATE_PRODUCT",
    payload: {
      ...(ownerPin === undefined ? {} : { ownerPin }),
      localProductId: localId, clientProductId: localId,
      product: {
        localId, clientProductId: localId, name: `Item ${tag} ${sequence}`, category: "Test",
        displayUnit: "piece", baseUnit: "piece", rateUnit: "piece",
        defaultPricePerRateUnit: 10, costPerRateUnit: 8, mrp: 10, gstRate: 0,
        stockBaseQty: 0, isLooseItem: false, isActive: true,
      },
    },
  };
}

const auditCount = (action) => db.auditLog.count({ where: { shopId: shop.id, action } });
const batch = (n, ownerPin, tag) => Array.from({ length: n }, () => productEvent(ownerPin, tag));

/* ------------------ ten operations behind one PIN entry: one proof ---------- */

const accepted = await pushOfflineActions(shop.id, batch(10, pin, "ok"), user);
assert.equal(accepted.applied, 10, "every operation the owner approved must be applied");
assert.equal(
  await auditCount("OWNER_PIN_VERIFIED"), 1,
  "one approval is one proof, not one per operation in the batch",
);

/* --------------------------- a second push proves itself again -------------- */

// The cache lives on the push context, so it cannot carry a proof from one
// request into the next. Each approval is audited on its own.
await pushOfflineActions(shop.id, batch(5, pin, "ok2"), user);
assert.equal(
  await auditCount("OWNER_PIN_VERIFIED"), 2,
  "a later push proves the PIN again rather than reusing an earlier proof",
);

/* --------------- a wrong PIN refuses everything it was attached to ---------- */

const refused = await pushOfflineActions(shop.id, batch(4, "9999", "wrong"), user);
assert.equal(refused.applied, 0, "a wrong PIN must apply nothing");
assert.equal(refused.failed, 4, "and must refuse every operation carrying it");
assert.equal(
  await db.product.count({ where: { shopId: shop.id, name: { startsWith: "Item wrong" } } }), 0,
  "nothing a refused PIN was attached to may reach the catalogue",
);
assert.equal(
  await auditCount("OWNER_PIN_VERIFICATION_FAILED"), 1,
  "one wrong answer from one person is one failure — counting it four times would "
  + "spend the lockout budget on a single mistyped digit and lock the owner out of the till",
);

/* -------------------------------- a missing PIN still refuses --------------- */

const missing = await pushOfflineActions(shop.id, batch(3, undefined, "missing"), user);
assert.equal(missing.applied, 0, "an operation with no PIN at all must still be refused");
assert.equal(missing.failed, 3);

/* ------------- two PINs in one batch are two proofs, judged separately ------ */

const mixed = [...batch(2, pin, "mixgood"), ...batch(2, "9999", "mixbad")];
const mixedResult = await pushOfflineActions(shop.id, mixed, user);
assert.equal(mixedResult.applied, 2, "the correctly approved half applies");
assert.equal(mixedResult.failed, 2, "the wrongly approved half does not");
assert.equal(
  await db.product.count({ where: { shopId: shop.id, name: { startsWith: "Item mixgood" } } }), 2,
);
assert.equal(
  await db.product.count({ where: { shopId: shop.id, name: { startsWith: "Item mixbad" } } }), 0,
);

/* ------------------------- the PIN never enters the audit trail ------------- */

const verified = await db.auditLog.findFirst({
  where: { shopId: shop.id, action: "OWNER_PIN_VERIFIED" },
  orderBy: { createdAt: "desc" },
});
assert.ok(verified, "a successful approval is still audited");
assert.equal(JSON.parse(verified.metadataJson).channel, "offline_sync");
assert.equal(String(verified.metadataJson).includes(pin), false, "the accepted PIN must never be stored");

console.log("Owner PIN verified once per push examples passed");
