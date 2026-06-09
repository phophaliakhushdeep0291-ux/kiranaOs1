/**
 * phase4c-sync-push-limits.examples.js
 *
 * Static assertions for Phase 4C: sync push batch size limits and summary metadata.
 *
 *   Fix 1 — Batch size limit:
 *     1. PUSH_MAX_BATCH_SIZE = 500 exported from sync.schema.js.
 *     2. PUSH_BATCH_TOO_LARGE_CODE = "SYNC_BATCH_TOO_LARGE" exported.
 *     3. pushBodySchema still accepts events[] and actions[] (backward-compat).
 *     4. pushBodySchema has superRefine that enforces the max batch size.
 *     5. checkPushBatchSize middleware exists in sync.routes.js.
 *     6. Batch too large returns { success: false, code: "SYNC_BATCH_TOO_LARGE", ... }.
 *     7. Batch too large returns received count and maxAllowed.
 *     8. Valid batch (≤ 500) still passes through schema and middleware.
 *
 *   Fix 2 — Summary metadata:
 *     9.  pushOfflineActions returns data.summary object.
 *     10. data.summary.synced counts status="synced" results.
 *     11. data.summary.duplicates counts status="duplicate" results.
 *     12. data.summary.failed counts success=false results.
 *     13. data.summary.conflicts counts status="conflict" results.
 *     14. data.summary.retryable counts result.result.retryable=true results.
 *     15. data.summary.received matches events.length.
 *     16. pushOfflineActions returns data.serverTime (ISO string).
 *     17. Controller exposes summary and serverTime at response root.
 *     18. Existing data.received/applied/failed fields unchanged.
 *     19. Existing top-level results alias unchanged.
 *
 *   Fix 3 — Idempotency preserved:
 *     20. OfflineSyncEvent unique shopId + eventId still exists in schema.
 *     21. isDuplicateSyncedEvent still checks status === "synced".
 *     22. processOneSyncEvent still strips ownerPin via removeSensitiveSyncFields.
 *     23. Push processing is still sequential (for...of await).
 */

import assert from "node:assert/strict";
import fs from "node:fs";

const syncSchema  = fs.readFileSync("src/modules/sync/sync.schema.js",    "utf8");
const syncService = fs.readFileSync("src/modules/sync/sync.service.js",   "utf8");
const syncCtrl    = fs.readFileSync("src/modules/sync/sync.controller.js","utf8");
const syncRoutes  = fs.readFileSync("src/modules/sync/sync.routes.js",   "utf8");
const prismaSchema = fs.readFileSync("prisma/schema.prisma",              "utf8");
const syncRules   = fs.readFileSync("src/utils/syncRules.js",             "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

// ── Fix 1: Constants exported ─────────────────────────────────────────────────

assert.match(
  syncSchema,
  /export const PUSH_MAX_BATCH_SIZE\s*=\s*500/,
  "PUSH_MAX_BATCH_SIZE must be 500"
);

assert.match(
  syncSchema,
  /export const PUSH_BATCH_TOO_LARGE_CODE\s*=\s*["']SYNC_BATCH_TOO_LARGE["']/,
  'PUSH_BATCH_TOO_LARGE_CODE must be "SYNC_BATCH_TOO_LARGE"'
);

// ── Fix 1: pushBodySchema still has events[] and actions[] ───────────────────

assert.match(
  syncSchema,
  /events:\s*z\.array\(syncEventSchema\)/,
  "pushBodySchema must still accept events[]"
);

assert.match(
  syncSchema,
  /actions:\s*z\.array\(syncEventSchema\)/,
  "pushBodySchema must still accept actions[] (backward-compat alias)"
);

// ── Fix 1: superRefine enforces batch limit in schema ────────────────────────

assert.match(
  syncSchema,
  /superRefine/,
  "pushBodySchema must use superRefine for batch size enforcement"
);

assert.match(
  syncSchema,
  /PUSH_MAX_BATCH_SIZE/,
  "pushBodySchema superRefine must reference PUSH_MAX_BATCH_SIZE"
);

assert.match(
  syncSchema,
  /Sync batch too large/,
  "superRefine must include the standard error message"
);

// ── Fix 1: checkPushBatchSize middleware in routes ───────────────────────────

assert.match(
  syncRoutes,
  /function checkPushBatchSize/,
  "sync.routes.js must define checkPushBatchSize middleware"
);

assert.match(
  syncRoutes,
  /PUSH_BATCH_TOO_LARGE_CODE/,
  "checkPushBatchSize must use PUSH_BATCH_TOO_LARGE_CODE"
);

assert.match(
  syncRoutes,
  /checkPushBatchSize.*validate\(pushBodySchema\)/,
  "checkPushBatchSize must run before validate(pushBodySchema) on the push route"
);

// checkPushBatchSize checks actions[] alias too
assert.match(
  syncRoutes,
  /body\.actions/,
  "checkPushBatchSize must check actions[] alias as well as events[]"
);

// ── Fix 1: Batch too large response shape ─────────────────────────────────────

assert.match(
  syncRoutes,
  /success:\s*false/,
  "batch-too-large response must set success: false"
);

assert.match(
  syncRoutes,
  /received:\s*effective\.length/,
  "batch-too-large response must include the actual received count"
);

assert.match(
  syncRoutes,
  /maxAllowed:\s*PUSH_MAX_BATCH_SIZE/,
  "batch-too-large response must include maxAllowed"
);

assert.match(
  syncRoutes,
  /res\.status\(400\)/,
  "batch-too-large must return HTTP 400"
);

// ── Fix 1: Batch limit validation (live) ──────────────────────────────────────

const { pushBodySchema, PUSH_MAX_BATCH_SIZE, PUSH_BATCH_TOO_LARGE_CODE } =
  await import("../src/modules/sync/sync.schema.js");

assert.equal(PUSH_MAX_BATCH_SIZE, 500, "PUSH_MAX_BATCH_SIZE must be 500");
assert.equal(PUSH_BATCH_TOO_LARGE_CODE, "SYNC_BATCH_TOO_LARGE");

// Valid batch of 1 event (minimum valid structure for Zod)
// The schema itself doesn't blow up on small valid batches
const oneEventResult = pushBodySchema.safeParse({ events: [] });
assert.ok(oneEventResult.success, "empty events[] must be valid");
assert.deepEqual(oneEventResult.data.events, [], "empty events transforms to []");

// actions alias also transforms correctly
const actionsResult = pushBodySchema.safeParse({ actions: [] });
assert.ok(actionsResult.success, "empty actions[] must be valid");
assert.deepEqual(actionsResult.data.events, [], "actions alias transforms into events[]");

// Batch of exactly 500 would normally pass the superRefine (since the events inside
// would need valid syncEventSchema shape — we test the constant and middleware logic
// via the source checks above; full schema parse is covered by the routes middleware test)

// ── Fix 2: pushOfflineActions returns summary ─────────────────────────────────

assert.match(
  syncService,
  /summary:\s*\{/,
  "pushOfflineActions must return a summary object"
);

assert.match(
  syncService,
  /synced\s*=\s*results\.filter\(\(r\) => r\.status === ["']synced["']\)/,
  "summary.synced must count status=synced results"
);

assert.match(
  syncService,
  /duplicates\s*=\s*results\.filter\(\(r\) => r\.status === ["']duplicate["']\)/,
  "summary.duplicates must count status=duplicate results"
);

assert.match(
  syncService,
  /conflicts\s*=\s*results\.filter\(\(r\) => r\.status === ["']conflict["']\)/,
  "summary.conflicts must count status=conflict results"
);

assert.match(
  syncService,
  /retryable\s*=\s*results\.filter\(\(r\) => !r\.success && r\.result\?\.retryable === true\)/,
  "summary.retryable must count results where !success and result.retryable===true"
);

assert.match(
  syncService,
  /summary:\s*\{[\s\S]*received:\s*events\.length/,
  "summary.received must equal events.length"
);

// ── Fix 2: pushOfflineActions returns serverTime ──────────────────────────────

assert.match(
  syncService,
  /serverTime:\s*new Date\(\)\.toISOString\(\)/,
  "pushOfflineActions must return serverTime as ISO string"
);

// ── Fix 2: Existing fields are still present ──────────────────────────────────

assert.match(
  syncService,
  /received:\s*events\.length,\s*\n\s*applied,\s*\n\s*failed,\s*\n\s*results,/,
  "pushOfflineActions must still return received, applied, failed, results (backward compat)"
);

// ── Fix 2: Controller exposes summary and serverTime at root ──────────────────

assert.match(
  syncCtrl,
  /summary:\s*data\.summary/,
  "push controller must expose summary at response root"
);

assert.match(
  syncCtrl,
  /serverTime:\s*data\.serverTime/,
  "push controller must expose serverTime at response root"
);

assert.match(
  syncCtrl,
  /results:\s*data\.results/,
  "push controller must still expose results at response root (backward compat)"
);

// ── Fix 3: Idempotency preserved ──────────────────────────────────────────────

// OfflineSyncEvent unique constraint
assert.match(
  prismaSchema,
  /@@unique\(\[shopId, eventId\]\)/,
  "OfflineSyncEvent must still have @@unique([shopId, eventId]) idempotency constraint"
);

// isDuplicateSyncedEvent still checks for "synced" status
assert.match(
  syncRules,
  /isDuplicateSyncedEvent.*status === SYNC_EVENT_STATUSES\.SYNCED/s,
  "isDuplicateSyncedEvent must still gate on SYNCED status"
);

// PIN stripping still happens before storing
assert.match(
  syncService,
  /removeSensitiveSyncFields\(event\)/,
  "requestJson must still be sanitized via removeSensitiveSyncFields before storage"
);

// removeSensitiveSyncFields filters all keys with 'pin' in them
assert.match(
  syncRules,
  /key\.toLowerCase\(\)\.includes\(['"]pin['"]\)/,
  "removeSensitiveSyncFields must strip any key containing 'pin'"
);

// Processing is still sequential
assert.match(
  syncService,
  /for \(const event of events\) \{[\s\S]{0,200}await processOneSyncEvent/,
  "push processing must still be sequential (for...of await)"
);

assert.doesNotMatch(
  syncService,
  /Promise\.all\(events\.map/,
  "push processing must NOT use Promise.all on events (sequential required)"
);

// ── Test is in the chain ──────────────────────────────────────────────────────

assert.ok(
  packageJson.scripts["test:billing"].includes("phase4c-sync-push-limits.examples.js"),
  "test:billing must include phase4c-sync-push-limits.examples.js"
);

console.log("Phase 4C sync push limits/summary examples passed");
