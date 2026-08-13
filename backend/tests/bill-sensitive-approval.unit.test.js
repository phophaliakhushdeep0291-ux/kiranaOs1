import test from "node:test";
import assert from "node:assert/strict";
import { deriveSensitiveBillActions } from "../src/modules/bills/bill-sensitive-approval.js";

function approvalClient() {
  return {
    product: {
      findMany: async () => [{
        id: "product-1",
        defaultPricePerRateUnit: 100,
        minPricePerRateUnit: 0,
        costPerRateUnit: 60,
      }],
    },
    productSellingUnit: { findMany: async () => [] },
    pricingRule: {
      findMany: async () => [{
        id: "rule-1",
        status: "ACTIVE",
        productId: "product-1",
        fixedUnitPrice: 90,
        requiresOwnerApproval: false,
      }],
    },
    customer: { findFirst: async () => null },
  };
}

function billAt(ratePerRateUnit) {
  return {
    items: [{
      productId: "product-1",
      quantity: 2,
      ratePerRateUnit,
      appliedPricingRuleId: "rule-1",
    }],
    discount: 0,
  };
}

test("server accepts only the authoritative price for a claimed pricing rule", async () => {
  const client = approvalClient();

  assert.deepEqual(
    await deriveSensitiveBillActions("shop-1", billAt(90), client),
    [],
  );
  assert.deepEqual(
    await deriveSensitiveBillActions("shop-1", billAt(50), client),
    ["large_discount"],
  );
});
