import assert from "node:assert/strict";
import db from "../src/db.js";
import { registerShop } from "../src/modules/auth/auth.service.js";

/**
 * One registration must open one shop, however many times it is delivered.
 *
 * The submit button is already disabled while the request is in flight, so a
 * double click was never the path. A slow first attempt that the client gave up
 * on and sent again is: the first had already committed its shop, and the retry
 * opened a second. Observed in a clean run — two shops and two owner accounts
 * with the same name, 1.8 seconds apart, from a single trip through the form.
 *
 * The owner then has two shops, enters a day's menu into whichever they landed
 * in, and finds the other empty tomorrow. Nobody reports that as a duplicate;
 * they report it as software that lost their data.
 */

const base = (over = {}) => ({
  shopName: "Replay Cafe", ownerName: "Owner", city: "Jaipur", address: "12 Test Street",
  mobile: "9000000101", password: "correct-horse", ownerPin: "1234", businessType: "restaurant",
  ...over,
});

const shopsNamed = (name) => db.shop.count({ where: { name } });

/* ------------------------------------- the same registration, delivered twice */

const first = await registerShop(base(), { deviceId: "till-1" });
const second = await registerShop(base(), { deviceId: "till-1" });

assert.equal(await shopsNamed("Replay Cafe"), 1, "a repeat delivery must not open a second shop");
assert.equal(
  first.shop?.id ?? first.user?.shopId, second.shop?.id ?? second.user?.shopId,
  "and the caller is handed the shop that already exists",
);
assert.ok(second.accessToken, "with a usable session, exactly as a first delivery would leave them");

/* ----------------- a different person with the same details is NOT folded in */

// The password is what separates a retry from a stranger. Getting this wrong
// would hand someone else's shop to whoever guessed its name and number.
const intruder = await registerShop(base({ password: "not-the-same" }), { deviceId: "till-2" });
assert.equal(
  await shopsNamed("Replay Cafe"), 2,
  "a different password is a different registration and gets its own shop",
);
assert.notEqual(
  intruder.shop?.id ?? intruder.user?.shopId, first.shop?.id ?? first.user?.shopId,
  "and must never be handed the first owner's shop",
);

/* --------------------------- a genuinely separate shop still opens normally */

await registerShop(base({ shopName: "Second Branch" }), { deviceId: "till-1" });
assert.equal(await shopsNamed("Second Branch"), 1, "opening a real second shop is unaffected");

console.log("registration-is-replay-safe: ok");
