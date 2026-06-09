import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const security = fs.readFileSync(path.join(root, "src/middleware/security.js"), "utf8");

assert.match(security, /function routeBucket\(req\)/, "rate limiter should bucket by route");
assert.match(security, /reports:\$\{parts\[1\]\}/, "report widgets should be isolated by report route");
assert.match(security, /sync:\$\{parts\[1\]\}/, "sync status/pull/push should have their own bucket");
assert.match(security, /device:\$\{deviceId\.trim\(\)\}/, "rate limit should key by device when x-device-id is present");
assert.match(security, /read" : "write"/, "read and write requests should be rate-limited separately");
assert.match(security, /Math\.max\(max, 1000000\)/, "development should not rate-limit local multi-device testing aggressively");
assert.match(security, /function apiRateLimitMax\(req\)/, "API limiter should use route-aware limit function");
assert.match(security, /if \(isReadRequest\(req\)\) return Math\.max\(base, 1800\)/, "production read routes should tolerate multi-device POS polling");
assert.match(security, /Retry-After", isReadRequest\(_req\) \? "3" : "10"/, "read/write 429 retry hints should differ");

console.log("Phase 44 multi-session rate limit examples passed");
