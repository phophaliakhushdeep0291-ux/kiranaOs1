import assert from "assert";
import fs from "fs";

function read(file) { return fs.readFileSync(file, "utf8"); }
function exists(file) { return fs.existsSync(file); }

for (const file of [
  "prisma/schema.prisma",
  "prisma-postgres/schema.prisma",
  "prisma-postgres/migrations/000004_daily_closing_snapshots/migration.sql",
  "src/modules/bills/bills.controller.js",
  "src/modules/bills/bills.service.js",
  "src/modules/sync/sync.service.js",
  "src/modules/reports/dailyClosingSnapshot.service.js",
  "src/modules/reports/reports.service.js",
  "src/modules/reports/reports.controller.js",
  "src/modules/reports/reports.routes.js",
  "src/workers/reports.worker.js",
]) {
  assert(exists(file), `${file} must exist for Phase 12`);
}

const sqliteSchema = read("prisma/schema.prisma");
const pgSchema = read("prisma-postgres/schema.prisma");
const migration = read("prisma-postgres/migrations/000004_daily_closing_snapshots/migration.sql");
const billController = read("src/modules/bills/bills.controller.js");
const billService = read("src/modules/bills/bills.service.js");
const syncService = read("src/modules/sync/sync.service.js");
const snapshotService = read("src/modules/reports/dailyClosingSnapshot.service.js");
const reportService = read("src/modules/reports/reports.service.js");
const reportController = read("src/modules/reports/reports.controller.js");
const reportRoutes = read("src/modules/reports/reports.routes.js");
const reportSchema = read("src/modules/reports/reports.schema.js");
const reportsWorker = read("src/workers/reports.worker.js");
const productionCheck = read("scripts/production-check.js");
const packageJson = JSON.parse(read("package.json"));

for (const schema of [sqliteSchema, pgSchema]) {
  assert(schema.includes("createdByUserId  String?"), "Bill must have nullable createdByUserId");
  assert(schema.includes("deviceId         String?"), "Bill should store optional deviceId when available");
  assert(schema.includes("@@index([shopId, createdByUserId, createdAt])"), "Bill must have cashier report index");
  assert(schema.includes("model DailyClosingSnapshot"), "DailyClosingSnapshot model must exist");
  assert(schema.includes("topProductsJson") && schema.includes("lowStockJson"), "Snapshot must persist JSON report summaries");
  assert(schema.includes("@@unique([shopId, date])"), "Snapshot must be idempotent per shop/date");
  assert(schema.includes("lockedAt") && schema.includes("lockedByUserId"), "Snapshot must support locking");
  assert(schema.includes("bankReceivedPaise"), "Snapshot must persist bank tender (bank is a first-class payment mode)");
}

assert(migration.includes('ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "createdByUserId"'), "Migration must add Bill.createdByUserId safely");
assert(migration.includes('CREATE TABLE "DailyClosingSnapshot"'), "Migration must create DailyClosingSnapshot safely");
assert(migration.includes('DailyClosingSnapshot_shopId_date_key'), "Migration must add unique shop/date constraint");

assert(billController.includes("req.user?.userId"), "Bill controller must pass authenticated user id");
assert(billController.includes('"x-device-id"'), "Bill controller should pass device id when available");
assert(billService.includes("createdByUserId = actor?.userId"), "confirmBill must derive cashier from actor context");
assert(billService.includes("createdByUserId,") && billService.includes("deviceId,"), "Bill create must persist attribution fields");
assert(!billService.includes("body.createdByUserId"), "confirmBill must not trust frontend-created user id");
assert(syncService.includes("applyCreateBill(shopId, event, user)"), "Sync CREATE_BILL must receive authenticated sync user");
assert(syncService.includes("user?.userId"), "Sync CREATE_BILL must attribute from server-authenticated user");
assert(!syncService.includes("payload.createdByUserId"), "Sync must not trust payload.createdByUserId");

for (const fn of [
  "generateDailyClosingSnapshot",
  "getDailyClosingSnapshot",
  "refreshDailyClosingSnapshot",
  "lockDailyClosingSnapshot",
  "unlockDailyClosingSnapshot",
]) {
  assert(snapshotService.includes(`export async function ${fn}`), `snapshot service missing ${fn}`);
}
assert(snapshotService.includes("upsert"), "Snapshot generation must upsert idempotently");
assert(snapshotService.includes("shopId_date"), "Snapshot service must use unique shop/date key");
assert(snapshotService.includes("SNAPSHOT_LOCKED"), "Locked snapshots must not be silently overwritten");
assert(snapshotService.includes("getDailyClosing"), "Snapshot generation must reuse live Phase 11 computation");
assert(snapshotService.includes("bankReceivedPaise: dailyClosing.bankReceivedPaise"), "Snapshot writer must persist bank tender");
assert(snapshotService.includes("bankReceivedPaise: snapshot.bankReceivedPaise"), "Snapshot reader must return bank tender");

assert(reportService.includes("createdByUserId") && reportService.includes("Unknown / Legacy"), "staff-sales must group by createdByUserId and include legacy bucket");
assert(!reportService.includes("Bill schema does not currently store createdByUserId"), "staff-sales should no longer be limitation-only");
assert(reportRoutes.includes('"/daily-closing/snapshot"'), "Snapshot create route must exist");
assert(reportRoutes.includes('"/daily-closing/:date/lock"'), "Snapshot lock route must exist");
assert(reportRoutes.includes('requireRole("owner", "admin")'), "Snapshot mutation routes must be owner/admin protected");
assert(reportSchema.includes("dailyClosingSnapshotSchema"), "Snapshot body schema must exist");
assert(reportSchema.includes('"live"') && reportSchema.includes('"snapshot"'), "Daily closing source query must support live/snapshot");

for (const action of [
  "DAILY_CLOSING_SNAPSHOT_CREATED",
  "DAILY_CLOSING_SNAPSHOT_REFRESHED",
  "DAILY_CLOSING_SNAPSHOT_LOCKED",
]) {
  assert(reportController.includes(action), `Controller must audit ${action}`);
}

assert(reportsWorker.includes("dailyClosingSnapshot.service.js"), "Worker must use persisted snapshot service");
assert(reportsWorker.includes('source: "worker"'), "Worker snapshots must be marked source=worker");
assert(!reportsWorker.includes("confirmBill"), "Report worker must not mutate billing");

for (const snippet of [
  "DailyClosingSnapshot model must exist",
  "confirmBill must set createdByUserId",
  "dailyClosingSnapshot.service.js",
  "phase12-daily-closing-snapshots.examples.js",
]) {
  assert(productionCheck.includes(snippet), `production-check missing Phase 12 snippet: ${snippet}`);
}
assert(packageJson.scripts["test:billing"].includes("phase12-daily-closing-snapshots.examples.js"), "Phase 12 test must be wired into npm test");

// Regression guard (CODE_REVIEW_LOGIC_FLAWS.md #2): the snapshot staleness check must use the
// shop-timezone day window — the same window getDailyClosing uses to generate the snapshot — not
// the server's local clock. A server-local .setHours() window is shifted by the UTC offset (5.5h
// for IST) and queries the wrong rows, so it both misses real changes and falsely flags others.
assert(snapshotService.includes("dateRangeForDateOnly(date, env.DAILY_CLOSING_TIMEZONE)"), "snapshot staleness must use the shop-timezone day window");
assert(!snapshotService.includes(".setHours("), "snapshot staleness must not build day windows with server-local .setHours()");

console.log("Phase 12 daily closing snapshots examples passed");
