import assert from "node:assert/strict";
import {
  buildUpiCollectLink,
  formatUpiAmount,
  isValidUpiVpa,
  upiCollectionForShop,
} from "../src/modules/payment-provider/upiCollect.js";

/**
 * The shop's own UPI QR, for a counter with no payment gateway.
 *
 * Money moves bank-to-bank between the guest and the shop; this software builds
 * a link and is never told the payment happened. Two things therefore have to be
 * exactly right, because nothing downstream can correct them: the amount the
 * guest is asked to approve, and who they are approving it to.
 */

const params = (link) => new URLSearchParams(link.slice(link.indexOf("?") + 1));

/* --------------------------------------------------------------- the amount */

// Built from integer paise on purpose. A float here reaches a guest as
// 1234.5599999 or 1.2345e+3 — a wrong sum, or a link the app refuses.
assert.equal(formatUpiAmount(1), "0.01", "one paisa is not one rupee");
assert.equal(formatUpiAmount(50), "0.50", "and the paise column is padded, not truncated");
assert.equal(formatUpiAmount(100), "1.00");
assert.equal(formatUpiAmount(123456), "1234.56");
assert.equal(formatUpiAmount(100000000), "1000000.00", "a large bill carries no separators UPI cannot read");

for (const bad of [0, -1, 1.5, NaN, "100", null, undefined]) {
  assert.throws(() => formatUpiAmount(bad), `${String(bad)} is not a payable amount`);
}

/* ------------------------------------------------------------------ the payee */

for (const good of ["shop@okhdfcbank", "a.b-c_d@ybl", "9000000001@paytm"]) {
  assert.ok(isValidUpiVpa(good), `${good} is a real VPA shape`);
}
for (const bad of ["", "shop", "shop@", "@ybl", "shop@@ybl", "shop ybl", "shop@1bank", null]) {
  assert.ok(!isValidUpiVpa(bad), `${String(bad)} must not be accepted — a malformed VPA addresses nobody, quietly`);
}

assert.throws(
  () => buildUpiCollectLink({ vpa: "not-a-vpa", payeeName: "Cafe", amountPaise: 100 }),
  /not set or is not valid/,
  "a bad VPA is refused rather than encoded",
);
assert.throws(
  () => buildUpiCollectLink({ vpa: "shop@ybl", payeeName: "   ", amountPaise: 100 }),
  /payee name is required/,
  "a guest must be able to see who they are paying",
);

/* ------------------------------------------------- the link itself */

const link = buildUpiCollectLink({
  vpa: "artha@okhdfcbank",
  payeeName: "Artha Restaurant & Cafe",
  amountPaise: 74850,
  note: "Table 4",
  reference: "KOS-1042",
});

assert.ok(link.startsWith("upi://pay?"), "it is a UPI intent, not a web URL");
const q = params(link);
assert.equal(q.get("pa"), "artha@okhdfcbank");
assert.equal(q.get("pn"), "Artha Restaurant & Cafe", "the ampersand survives instead of ending the parameter");
assert.equal(q.get("am"), "748.50");
assert.equal(q.get("cu"), "INR");
assert.equal(q.get("tn"), "Table 4");
assert.equal(q.get("tr"), "KOS-1042");

// A payee name with an & in it would otherwise close the parameter early and
// hand the rest of the link to whatever followed — a wrong amount at best, a
// different payee at worst.
assert.ok(link.includes("%26"), "the ampersand in the name is encoded, not left to close the parameter");
assert.equal(q.getAll("am").length, 1, "and the link carries exactly one amount for the guest to approve");
assert.ok(!link.includes("+"), "spaces are percent-encoded; several UPI apps print a + literally");
// Textbook encoding would write %40 here. Every UPI QR in circulation carries a
// raw @, and an app that does not decode it addresses a payee who does not
// exist — a QR the guest cannot pay.
assert.ok(link.includes("pa=artha@okhdfcbank"), "the @ in a VPA stays raw, as every real UPI QR carries it");
assert.ok(!link.includes("%40"), "and is never percent-encoded");

assert.throws(
  () => buildUpiCollectLink({ vpa: "a@ybl", payeeName: "X", amountPaise: 100, reference: "bad ref!" }),
  /letters, numbers and hyphens/,
  "a reference UPI would reject is caught here, not at the counter",
);

/* ----------------------------------------- what the counter is handed */

// Reads the UPI ID the shop already types under Store profile → bank details.
// A field of its own would mean a shop that filled one of them and cannot see
// why the QR still says it is not set up.
const settings = { bank: { upi: "artha@okhdfcbank", holder: "Artha Restaurant" } };
const collection = upiCollectionForShop(settings, { amountPaise: 25000, note: "Table 2", reference: "KOS-7", shopName: "Artha" });
assert.equal(collection.amountPaise, 25000);
assert.equal(params(collection.link).get("am"), "250.00");
assert.equal(
  collection.verified, false,
  "the response says in the data, not only in a comment, that nothing here confirms a payment",
);

assert.equal(collection.payeeName, "Artha Restaurant", "the guest sees the account holder they are paying");

// A UPI app showing a blank payee is one a guest should not approve, so the
// shop's own name stands in when no account holder was named.
const noHolder = upiCollectionForShop({ bank: { upi: "artha@okhdfcbank" } }, { amountPaise: 100, shopName: "Artha Cafe" });
assert.equal(noHolder.payeeName, "Artha Cafe", "the payee is never blank");

assert.throws(
  () => upiCollectionForShop({}, { amountPaise: 100 }),
  /UPI ID under Store profile/,
  "a shop that has not set its UPI ID is told where to set it, not handed a broken QR",
);

console.log("upi-collect-link: ok");
