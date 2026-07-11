import assert from "node:assert/strict";
import fs from "node:fs";

// Source-text invariants for Google sign-in. The verifier must be strict (Google's
// certs, OUR audience, verified email only) and the account matching must never let
// one Google identity reach an account already linked to a different one.

function read(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

const googleService = read("../src/modules/auth/google.service.js");
const authService = read("../src/modules/auth/auth.service.js");
const authSchema = read("../src/modules/auth/auth.schema.js");
const authRoutes = read("../src/modules/auth/auth.routes.js");
const authController = read("../src/modules/auth/auth.controller.js");
const envConfig = read("../src/config/env.js");

// Verifier strictness
assert.match(googleService, /algorithms: \["RS256"\]/, "must pin RS256 (no alg confusion)");
assert.match(googleService, /audience: env\.GOOGLE_CLIENT_ID/, "must verify the token was minted for OUR client id");
assert.match(googleService, /accounts\.google\.com/, "must verify the Google issuer");
assert.match(googleService, /email_verified/, "must require a verified Google email");
assert.match(googleService, /GOOGLE_LOGIN_NOT_CONFIGURED/, "must fail closed (503) when GOOGLE_CLIENT_ID is unset");
assert.match(googleService, /googleapis\.com\/oauth2\/v1\/certs/, "must verify against Google's published certs");

// Login semantics
assert.match(authService, /googleSub: identity\.sub/, "first Google sign-in must link googleSub");
assert.match(authService, /u\.googleSub === identity\.sub/, "linked-sub matches take priority over email matches");
assert.match(authService, /users\.filter\(\(u\) => !u\.googleSub\)/, "an email already linked to a DIFFERENT Google account must not match");
assert.match(authService, /GOOGLE_ACCOUNT_NOT_REGISTERED/, "unknown Google accounts are sent to registration");
assert.ok(authService.includes("SHOP_SELECTION_REQUIRED") , "multi-shop Google logins reuse the shop-selection contract");
assert.match(authService, /return issueAuthResponse\(user, user\.shop, reqMeta\)/, "Google login must issue the SAME session/device flow as password login");

// Wiring
assert.match(authSchema, /googleLoginSchema/, "google login body schema must exist");
assert.match(authRoutes, /router\.post\("\/google",\s*validate\(googleLoginSchema\), ctrl\.googleLogin\)/, "POST /auth/google must be mounted with validation");
assert.match(authController, /authService\.googleLogin\(req\.body, requestMeta\(req\)\)/, "controller must pass device/request meta");
assert.match(envConfig, /GOOGLE_CLIENT_ID: z\.string\(\)\.optional\(\)/, "GOOGLE_CLIENT_ID env must be declared optional");

// Schema: googleSub on User in BOTH database schemas
for (const [name, schema] of [["sqlite", read("../prisma/schema.prisma")], ["postgres", read("../prisma-postgres/schema.prisma")]]) {
  assert.ok(schema.includes("googleSub    String?"), `${name} User must store googleSub`);
  assert.ok(schema.includes("@@index([googleSub])"), `${name} User must index googleSub`);
}

console.log("google-auth.examples.js OK");
