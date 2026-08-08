import assert from "node:assert/strict";
import {
  CHANNEL_SETTLEMENT_LIMITATIONS,
  CHANNEL_SETTLEMENT_VERSION,
  parseChannelSettlementCsv,
} from "../src/modules/finance/channel-settlement.service.js";

const mapping = {
  externalOrderId: "Order ID",
  orderDate: "Date",
  orderStatus: "Status",
  gross: "Gross",
  merchantDiscount: "Discount",
  platformCommission: "Commission",
  paymentFee: "Fee",
  taxOnFees: "Tax",
  tcs: "TCS",
  tds: "TDS",
  adjustment: "Adjustment",
  refund: "Refund",
  expectedNet: "Provider Net",
  paidNet: "Paid Net",
};

const parsed = parseChannelSettlementCsv([
  "Order ID,Date,Status,Gross,Discount,Commission,Fee,Tax,TCS,TDS,Adjustment,Refund,Provider Net,Paid Net",
  '"ORDER,100",08/08/2026,delivered,"1,000.00",50,100,10,1.80,10,10,-5,20,793.20,793.20',
].join("\n"), mapping);

assert.equal(CHANNEL_SETTLEMENT_VERSION, "channel-settlement-v1");
assert.equal(parsed.rows.length, 1);
assert.equal(parsed.rows[0].externalOrderId, "ORDER,100");
assert.equal(parsed.rows[0].grossPaise, 100000n);
assert.equal(parsed.rows[0].calculatedExpectedNetPaise, 79320n);
assert.equal(parsed.rows[0].providerExpectedNetPaise, 79320n);
assert.equal(parsed.rows[0].variancePaise, 0n);
assert.ok(CHANNEL_SETTLEMENT_LIMITATIONS.some((item) => /never|does not|no proprietary/i.test(item)));

assert.throws(
  () => parseChannelSettlementCsv("Order ID,Date,Gross,Paid Net\nBAD,not-a-date,100,100", { externalOrderId: "Order ID", orderDate: "Date", gross: "Gross", paidNet: "Paid Net" }),
  (error) => error?.code === "CHANNEL_SETTLEMENT_ROW_INVALID",
);

console.log("Channel settlement calculation examples passed");
