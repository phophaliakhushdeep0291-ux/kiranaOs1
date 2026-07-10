import assert from "node:assert/strict";
import fs from "node:fs";

// Source-text invariants for auth registration + money safety. Modernized during the
// 2026-07 audit: the original assertions described a retired design (mandatory
// registration PIN, assertFiniteMoney inside weightedAvgCost) and the file was not
// wired into `npm test`, so it silently rotted. It now runs in the test chain.

const authSchema = fs.readFileSync("src/modules/auth/auth.schema.js", "utf8");
const authService = fs.readFileSync("src/modules/auth/auth.service.js", "utf8");
const moneyUtil = fs.readFileSync("src/utils/money.js", "utf8");
const customerService = fs.readFileSync("src/modules/customers/customers.service.js", "utf8");
const udharBalance = fs.readFileSync("src/modules/udhar/udharBalance.service.js", "utf8");

// Registration PIN is optional (set later via /auth/pin/set) but always 4 digits and hashed.
assert.match(authSchema, /ownerPin:\s+z\.string\(\)\.regex\(.*\)\.optional\(\)/, "register schema: ownerPin is an optional 4-digit PIN");
assert.match(authService, /const pinHash = ownerPin \? await bcrypt\.hash\(ownerPin, 10\) : null/, "register must hash the owner PIN when provided");
assert.match(authService, /pinHash, role: "owner"/, "registered owner must store pinHash");

// Udhar overpay guard: ledger-derived, rounded, floored at 0, and exact remaining payment allowed.
assert.match(customerService, /UDHAR_PAYMENT_EXCEEDS_OUTSTANDING/, "udhar overpay must be blocked with a coded error");
assert.match(customerService, /currentBalance\.balance < paymentAmount/, "exact remaining payment must stay allowed (strict <, not <=)");
assert.match(udharBalance, /balance: round2\(Math\.max\(0, rawBalance\)\)/, "udhar balance must be rounded and floored at 0 before comparison");

// weightedAvgCost: overselling means stock/cost can be non-positive; those cases must
// fall back to the fresh purchase price instead of averaging into absurd values.
assert.match(moneyUtil, /export function weightedAvgCost/, "weightedAvgCost must exist");
assert.match(moneyUtil, /if \(!\(currentQty > 0\) \|\| !\(currentCost > 0\)\) return round2\(newCost\)/, "WAC: non-positive stock or cost must fall back to new cost");
assert.match(moneyUtil, /if \(totalQty <= 0\) return round2\(newCost\)/, "WAC: non-positive total quantity must fall back to new cost");

console.log("Production frontend/auth readiness examples passed");
