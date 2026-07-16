import assert from "node:assert/strict";
import {
  reapplyBillOfferRedemption,
  redeemOffer,
  redeemOfferInTransaction,
  reverseBillOfferRedemption,
  validateOfferForBill,
} from "../src/modules/offers/offers.service.js";

const liveOffer = {
  id: "offer-1",
  shopId: "shop-1",
  title: "Ten percent",
  code: "SAVE10",
  type: "percentage",
  value: 10,
  minBillAmount: 500,
  maxDiscount: 80,
  validFrom: null,
  validTo: null,
  usageLimit: 2,
  usedCount: 0,
  discountGiven: 0,
  active: true,
  deletedAt: null,
};

const writes = [];
const client = {
  offer: {
    async findFirst() { return { ...liveOffer }; },
    async updateMany(input) { writes.push(input); return { count: 1 }; },
  },
};

const validated = await validateOfferForBill(client, "shop-1", {
  offerId: "offer-1",
  code: "save10",
  subtotal: 1_000,
});
assert.equal(validated.offer.id, "offer-1");
assert.equal(validated.discount, 80, "percentage discount must respect its server-side cap");

await assert.rejects(
  validateOfferForBill(client, "shop-1", { offerId: "offer-1", code: "WRONG", subtotal: 1_000 }),
  (error) => error?.code === "OFFER_CODE_MISMATCH",
);
await assert.rejects(
  validateOfferForBill(client, "shop-1", { offerId: "offer-1", code: "SAVE10", subtotal: 100 }),
  (error) => error?.code === "OFFER_MINIMUM_NOT_MET",
);

await redeemOfferInTransaction(client, "shop-1", validated);
assert.deepEqual(writes.at(-1).data, {
  usedCount: { increment: 1 },
  discountGiven: { increment: 80 },
});
assert.ok(writes.at(-1).where.AND.some((condition) => condition.OR?.some((row) => row.usedCount?.lt === 2)), "atomic claim must enforce the usage limit");

await reverseBillOfferRedemption(client, "shop-1", { offerId: "offer-1", offerDiscount: 80, billType: "normal_sale" });
assert.deepEqual(writes.at(-1).data, {
  usedCount: { decrement: 1 },
  discountGiven: { decrement: 80 },
});

await reapplyBillOfferRedemption(client, "shop-1", { offerId: "offer-1", offerDiscount: 80, billType: "normal_sale" });
assert.deepEqual(writes.at(-1).data, {
  usedCount: { increment: 1 },
  discountGiven: { increment: 80 },
});

const losingClient = {
  offer: {
    async updateMany() { return { count: 0 }; },
  },
};
await assert.rejects(
  redeemOfferInTransaction(losingClient, "shop-1", validated),
  (error) => error?.code === "OFFER_REDEMPTION_CONFLICT",
  "a concurrent final redemption must fail instead of exceeding the usage limit",
);
await assert.rejects(
  redeemOffer("shop-1", "offer-1", 80),
  (error) => error?.code === "OFFER_REDEMPTION_REQUIRES_BILL",
  "standalone client-trusted redemption must remain disabled",
);

console.log("offer-bill-atomicity.examples.js OK");
