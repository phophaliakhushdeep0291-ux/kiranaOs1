import assert from "node:assert/strict";
import fs from "node:fs";

const authSchema = fs.readFileSync("src/modules/auth/auth.schema.js", "utf8");
const authService = fs.readFileSync("src/modules/auth/auth.service.js", "utf8");
const moneyUtil = fs.readFileSync("src/utils/money.js", "utf8");
const customerService = fs.readFileSync("src/modules/customers/customers.service.js", "utf8");

assert.match(authSchema, /ownerPin:\s*z\.string\(\)\.regex/, "register schema must require ownerPin");
assert.match(authService, /const pinHash = await bcrypt\.hash\(ownerPin, 10\)/, "register must hash owner PIN");
assert.match(authService, /pinHash, role: "owner"/, "registered owner must store pinHash");
assert.match(customerService, /toPaise\(Number\(customer\.udharAmount/, "udhar payment comparison must use paise");
assert.match(moneyUtil, /currentQty, newQty/, "weightedAvgCost should validate quantities");
assert.match(moneyUtil, /assertFiniteMoney\(currentCost/, "weightedAvgCost should validate currentCost");
assert.match(moneyUtil, /assertFiniteMoney\(newCost/, "weightedAvgCost should validate newCost");

console.log("Production frontend/auth readiness examples passed");
