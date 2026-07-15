/**
 * phase4g-sync-docs.examples.js
 *
 * Static assertions for Phase 4G: docs/SYNC.md content.
 *
 *  1.  docs/SYNC.md exists.
 *  2.  Documents recommended push batch size of 100.
 *  3.  Documents hard backend max of 500 events.
 *  4.  Documents SYNC_BATCH_TOO_LARGE error code.
 *  5.  Documents pull default limit of 500.
 *  6.  Documents pull max limit of 1000.
 *  7.  Documents hasMore and nextCursor in pull response.
 *  8.  Documents that duplicate/already-synced must be treated as success.
 *  9.  Documents that ownerPin must not be stored or logged.
 * 10.  Documents that frontend must not wipe IndexedDB after reconnect.
 * 11.  Documents live serverVersion sequence sync and legacy compatibility.
 * 12.  Documents owner-gated event types (all 5).
 * 13.  Documents sequential event processing.
 * 14.  Documents cursor format (ISO_TIMESTAMP|ID).
 * 15.  Documents (updatedAt, id) ordering for pull.
 * 16.  Documents database-guarded concurrent duplicate push claiming.
 * 17.  Documents safe, confirmed OfflineSyncEvent retention cleanup.
 * 18.  Test is in the test:billing chain.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const docPath = path.join(root, "docs", "SYNC.md");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

// ── 1. File exists ─────────────────────────────────────────────────────────────

assert.ok(
  fs.existsSync(docPath),
  "docs/SYNC.md must exist"
);

const doc = fs.readFileSync(docPath, "utf8");

// ── 2. Recommended batch size = 100 ───────────────────────────────────────────

assert.ok(
  doc.includes("100"),
  "SYNC.md must document the recommended push batch size of 100"
);

assert.match(
  doc,
  /[Rr]ecommended.{0,50}100|100.{0,50}[Rr]ecommend/,
  "SYNC.md must explicitly recommend 100 as the frontend batch size"
);

// ── 3. Hard max = 500 ─────────────────────────────────────────────────────────

assert.match(
  doc,
  /[Hh]ard.{0,50}500|500.{0,50}[Mm]ax|[Mm]aximum.{0,50}500/,
  "SYNC.md must document the hard backend maximum of 500 events"
);

// ── 4. SYNC_BATCH_TOO_LARGE ───────────────────────────────────────────────────

assert.ok(
  doc.includes("SYNC_BATCH_TOO_LARGE"),
  "SYNC.md must document the SYNC_BATCH_TOO_LARGE error code"
);

// ── 5. Pull default limit = 500 ───────────────────────────────────────────────

assert.match(
  doc,
  /[Dd]efault.{0,100}500|500.{0,100}[Dd]efault/,
  "SYNC.md must document the pull default limit of 500"
);

// ── 6. Pull max limit = 1000 ──────────────────────────────────────────────────

assert.ok(
  doc.includes("1000"),
  "SYNC.md must document the pull max limit of 1000"
);

// ── 7. hasMore and nextCursor ─────────────────────────────────────────────────

assert.ok(
  doc.includes("hasMore"),
  "SYNC.md must document sync.hasMore in pull response"
);

assert.ok(
  doc.includes("nextCursor"),
  "SYNC.md must document sync.nextCursor in pull response"
);

// ── 8. Duplicate replay treated as success ────────────────────────────────────

assert.match(
  doc,
  /[Dd]uplicate.{0,150}[Ss]uccess|[Ss]uccess.{0,150}[Dd]uplicate/,
  "SYNC.md must document that duplicate/already-synced should be treated as success"
);

// ── 9. ownerPin not stored / not logged ───────────────────────────────────────

assert.match(
  doc,
  /ownerPin.{0,100}never.{0,100}(stored|logged)|never.{0,100}(stored|logged).{0,100}ownerPin/s,
  "SYNC.md must document that ownerPin is never stored or logged"
);

// ── 10. Frontend must not wipe IndexedDB ──────────────────────────────────────

assert.match(
  doc,
  /[Nn]ever.{0,100}wipe|[Nn]ot.{0,100}wipe|[Mm]erge.{0,100}never.{0,100}replace|[Dd]o\s+NOT\s+wipe/i,
  "SYNC.md must document that frontend must not wipe IndexedDB after reconnect"
);

// ── 11. serverVersion as future work ──────────────────────────────────────────

assert.match(
  doc,
  /[Mm]onotonic.{0,200}[Ss]erver[Vv]ersion.{0,300}(live|server_sequence_v2)|server_sequence_v2.{0,300}nextServerSeq/s,
  "SYNC.md must document the live monotonic serverVersion protocol"
);

assert.match(
  doc,
  /legacy.{0,200}(updatedAt.{0,50}id|timestamp)|clients that omit `afterSeq`/i,
  "SYNC.md must document compatibility behavior for legacy clients"
);

// ── 12. Owner-gated event types (all 5) ──────────────────────────────────────

for (const eventType of ["CANCEL_BILL", "RESTORE_BILL", "DELETE_PRODUCT", "RESTORE_PRODUCT", "ADJUST_STOCK"]) {
  assert.ok(
    doc.includes(eventType),
    `SYNC.md must document owner-gated event type: ${eventType}`
  );
}

// ── 13. Sequential processing ─────────────────────────────────────────────────

assert.match(
  doc,
  /[Ss]equential|one.{0,30}at.{0,30}time/i,
  "SYNC.md must document that events are processed sequentially"
);

// ── 14. Cursor format ─────────────────────────────────────────────────────────

assert.match(
  doc,
  /ISO_TIMESTAMP\|ID|ISO_TIMESTAMP\|CUID|\|CUID|timestamp\|.*id/i,
  "SYNC.md must document the cursor format (ISO_TIMESTAMP|ID)"
);

// ── 15. (updatedAt, id) ordering ──────────────────────────────────────────────

assert.match(
  doc,
  /updatedAt.{0,50}id|id.{0,50}updatedAt/,
  "SYNC.md must document the (updatedAt, id) ordering for pull"
);

assert.match(
  doc,
  /[Tt]ie.{0,30}breaker|[Tt]ie-breaker/,
  "SYNC.md must document the id tie-breaker to avoid skipped records"
);

// ── 16. Concurrent duplicate push race condition documented ───────────────────

assert.match(
  doc,
  /[Cc]oncurrent.{0,150}duplicate.{0,300}(unique|P2002|database-guarded)/s,
  "SYNC.md must document database-guarded concurrent duplicate push claiming"
);

// ── 17. OfflineSyncEvent cleanup limitation documented ────────────────────────

assert.match(
  doc,
  /retention cleanup.{0,500}(dry run|dryRun).{0,300}confirm.{0,500}(Failed|open conflicts)/is,
  "SYNC.md must document confirmed retention and the statuses it preserves"
);

// ── 18. Test is in the chain ──────────────────────────────────────────────────

assert.ok(
  packageJson.scripts["test:billing"].includes("phase4g-sync-docs.examples.js"),
  "test:billing must include phase4g-sync-docs.examples.js"
);

console.log("Phase 4G sync docs examples passed");
