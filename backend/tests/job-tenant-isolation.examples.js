import assert from "node:assert/strict";
import fs from "node:fs";

process.env.NODE_ENV ||= "test";
process.env.DATABASE_URL ||= "file:./prisma/dev.db";
process.env.JWT_SECRET ||= "integration-test-secret-that-is-long-enough";
process.env.ALLOWED_ORIGINS ||= "http://localhost:5500";

const { __queueInternals } = await import("../src/lib/queue.js");

const shopAJob = { data: { shopId: "shop-a" } };
const shopBJob = { data: { shopId: "shop-b" } };
const infrastructureJob = { data: { limit: 100 } };

assert.equal(__queueInternals.jobBelongsToShop(shopAJob, "shop-a"), true);
assert.equal(__queueInternals.jobBelongsToShop(shopBJob, "shop-a"), false);
assert.equal(__queueInternals.jobBelongsToShop(infrastructureJob, "shop-a"), false);
assert.throws(
  () => __queueInternals.jobBelongsToShop(shopAJob, ""),
  (error) => error?.code === "SHOP_SCOPE_REQUIRED",
);

assert.deepEqual(__queueInternals.boundedRange(0, 20, 50), { start: 0, end: 21 });
assert.deepEqual(__queueInternals.boundedRange(-10, 2, 2), { start: 0, end: 2 });

const queueSource = fs.readFileSync("src/lib/queue.js", "utf8");
const controllerSource = fs.readFileSync("src/modules/jobs/jobs.controller.js", "utf8");
const routeSource = fs.readFileSync("src/modules/jobs/jobs.routes.js", "utf8");

assert.match(queueSource, /jobBelongsToShop\(job,\s*shopId\)/, "job mutation must verify shop ownership");
assert.match(queueSource, /getShopJobs\(queue,\s*\["failed"\],\s*shopId\)/, "failed jobs must be filtered by shop");
assert.match(controllerSource, /retryFailedJob\(queueName,\s*req\.params\.jobId,\s*req\.shopId\)/);
assert.match(controllerSource, /discardFailedJob\(queueName,\s*req\.params\.jobId,\s*req\.shopId\)/);
assert.doesNotMatch(routeSource, /queues\/:queueName\/(pause|resume)/, "tenant API must not expose platform-wide queue controls");

console.log("Job tenant isolation examples passed");
