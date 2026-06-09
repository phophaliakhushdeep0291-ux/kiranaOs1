/**
 * Phase 1 security static assertions retained in npm test chain.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

function read(file) { return fs.readFileSync(file, "utf8"); }

const envConfig = read("src/config/env.js");
const authService = read("src/modules/auth/auth.service.js");
const authSchema = read("src/modules/auth/auth.schema.js");
const errorMiddleware = read("src/middleware/error.js");
const packageJson = JSON.parse(read("package.json"));

assert.doesNotMatch(envConfig, /JWT_EXPIRES_IN.*default\("7d"\)/, "JWT access token default must not be 7d");
assert.match(envConfig, /JWT_EXPIRES_IN.*default\("15m"\)/, "JWT access token default should be short-lived");

assert.doesNotMatch(
  authService,
  /findFirst\(\s*\{\s*where:\s*\{\s*mobile\s*\}\s*\}\s*\)/,
  "register/login must not depend on a global mobile pre-check"
);
assert.match(authSchema, /shopId:\s+z\.string\(\)\.optional\(\)/, "login schema must support optional shopId selection");
assert.match(authService, /SHOP_SELECTION_REQUIRED/, "login must require shop selection when the same mobile exists in multiple shops");
assert.match(authService, /findMany\(\{[\s\S]*mobile[\s\S]*shopId/, "login must search by mobile and optional shopId");
assert.match(errorMiddleware, /err\.code/, "error middleware must return safe application error codes");

assert.ok(packageJson.scripts["test:billing"].includes("phase1-security.examples.js"), "test chain must include phase1-security.examples.js");

console.log("Phase 1 security examples passed");
