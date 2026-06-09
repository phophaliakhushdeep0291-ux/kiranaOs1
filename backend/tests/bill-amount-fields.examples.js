import assert from "node:assert/strict";
import { round2 } from "../src/utils/money.js";

function paymentTotalMatchesBill({ grandTotal, paidAmount, creditAmount = 0, waivedAmount = 0 }) {
  return round2(paidAmount + creditAmount + waivedAmount) === round2(grandTotal);
}

function normalizeBillAmountFields({ grandTotal, paidAmount, actualAmount, buyerPaidAmount, waivedAmount }) {
  return {
    actualAmount: round2(actualAmount ?? grandTotal),
    buyerPaidAmount: round2(buyerPaidAmount ?? paidAmount),
    waivedAmount: round2(waivedAmount ?? 0),
  };
}

assert.equal(
  paymentTotalMatchesBill({
    grandTotal: 12345,
    paidAmount: 12340,
    waivedAmount: 5,
  }),
  true,
  "cash/UPI payment plus waived amount should be allowed"
);

assert.equal(
  paymentTotalMatchesBill({
    grandTotal: 12345,
    paidAmount: 12340,
    waivedAmount: 0,
  }),
  false,
  "underpayment without credit or waived amount should be rejected"
);

assert.deepEqual(
  normalizeBillAmountFields({
    grandTotal: 12345,
    paidAmount: 12340,
    waivedAmount: 5,
  }),
  {
    actualAmount: 12345,
    buyerPaidAmount: 12340,
    waivedAmount: 5,
  },
  "bill amount fields should default safely when frontend omits actualAmount/buyerPaidAmount"
);

console.log("Bill amount field examples passed");
