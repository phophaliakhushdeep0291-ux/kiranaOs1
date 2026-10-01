import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import db from "../src/db.js";
import { confirmBillSchema } from "../src/modules/bills/bills.schema.js";
import { pushOfflineActions } from "../src/modules/sync/sync.service.js";
import { createProduct } from "../src/modules/products/products.service.js";
import { describeZodError, formatIssuePath, zodIssueList } from "../src/utils/validationMessage.js";

/**
 * A rejected change has to say WHICH field it rejected.
 *
 * Two shapes were reaching people, and neither named the field:
 *
 *   HTTP 400  →  "Validation failed", details `{ items: ["Required"] }`
 *                because Zod's flatten() keys only the top of the path. On a
 *                forty-line bill that one word cannot tell you which line.
 *
 *   sync      →  a ZodError's own `message`, which is the whole issue array
 *                re-serialised as multi-line JSON, written straight into the
 *                parked row's reason — so the shopkeeper's "needs review" card
 *                showed them JSON.
 *
 * The offline queue parks a ZodError permanently (CONFLICT / INVALID_EVENT, not
 * retryable). It waits for a human by design, which only works if the human is
 * told what to fix.
 */

/* --------------------------- the path formatter ---------------------------- */

assert.equal(formatIssuePath(["items", 0, "enteredUnit"]), "items[0].enteredUnit");
assert.equal(formatIssuePath(["mobile"]), "mobile");
assert.equal(formatIssuePath(["payments", 2, "amount"]), "payments[2].amount");
assert.equal(formatIssuePath([]), "", "a root-level refinement has no field to name");

/* ------------------- a real bill, with a real missing field ---------------- */

const badBill = {
  billType: "normal_sale",
  customerName: "Walk-in",
  items: [
    { productId: "p1", name: "Parle-G", quantity: 2, enteredUnit: "piece", ratePerRateUnit: 10 },
    { productId: "p2", name: "Tata Salt", quantity: 1, ratePerRateUnit: 28 }, // no enteredUnit
  ],
};

const parsed = confirmBillSchema.safeParse(badBill);
assert.equal(parsed.success, false, "the fixture must actually fail validation");

// What we used to send.
assert.deepEqual(
  Object.keys(parsed.error.flatten().fieldErrors), ["items"],
  "flatten() still collapses the path — this is why the message had to change",
);

const message = describeZodError(parsed.error);
assert.match(message, /items\[1\]\.enteredUnit/, "the message must name the line AND the field");
assert.match(message, /required/i);
assert.doesNotMatch(message, /[{}[\]]"/, "and must not be JSON");

const issues = zodIssueList(parsed.error);
assert.deepEqual(issues, [{ field: "items[1].enteredUnit", message: "Required" }]);

/* ----------------------- several problems stay readable -------------------- */

const veryBad = confirmBillSchema.safeParse({
  items: Array.from({ length: 12 }, (_, index) => ({ name: `Item ${index}`, quantity: 1 })),
});
const manyMessage = describeZodError(veryBad.error);
assert.match(manyMessage, /items\[0\]/, "the first few are named");
assert.match(manyMessage, /and \d+ more problems/, "and the rest are counted, not listed");
assert.ok(manyMessage.length < 300, `a malformed bill must not answer with a paragraph: ${manyMessage.length} chars`);

// A ZodError from a schema that passes carries no issues; the caller's fallback stands.
assert.equal(describeZodError(null), "Validation failed");
assert.equal(describeZodError({ issues: [] }, "This change was rejected"), "This change was rejected");

/* ------------------ and the same sentence reaches a parked row ------------- */

const shop = await db.shop.create({
  data: { name: "Rejection message proof", ownerName: "Owner", city: "Indore", address: "1 Test Road" },
});
const owner = await db.user.create({
  data: {
    shopId: shop.id, name: "Owner", mobile: "9000000601", role: "owner",
    passwordHash: await bcrypt.hash("password", 10), pinHash: await bcrypt.hash("4242", 10),
  },
});
const user = { userId: owner.id, id: owner.id, role: "owner", shopId: shop.id };

const product = await createProduct(shop.id, {
  name: "Queue Biscuit", category: "Biscuits",
  displayUnit: "piece", baseUnit: "piece", rateUnit: "piece",
  defaultPricePerRateUnit: 10, costPerRateUnit: 8, mrp: 10,
  stockBaseQty: 50, gstRate: 0, isLooseItem: false,
}, { actor: { userId: owner.id } });

const eventId = "event_bill_missing_unit";
const push = await pushOfflineActions(shop.id, [{
  eventId, clientEventId: eventId, type: "CREATE_BILL",
  payload: {
    billType: "normal_sale", customerName: "Walk-in",
    items: [{ productId: product.id, name: product.name, quantity: 2, ratePerRateUnit: 10 }],
    payments: [{ mode: "cash", amount: 20 }],
  },
}], user);

assert.equal(push.applied, 0, "a malformed bill must not post");

const parkedRow = await db.offlineSyncEvent.findFirst({ where: { shopId: shop.id, eventId } });
assert.equal(String(parkedRow.status).toUpperCase(), "CONFLICT", "it parks for a human rather than retrying forever");
assert.match(parkedRow.error, /items\[0\]\.enteredUnit/, "and the reason names the field to fix");
assert.doesNotMatch(parkedRow.error, /"code":/, "not the raw ZodError JSON");
assert.ok(parkedRow.error.length < 300, "a reason a person can read at the counter");

console.log("Validation message examples passed");
console.log(`  HTTP/queue message: ${parkedRow.error}`);
