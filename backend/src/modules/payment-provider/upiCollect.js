import { AppError } from "../../middleware/error.js";

/**
 * The shop's own UPI QR, for shops that have no payment gateway.
 *
 * This is NOT a provider integration. There is no merchant account here, no
 * settlement, no webhook and no commission: the link addresses the shop's own
 * VPA, the guest's UPI app moves the money bank-to-bank, and this software never
 * touches it and is never told that it moved.
 *
 * That last part is the whole design constraint. Nothing here may be treated as
 * proof of payment. A guest showing a "payment successful" screen is showing
 * their own phone, which can be a screenshot from last Tuesday, and taking it at
 * face value is the oldest scam at an Indian counter. The bill is settled only
 * when the shop sees the money arrive in its own bank alert, which is why every
 * payment recorded from this path is written with `confirmationSource: "manual"`
 * and carries the UTR the cashier reads back — the one string that makes it
 * reconcilable against a bank statement at day close.
 */

// name@handle. Deliberately strict: a malformed VPA does not fail loudly, it
// quietly addresses nobody, or somebody else.
const VPA_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,255})@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

const MAX_PAYEE_NAME = 50;
const MAX_NOTE = 50;
// UPI rejects a reference with anything exotic in it; keep to what every app
// accepts rather than discovering the limit at a counter.
const REFERENCE_PATTERN = /^[a-zA-Z0-9-]{1,35}$/;

export function isValidUpiVpa(value) {
  return typeof value === "string" && VPA_PATTERN.test(value.trim());
}

/**
 * Paise to the decimal string UPI expects.
 *
 * Built from integer paise rather than a float: `am=` is the amount the guest is
 * asked to approve, and 1234.5599999 or 1.2345e+3 is a customer paying the wrong
 * sum or an app refusing the link outright.
 */
export function formatUpiAmount(amountPaise) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new AppError("A UPI amount must be a whole number of paise above zero", 400);
  }
  const rupees = Math.floor(amountPaise / 100);
  const paise = amountPaise % 100;
  return `${rupees}.${String(paise).padStart(2, "0")}`;
}

/** Trim to what UPI carries, and drop anything that would break the query string. */
function cleanText(value, limit) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, limit);
}

/**
 * The `upi://pay?...` link a guest's app opens, or a QR encodes.
 *
 * Every value is encoded on the way in. A payee name with an `&` in it would
 * otherwise end the parameter early and hand the rest of the link to whatever
 * followed — at best a broken amount, at worst a different payee.
 */
export function buildUpiCollectLink({ vpa, payeeName, amountPaise, note, reference }) {
  const address = String(vpa ?? "").trim();
  if (!isValidUpiVpa(address)) {
    const err = new AppError("This shop's UPI ID is not set or is not valid", 400);
    err.code = "UPI_VPA_INVALID";
    throw err;
  }

  const name = cleanText(payeeName, MAX_PAYEE_NAME);
  if (!name) {
    const err = new AppError("A UPI payee name is required so the guest can see who they are paying", 400);
    err.code = "UPI_PAYEE_REQUIRED";
    throw err;
  }

  const params = new URLSearchParams();
  params.set("pa", address);
  params.set("pn", name);
  params.set("am", formatUpiAmount(amountPaise));
  params.set("cu", "INR");
  if (note) params.set("tn", cleanText(note, MAX_NOTE));
  if (reference) {
    const ref = cleanText(reference, 35);
    if (!REFERENCE_PATTERN.test(ref)) {
      throw new AppError("A UPI reference may contain only letters, numbers and hyphens", 400);
    }
    params.set("tr", ref);
  }

  // Two encodings are corrected rather than left to URLSearchParams.
  //
  // "+" for a space is read literally by several UPI apps, so the payee name
  // arrives with plus signs in it. The percent form is understood everywhere.
  //
  // "%40" for the "@" in a VPA is textbook-correct and still the wrong choice:
  // "@" is a legal sub-delimiter in a query, every UPI QR in circulation carries
  // it raw, and an app that does not decode it addresses a payee that does not
  // exist. A QR a guest cannot pay is worse than one that is pedantically right.
  return `upi://pay?${params.toString().replace(/\+/g, "%20").replace(/%40/g, "@")}`;
}

/**
 * What the counter needs to show a guest, or refuse to.
 *
 * Reads the UPI ID the shop has already typed under Store profile → bank
 * details (`settings.bank.upi`) rather than a field of its own. A second place
 * to enter the same thing is a shop that has filled one of them and cannot
 * understand why the QR says it is not set up.
 *
 * The payee name is what the guest sees they are paying, so it prefers the
 * account holder the shop named and falls back to the shop's own name — never
 * blank, because a UPI app showing an empty payee is one a guest should not
 * approve.
 */
export function upiCollectionForShop(shopSettings, { amountPaise, note, reference, shopName }) {
  const bank = shopSettings?.bank ?? {};
  const vpa = String(bank.upi ?? "").trim();
  if (!isValidUpiVpa(vpa)) {
    const err = new AppError("Add this shop's UPI ID under Store profile before collecting by QR", 400);
    err.code = "UPI_NOT_CONFIGURED";
    throw err;
  }
  const payeeName = cleanText(bank.holder, MAX_PAYEE_NAME) || cleanText(shopName, MAX_PAYEE_NAME);
  return {
    vpa,
    payeeName,
    amountPaise,
    link: buildUpiCollectLink({ vpa, payeeName, amountPaise, note, reference }),
    // Said in the response, not only in a comment: whoever renders this must not
    // present it as a payment the system can confirm.
    verified: false,
  };
}
