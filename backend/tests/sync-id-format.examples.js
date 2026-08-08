import assert from "node:assert/strict";
import { looksLikeClientLocalId } from "../src/modules/sync/sync.service.js";

for (const localId of [
  "local_product_1",
  "product_019c1234",
  "customer_counter_2",
  "bill_offline_3",
  "payment_pending_4",
  "temp-stock-5",
]) {
  assert.equal(looksLikeClientLocalId(localId), true, `${localId} is an explicit client-local identity`);
}

for (const durableServerId of [
  "cmrs6m2ik0060u66k5s9b2iz1",
  "018f47a6-7f5d-7c41-8bd8-fc89d00d12a3",
  "550e8400-e29b-41d4-a716-446655440000",
  "01J4Z3H6Y1AH7J8C7F18M2QH3K",
]) {
  assert.equal(
    looksLikeClientLocalId(durableServerId),
    false,
    `${durableServerId} must remain valid if the server migrates from CUID to UUID/ULID`,
  );
}

console.log("Sync id-format examples passed");
