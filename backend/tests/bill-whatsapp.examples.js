import test from "node:test";
import assert from "node:assert/strict";
import { buildHindiBillMessage } from "../src/modules/bills/bill-whatsapp.service.js";
import { getPlanConfig } from "../src/modules/subscription/planConfig.js";

test("completed bill message is Hindi-first and paise exact", () => {
  const text = buildHindiBillMessage({ shopName: "राम किराना", billNo: "K-42", totalPaise: 12345, previousUdharPaise: 6789, showPreviousUdhar: true });
  assert.match(text.split("\n")[0], /राम किराना से आपका बिल/);
  assert.match(text, /बिल नंबर: K-42/);
  assert.match(text, /₹123\.45/);
  assert.match(text, /पिछला उधार: ₹67\.89/);
});

test("previous udhar follows the receipt toggle and real balance", () => {
  const base = { shopName: "Shop", billNo: "1", totalPaise: 100 };
  assert.doesNotMatch(buildHindiBillMessage({ ...base, previousUdharPaise: 0, showPreviousUdhar: true }), /पिछला उधार/);
  assert.doesNotMatch(buildHindiBillMessage({ ...base, previousUdharPaise: 999, showPreviousUdhar: false }), /पिछला उधार/);
});

test("Starter includes single bill WhatsApp but not automated reminders", () => {
  assert.ok(getPlanConfig("starter").features.includes("single_bill_whatsapp"));
  assert.equal(getPlanConfig("starter").features.includes("whatsapp_reminders"), false);
});
