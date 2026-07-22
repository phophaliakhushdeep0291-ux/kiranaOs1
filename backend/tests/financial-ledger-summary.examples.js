import assert from "assert";
import { summarizeFinancialLedger } from "../src/modules/finance/financial-ledger.service.js";

// Proves the ledger's "reversal = same entryType, negated amount" convention: KPIs are plain
// grouped sums, so cancellations net to zero and outstanding = udhar_debit - udhar_credit.
const P = (rupees) => BigInt(Math.round(rupees * 100));

// A credit bill: sale ₹100, ₹60 cash now, ₹40 on udhar.
const billRows = [
  { entryType: "sale", amountPaise: P(100) },
  { entryType: "cash_in", amountPaise: P(60) },
  { entryType: "udhar_debit", amountPaise: P(40) },
];

let s = summarizeFinancialLedger(billRows);
assert.equal(s.sales, 100, "sales = sum(sale)");
assert.equal(s.cashCollected, 60, "cash = sum(cash_in)");
assert.equal(s.udharCreated, 40, "udhar created = sum(udhar_debit)");
assert.equal(s.outstanding, 40, "outstanding = debit - credit");

// Cancelling the bill posts negated rows of the SAME entryTypes → everything nets to zero.
const cancelled = [...billRows, ...billRows.map((r) => ({ entryType: r.entryType, amountPaise: -r.amountPaise }))];
s = summarizeFinancialLedger(cancelled);
assert.equal(s.sales, 0, "cancel nets sales to 0");
assert.equal(s.cashCollected, 0, "cancel nets cash to 0");
assert.equal(s.outstanding, 0, "cancel nets outstanding to 0");

// Later the customer pays the ₹40 udhar in cash: cash_in + udhar_credit.
const withUdharPayment = [
  ...billRows,
  { entryType: "cash_in", amountPaise: P(40) },
  { entryType: "udhar_credit", amountPaise: P(40) },
];
s = summarizeFinancialLedger(withUdharPayment);
assert.equal(s.sales, 100, "sale unchanged by payment");
assert.equal(s.cashCollected, 100, "cash = 60 (bill) + 40 (udhar payment)");
assert.equal(s.udharRecovered, 40, "udhar recovered = sum(udhar_credit)");
assert.equal(s.outstanding, 0, "outstanding back to 0 after full repayment");

// A return credited against udhar reduces outstanding without pretending that
// the customer paid cash. Gift-card return credit is retained as a liability KPI.
s = summarizeFinancialLedger([
  ...billRows,
  { entryType: "udhar_return_credit", amountPaise: P(15) },
  { entryType: "gift_card_issued", amountPaise: P(25) },
]);
assert.equal(s.udharRecovered, 0, "return credit is not a customer recovery");
assert.equal(s.udharReturnCredits, 15, "udhar return credits are separately auditable");
assert.equal(s.outstanding, 25, "return credit reduces outstanding");
assert.equal(s.giftCardIssued, 25, "gift-card return liability is visible");

// Unknown entry types are ignored; empty input is all zeros.
s = summarizeFinancialLedger([{ entryType: "mystery", amountPaise: P(999) }, { entryType: "sale", amountPaise: P(5) }]);
assert.equal(s.sales, 5, "unknown entryType ignored");
assert.deepEqual(summarizeFinancialLedger([]), {
  sales: 0, cashCollected: 0, upiCollected: 0, bankCollected: 0, udharCreated: 0, udharRecovered: 0, udharReturnCredits: 0, giftCardIssued: 0, giftCardRedeemed: 0, waiverExpense: 0, outstanding: 0,
}, "empty ledger = all zeros");

// Accepts number / numeric-string amountPaise too (not just BigInt).
s = summarizeFinancialLedger([{ entryType: "upi_in", amountPaise: 2500 }, { entryType: "upi_in", amountPaise: "2500" }]);
assert.equal(s.upiCollected, 50, "number + string paise both summed");

// Bank transfers are tracked separately from UPI so owners can reconcile bank deposits.
s = summarizeFinancialLedger([{ entryType: "bank_in", amountPaise: P(125) }]);
assert.equal(s.bankCollected, 125, "bank = sum(bank_in)");

console.log("financial-ledger-summary.examples.js OK");
