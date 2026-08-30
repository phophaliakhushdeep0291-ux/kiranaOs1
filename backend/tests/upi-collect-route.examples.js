import assert from "node:assert/strict";
import db from "../src/db.js";
import { upiCollect } from "../src/modules/shops/shops.controller.js";

const shop = await db.shop.create({
  data: {
    name: `UPI route ${Date.now()}`,
    ownerName: "Owner",
    city: "Pune",
    address: "Test",
    settingsJson: JSON.stringify({
      bank: { upi: "route-test@ybl", holder: "Route Test Restaurant" },
    }),
  },
});

try {
  let response = null;
  let forwardedError = null;
  const req = {
    shopId: shop.id,
    body: { amountPaise: 18000, note: "Table 1" },
  };
  const res = {
    json(payload) {
      response = payload;
      return payload;
    },
  };

  await upiCollect(req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError, null, `the UPI collection controller must not fail: ${forwardedError?.message ?? ""}`);
  assert.equal(response?.success, true);
  assert.equal(response?.data?.amountPaise, 18000);
  assert.equal(response?.data?.verified, false);
  assert.equal(response?.data?.vpa, "route-test@ybl");
  assert.match(response?.data?.link ?? "", /^upi:\/\/pay\?/);
} finally {
  await db.$disconnect();
}

console.log("UPI collection route example passed");
