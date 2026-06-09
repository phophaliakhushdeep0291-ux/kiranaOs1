/**
 * phase4e-sync-logging.examples.js
 *
 * Static assertions for Phase 4E: structured logging for sync push and pull.
 *
 * Push log assertions:
 *   1.  sync.controller.js logs type "sync_push".
 *   2.  Push log includes batchSize.
 *   3.  Push log includes durationMs.
 *   4.  Push log includes synced, duplicates, failed, conflicts, retryable counts.
 *   5.  Push log does NOT include requestJson or payload fields.
 *   6.  Push log does NOT include ownerPin.
 *   7.  Push error log uses type "sync_push_error".
 *
 * Pull log assertions:
 *   8.  sync.controller.js logs type "sync_pull".
 *   9.  Pull log includes limit.
 *   10. Pull log includes returnedCount.
 *   11. Pull log includes hasMore.
 *   12. Pull log includes cursorPresent (boolean, not cursor value).
 *   13. Pull log does NOT include products, customers, or bills arrays.
 *   14. Pull error log uses type "sync_pull_error".
 *
 * Safety assertions:
 *   15. writeSyncLog follows existing JSON.stringify pattern.
 *   16. shouldSyncLog gates on LOG_LEVEL.
 *   17. Error logs include errorName, errorCode, errorMessage — not stack.
 *   18. API response shape is identical to pre-Phase-4E (no new response fields).
 *
 * Chain assertion:
 *   19. Test is in the test:billing chain.
 */

import assert from "node:assert/strict";
import fs from "node:fs";

const ctrl = fs.readFileSync("src/modules/sync/sync.controller.js", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

// ── 1. Push log type ──────────────────────────────────────────────────────────

assert.match(ctrl, /type:\s*["']sync_push["']/, "controller must log type 'sync_push'");

// ── 2. Push log includes batchSize ────────────────────────────────────────────

assert.match(ctrl, /batchSize/, "push log must include batchSize");

// ── 3. Push log includes durationMs ──────────────────────────────────────────

assert.match(ctrl, /durationMs:\s*Date\.now\(\) - startedAt/, "push log must include durationMs");

// ── 4. Push log includes summary counts ──────────────────────────────────────

assert.match(ctrl, /synced:\s*data\.summary/, "push log must include synced count from summary");
assert.match(ctrl, /duplicates:\s*data\.summary/, "push log must include duplicates count");
assert.match(ctrl, /failed:\s*data\.summary/, "push log must include failed count");
assert.match(ctrl, /conflicts:\s*data\.summary/, "push log must include conflicts count");
assert.match(ctrl, /retryable:\s*data\.summary/, "push log must include retryable count");

// ── 5. Push log does NOT include raw payload or requestJson ───────────────────

assert.doesNotMatch(
  ctrl,
  /sync_push[\s\S]{0,500}requestJson/,
  "push log must NOT include requestJson (contains raw event data)"
);

assert.doesNotMatch(
  ctrl,
  /sync_push[\s\S]{0,500}payload:/,
  "push log must NOT include payload field"
);

// ── 6. Push log does NOT include ownerPin ────────────────────────────────────

assert.doesNotMatch(
  ctrl,
  /sync_push[\s\S]{0,500}ownerPin/,
  "push log must NOT include ownerPin"
);

// ── 7. Push error log type ────────────────────────────────────────────────────

assert.match(
  ctrl,
  /type:\s*["']sync_push_error["']/,
  "controller must log type 'sync_push_error' on push failure"
);

// ── 8. Pull log type ──────────────────────────────────────────────────────────

assert.match(ctrl, /type:\s*["']sync_pull["']/, "controller must log type 'sync_pull'");

// ── 9. Pull log includes limit ────────────────────────────────────────────────

assert.match(
  ctrl,
  /sync_pull[\s\S]{0,500}limit:/,
  "pull log must include limit"
);

// ── 10. Pull log includes returnedCount ──────────────────────────────────────

assert.match(
  ctrl,
  /sync_pull[\s\S]{0,500}returnedCount/,
  "pull log must include returnedCount"
);

// ── 11. Pull log includes hasMore ─────────────────────────────────────────────

assert.match(
  ctrl,
  /sync_pull[\s\S]{0,500}hasMore/,
  "pull log must include hasMore"
);

// ── 12. Pull log includes cursorPresent (not the cursor value itself) ─────────

assert.match(
  ctrl,
  /cursorPresent:\s*Boolean\(cursor\)/,
  "pull log must use cursorPresent: Boolean(cursor), never the raw cursor string"
);

// ── 13. Pull log does NOT include data arrays ─────────────────────────────────

assert.doesNotMatch(
  ctrl,
  /sync_pull[\s\S]{0,500}products:/,
  "pull log must NOT include products array"
);

assert.doesNotMatch(
  ctrl,
  /sync_pull[\s\S]{0,500}customers:/,
  "pull log must NOT include customers array"
);

assert.doesNotMatch(
  ctrl,
  /sync_pull[\s\S]{0,500}bills:/,
  "pull log must NOT include bills array"
);

// ── 14. Pull error log type ───────────────────────────────────────────────────

assert.match(
  ctrl,
  /type:\s*["']sync_pull_error["']/,
  "controller must log type 'sync_pull_error' on pull failure"
);

// ── 15. writeSyncLog follows existing JSON.stringify pattern ──────────────────

assert.match(
  ctrl,
  /JSON\.stringify\(\{/,
  "writeSyncLog must use JSON.stringify (same pattern as global request logger)"
);

assert.match(
  ctrl,
  /console\.log\(entry\)|console\.log\(JSON\.stringify/,
  "writeSyncLog must use console.log for info-level entries"
);

assert.match(
  ctrl,
  /console\.error\(entry\)|console\.error\(JSON\.stringify/,
  "writeSyncLog must use console.error for error-level entries"
);

// ── 16. shouldSyncLog gates on LOG_LEVEL ─────────────────────────────────────

assert.match(
  ctrl,
  /function shouldSyncLog/,
  "controller must define shouldSyncLog gating function"
);

assert.match(
  ctrl,
  /LOG_LEVEL.*silent|silent.*LOG_LEVEL/,
  "shouldSyncLog must check for LOG_LEVEL=silent"
);

assert.match(
  ctrl,
  /LOG_LEVEL.*error|error.*LOG_LEVEL/,
  "shouldSyncLog must suppress info logs when LOG_LEVEL=error"
);

// ── 17. Error log fields — no stack in payload ────────────────────────────────

assert.match(ctrl, /errorName/, "error logs must include errorName");
assert.match(ctrl, /errorCode/, "error logs must include errorCode");
assert.match(ctrl, /errorMessage/, "error logs must include errorMessage");

// Stack trace is NOT included in the log payload (it's handled by the global
// error handler for unhandled errors, guarded by NODE_ENV=development)
assert.doesNotMatch(
  ctrl,
  /stack:\s*err\?\.stack/,
  "sync error logs must NOT include stack trace in payload"
);

// ── 18. API response shape is unchanged ──────────────────────────────────────

// Pull response still returns { success: true, data }
assert.match(
  ctrl,
  /res\.json\(\{\s*success:\s*true,\s*data\s*\}\)/,
  "pull response shape must be unchanged: { success: true, data }"
);

// Push response still returns success, data, results, summary, serverTime
assert.match(ctrl, /results:\s*data\.results/, "push response must still include results alias");
assert.match(ctrl, /summary:\s*data\.summary/, "push response must still include summary");
assert.match(ctrl, /serverTime:\s*data\.serverTime/, "push response must still include serverTime");

// ── 19. Test is in the chain ──────────────────────────────────────────────────

assert.ok(
  packageJson.scripts["test:billing"].includes("phase4e-sync-logging.examples.js"),
  "test:billing must include phase4e-sync-logging.examples.js"
);

console.log("Phase 4E sync logging examples passed");
