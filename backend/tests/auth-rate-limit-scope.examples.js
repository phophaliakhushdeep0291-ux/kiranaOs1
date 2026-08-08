import assert from "node:assert/strict";
import { shouldSkipAuthRateLimit } from "../src/middleware/security.js";

const request = (method, path) => ({ method, path, originalUrl: `/api/auth${path}` });

for (const path of ["/me", "/pin/check", "/staff"]) {
  assert.equal(
    shouldSkipAuthRateLimit(request("GET", path)),
    true,
    `${path} must not consume the credential brute-force bucket`,
  );
}

for (const path of [
  "/register", "/login", "/google", "/password/forgot", "/password/reset",
  "/refresh", "/device-replacement/complete", "/pin/verify", "/change-password",
]) {
  assert.equal(
    shouldSkipAuthRateLimit(request("POST", path)),
    false,
    `${path} must retain brute-force protection`,
  );
}

assert.equal(shouldSkipAuthRateLimit(request("OPTIONS", "/login")), true, "CORS preflight must not consume attempts");
assert.equal(
  shouldSkipAuthRateLimit({ method: "GET", path: "/api/auth/me", originalUrl: "/api/auth/me" }),
  true,
  "full auth paths must normalize the same way as mounted Express paths",
);

console.log("Auth rate-limit scope examples passed");
