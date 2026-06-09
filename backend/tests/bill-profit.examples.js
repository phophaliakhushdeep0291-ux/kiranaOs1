import assert from "node:assert/strict";
import { round2 } from "../src/utils/money.js";

function calculateGrossProfit({ itemProfit, discount = 0, waivedAmount = 0 }) {
  return round2(itemProfit - discount - waivedAmount);
}

assert.equal(
  calculateGrossProfit({ itemProfit: 100, discount: 0, waivedAmount: 0 }),
  100,
  "without discount/waived amount, grossProfit should equal itemProfit"
);

assert.equal(
  calculateGrossProfit({ itemProfit: 100, discount: 10, waivedAmount: 0 }),
  90,
  "discount should reduce grossProfit"
);

assert.equal(
  calculateGrossProfit({ itemProfit: 100, discount: 0, waivedAmount: 5 }),
  95,
  "waived/let-go amount should reduce grossProfit"
);

assert.equal(
  calculateGrossProfit({ itemProfit: 100, discount: 10, waivedAmount: 5 }),
  85,
  "discount and waived amount should both reduce grossProfit"
);

assert.equal(
  calculateGrossProfit({ itemProfit: 3, discount: 1.25, waivedAmount: 0.5 }),
  1.25,
  "grossProfit should stay rounded to two decimals"
);

console.log("Bill profit examples passed");
