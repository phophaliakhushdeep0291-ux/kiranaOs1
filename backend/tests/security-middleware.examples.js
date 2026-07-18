import assert from "assert";
import fs from "fs";
import { isAllowedCorsOrigin, parseAllowedOrigins } from "../src/lib/corsOrigins.js";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const appSource = fs.readFileSync("src/app.js", "utf8");
const securitySource = fs.readFileSync("src/middleware/security.js", "utf8");
const errorSource = fs.readFileSync("src/middleware/error.js", "utf8");
const envSource = fs.readFileSync("src/config/env.js", "utf8");
const uploadSource = fs.readFileSync("src/modules/ai/ai.upload.js", "utf8");

assert.ok(packageJson.dependencies?.helmet, "helmet dependency should exist in package.json");
assert.ok(packageLock.packages?.["node_modules/helmet"], "helmet should be present in package-lock.json for npm ci");
assert.ok(!JSON.stringify(packageLock).includes("packages.applied-caas"), "package-lock should not point to internal npm mirror URLs");

assert.ok(appSource.includes('import helmet from "helmet"'), "app.js should import helmet");
assert.ok(appSource.includes("app.use(helmet())"), "app.js should use helmet middleware");
assert.ok(appSource.indexOf("app.use(helmet())") < appSource.indexOf("app.use(securityHeaders)"), "helmet should run before custom security headers");

assert.ok(appSource.includes('app.disable("x-powered-by")'), "x-powered-by should be disabled");
assert.ok(securitySource.includes("Strict-Transport-Security"), "custom production HSTS header should remain");
assert.ok(securitySource.includes("X-Content-Type-Options"), "custom security headers should remain");
assert.ok(securitySource.includes("apiLimiter"), "API rate limiter should remain");
assert.ok(securitySource.includes("authLimiter"), "auth rate limiter should remain");
assert.ok(securitySource.includes("aiLimiter"), "AI rate limiter should remain");

assert.ok(envSource.includes("ALLOWED_ORIGINS"), "CORS origins should come from env");
assert.ok(appSource.includes("parseAllowedOrigins(env.ALLOWED_ORIGINS)"), "app CORS should use env.ALLOWED_ORIGINS");
assert.ok(appSource.includes("CORS_ORIGIN_DENIED"), "blocked CORS origins should return a stable production error code");
const configuredOrigins = parseAllowedOrigins("http://localhost:5173, https://app.example.com");
assert.equal(isAllowedCorsOrigin("http://127.0.0.1:5173", configuredOrigins, "development"), true, "development should accept an equivalent IPv4 loopback origin");
assert.equal(isAllowedCorsOrigin("http://[::1]:5173", configuredOrigins, "development"), true, "development should accept an equivalent IPv6 loopback origin");
assert.equal(isAllowedCorsOrigin("http://127.0.0.1:4173", configuredOrigins, "development"), false, "development loopback aliases must still match the configured port");
assert.equal(isAllowedCorsOrigin("http://127.0.0.1:5173", configuredOrigins, "production"), false, "production must keep exact origin matching");
assert.equal(isAllowedCorsOrigin("https://app.example.com", configuredOrigins, "production"), true, "production should accept an explicitly configured origin");
assert.ok(appSource.includes("crypto.timingSafeEqual"), "metrics token checks should use constant-time comparison");
assert.ok(appSource.includes('express.json({ limit: "2mb" })'), "JSON body size limit should exist");
assert.ok(uploadSource.includes("25 * 1024 * 1024"), "AI upload size limit should exist");
assert.ok(errorSource.includes('env.NODE_ENV === "development"'), "stack/error details should be development-only");
assert.ok(errorSource.includes("INVALID_JSON"), "invalid JSON should return a clean 400 error");
assert.ok(errorSource.includes("REQUEST_BODY_TOO_LARGE"), "oversized bodies should return a clean 413 error");

console.log("Security middleware examples passed");
