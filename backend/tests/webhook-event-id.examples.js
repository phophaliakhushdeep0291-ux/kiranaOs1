import assert from "assert";
import { getWebhookEventId } from "../src/modules/payment-provider/paymentProvider.service.js";

// #11 (CODE_REVIEW_LOGIC_FLAWS.md): a webhook with no provider id must still dedup. The fallback
// must be a DETERMINISTIC content fingerprint, not Date.now(), so retries of the same id-less
// payload map to a single provider_eventId row instead of being reprocessed on every delivery
// (which could, e.g., activate a subscription twice).

// Explicit provider ids always win.
assert.equal(getWebhookEventId({ id: "evt_123" }), "evt_123", "top-level id wins");
assert.equal(getWebhookEventId({ payload: { payment: { entity: { id: "pay_9" } } } }), "pay_9", "nested payment id wins");
assert.equal(getWebhookEventId({ payload: { order: { entity: { id: "order_7" } } } }), "order_7", "nested order id wins");

// Id-less payload: deterministic across calls (would be unique per call with Date.now()).
const a = getWebhookEventId({ event: "payment.captured", amount: 5000 });
const b = getWebhookEventId({ event: "payment.captured", amount: 5000 });
assert.equal(a, b, "same id-less payload must produce the same dedup id");
assert.ok(a.startsWith("razorpay-fp-"), "id-less fallback must be a content fingerprint");

// Different content → different id (so genuinely distinct events are not collapsed).
const c = getWebhookEventId({ event: "payment.captured", amount: 9999 });
assert.notEqual(a, c, "different id-less payloads must produce different dedup ids");

console.log("webhook-event-id.examples.js OK");
