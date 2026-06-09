import assert from "assert";
import fs from "fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

const app = read("src/app.js");
const security = read("src/middleware/security.js");
const error = read("src/middleware/error.js");
const server = read("src/server.js");
const env = read("src/config/env.js");
const envExample = read(".env.example");
const deploy = read("DEPLOY.md");
const readme = read("README.md");

assert.ok(security.includes('export function requestId'), "requestId middleware must exist");
assert.ok(security.includes('crypto.randomUUID'), "requestId should generate UUIDs");
assert.ok(security.includes('X-Request-Id'), "responses must include X-Request-Id");
assert.ok(app.indexOf('app.use(requestId)') < app.indexOf('app.use(helmet())'), "requestId must run before security/logging middleware");
assert.ok(security.includes('type: "http_request"'), "request logs must be structured JSON");
assert.ok(security.includes('userId: req.user?.userId ?? req.user?.id'), "request logs must use correct JWT userId field");
assert.ok(security.includes('code: "RATE_LIMITED"'), "API rate limit response must include stable code");
assert.ok(security.includes('code: "AUTH_RATE_LIMITED"'), "auth rate limit response must include stable code");
assert.ok(security.includes('code: "AI_RATE_LIMITED"'), "AI rate limit response must include stable code");
assert.ok(security.includes('requestId: req.requestId'), "rate-limit responses must include requestId");
assert.ok(error.includes('requestId: req?.requestId'), "error responses must include requestId");
assert.ok(error.includes('type: "unhandled_error"'), "unhandled errors must be structured logs");
assert.ok(error.includes('env.NODE_ENV === "development"'), "error handler must keep production errors safe");
assert.ok(app.includes('app.get("/health/ready"'), "readiness endpoint must exist");
assert.ok(app.includes('db.$queryRaw`SELECT 1`'), "readiness endpoint must check database");
assert.ok(server.includes('process.on("SIGTERM"'), "server must handle SIGTERM gracefully");
assert.ok(server.includes('type: "startup"'), "startup logs must be structured JSON");
assert.ok(server.includes('type: "shutdown"'), "shutdown logs must be structured JSON");
assert.ok(server.includes("closeHttpServer"), "shutdown must close the HTTP listener before exit");
assert.ok(server.includes("closeRedis"), "shutdown must close Redis connections before exit");
assert.ok(server.includes("shutdown_forced"), "shutdown must have a bounded timeout");
assert.ok(env.includes('LOG_LEVEL'), "LOG_LEVEL must be documented in env schema");
assert.ok(envExample.includes('LOG_LEVEL=info'), ".env.example must include LOG_LEVEL");
assert.ok(deploy.includes('## Observability'), "DEPLOY.md must include observability notes");
assert.ok(readme.includes('## Step 9 Observability'), "README must include Step 9 observability notes");

console.log("Observability examples passed");
