import assert from "assert";
import { requireShop } from "../src/middleware/permissions.js";

// #9 (CODE_REVIEW_LOGIC_FLAWS.md): requireShop must derive shopId ONLY from the authenticated JWT
// (req.user), never from a client-supplied x-shop-id header. Trusting the header would let any
// authenticated caller operate on another tenant's data if requireShop were ever mounted without
// requireAuth in front of it.
function run(req) {
  const reqObj = { ...req };
  let err;
  requireShop(reqObj, {}, (e) => { err = e; });
  return { shopId: reqObj.shopId, err };
}

// A client header alone must NOT establish shop context.
const headerOnly = run({ user: undefined, headers: { "x-shop-id": "shop_attacker" } });
assert.ok(headerOnly.err, "x-shop-id header alone must be rejected");
assert.equal(headerOnly.shopId, undefined, "header must not set req.shopId");

// The header must never override the authenticated tenant.
const authed = run({ user: { shopId: "shop_real" }, headers: { "x-shop-id": "shop_attacker" } });
assert.ok(!authed.err, "authenticated request must pass");
assert.equal(authed.shopId, "shop_real", "shopId must come from the JWT, ignoring the header");

// No user and no header → rejected.
const neither = run({ headers: {} });
assert.ok(neither.err, "request with no shop context must be rejected");

console.log("shop-context-header.examples.js OK");
