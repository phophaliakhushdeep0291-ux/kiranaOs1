import assert from "assert";
import { ACCOUNTING_CONTROL_VERSION, buildAccountingControl } from "../src/modules/finance/accounting-control.service.js";

const P = (rupees) => BigInt(Math.round(rupees * 100));
const row = (entryType, amount, sourceId = "bill-1", extra = {}) => ({
  id: `${sourceId}:${entryType}:${amount}`,
  sourceType: extra.sourceType ?? "bill",
  sourceId,
  entryType,
  amountPaise: P(amount),
  businessDate: "2026-07-22T10:00:00.000Z",
  ...extra,
});

let control = buildAccountingControl([
  row("sale", 100),
  row("cash_in", 60),
  row("udhar_debit", 40),
]);
assert.equal(control.status, "balanced");
assert.equal(control.calculationVersion, ACCOUNTING_CONTROL_VERSION);
assert.equal(control.coverage.balancedGroups, 1);
assert.equal(control.periodActivity.debit.paise, 10_000);
assert.equal(control.periodActivity.credit.paise, 10_000);
assert.equal(control.trialBalance.difference.paise, 0);

control = buildAccountingControl([
  row("sale", 100, "gift-waiver"),
  row("cash_in", 70, "gift-waiver"),
  row("gift_card_redeemed", 25, "gift-waiver"),
  row("waiver_expense", 5, "gift-waiver"),
]);
assert.equal(control.status, "balanced", "gift redemption and waived amount complete the sale journal");
assert.equal(control.trialBalance.accounts.find((account) => account.code === "2100")?.debitBalance.amount, 25);
assert.equal(control.trialBalance.accounts.find((account) => account.code === "6100")?.debitBalance.amount, 5);

control = buildAccountingControl([
  row("sale", -25, "return-1", { sourceType: "sale_return" }),
  row("gift_card_issued", 25, "return-1", { sourceType: "sale_return" }),
]);
assert.equal(control.status, "balanced", "return credit balances sales return against gift liability");

control = buildAccountingControl([
  row("supplier_payment", 50, "supplier-pay-1", { sourceType: "supplier_payment", paymentMode: "upi" }),
  row("supplier_payment", -50, "supplier-pay-1", { sourceType: "supplier_payment_reversal", paymentMode: "upi" }),
]);
assert.equal(control.status, "balanced", "supplier payment and its reversal are each balanced double entries");
assert.equal(control.coverage.balancedGroups, 2);
assert.equal(control.periodActivity.debit.paise, 10_000);
assert.equal(control.periodActivity.credit.paise, 10_000);
assert.equal(control.trialBalance.debit.paise, 0);
assert.equal(control.trialBalance.credit.paise, 0);

control = buildAccountingControl([row("sale", 100, "legacy-gift"), row("cash_in", 75, "legacy-gift")]);
assert.equal(control.status, "attention_required");
assert.equal(control.coverage.exceptionGroups, 1);
assert.equal(control.exceptions[0].difference.amount, -25);

control = buildAccountingControl([row("unmapped_future_event", 12)]);
assert.equal(control.status, "attention_required");
assert.equal(control.coverage.unmappedRows, 1);
assert.deepEqual(control.exceptions[0].unmappedEntryTypes, ["unmapped_future_event"]);
assert.ok(control.limitations.some((item) => item.includes("does not claim statutory books are complete")));

control = buildAccountingControl([]);
assert.equal(control.status, "no_data");
assert.equal(control.coverage.ledgerRows, 0);

console.log("accounting-control.examples.js OK");