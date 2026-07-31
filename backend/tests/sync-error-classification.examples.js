import assert from "node:assert/strict";
import { classifySyncError } from "../src/utils/syncRules.js";
import { explainSyncFailure } from "../src/modules/sync/sync-explain.js";
import { AppError } from "../src/middleware/error.js";

// A shop's bills would not back up, and Cloud Backup said:
//
//   "Saving a bill failed because of a temporary server problem.
//    This will retry automatically when the connection is healthy."   Retries: 108
//
// Nothing was temporary and nothing was a server problem. classifySyncError
// treated permanent 4xx business errors as retryable 5xx, because it recognised
// only an allowlist of [400, 404, 409] and defaulted everything else to
// SERVER_ERROR/retryable. The app throws 41 different 422s.

// ── the exact production case ───────────────────────────────────────
// A location with no GSTIN issuing a GST invoice. Permanent until someone
// types a GSTIN into settings — retrying it a thousand times cannot help.
const gstinMissing = new AppError(
  "This location needs a valid GSTIN before issuing a GST invoice",
  422,
  "SELLER_GSTIN_REQUIRED",
);

const classified = classifySyncError(gstinMissing);
assert.equal(classified.retryable, false, "a 422 must not be retried forever");
assert.equal(classified.code, "SELLER_GSTIN_REQUIRED", "the owner needs the specific cause, not SERVER_ERROR");

const explained = explainSyncFailure({ type: "CREATE_BILL", ...gstinMissing, message: gstinMissing.message, code: gstinMissing.code, statusCode: 422 });
assert.match(explained.explanation, /GSTIN/, "the explanation names what to fix");
assert.equal(explained.retryable, false);
assert.match(explained.action, /needs attention/, "it must stop promising an automatic retry");

// ── every other permanent 4xx the app actually throws ───────────────
for (const [status, label] of [[402, "subscription"], [413, "payload too large"], [400, "bad request"], [404, "not found"], [409, "conflict"]]) {
  const result = classifySyncError(new AppError(`failed: ${label}`, status));
  assert.equal(result.retryable, false, `${status} (${label}) must not be auto-retried`);
}

// ── things that genuinely deserve another attempt ───────────────────
for (const status of [500, 502, 503, 504]) {
  assert.equal(classifySyncError(new AppError("upstream died", status)).retryable, true, `${status} is a real server error`);
}
// The request was fine, the server just wasn't ready for it yet.
for (const status of [408, 425, 429]) {
  assert.equal(classifySyncError(new AppError("try again", status)).retryable, true, `${status} should retry`);
}

// ── unchanged behaviour worth keeping ───────────────────────────────
assert.equal(classifySyncError({ name: "ZodError", message: "bad shape" }).code, "INVALID_EVENT");
assert.equal(classifySyncError({ statusCode: 403 }).code, "PERMISSION_DENIED");
assert.equal(classifySyncError({ statusCode: 403 }).retryable, false);
// No status at all still means "unknown, worth a retry" — that is the only case
// where assuming a server fault is the safe reading.
assert.equal(classifySyncError(new Error("socket hang up")).retryable, true);

console.log("sync-error-classification.examples.js OK");
