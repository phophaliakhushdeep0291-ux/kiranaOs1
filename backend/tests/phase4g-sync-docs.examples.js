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
 * 11.  Documents serverVersion sync as future work.
 * 12.  Documents owner-gated event types (all 5).
 * 13.  Documents sequential event processing.
 * 14.  Documents cursor format (ISO_TIMESTAMP|ID).
 * 15.  Documents (updatedAt, id) ordering for pull.
 * 16.  Documents concurrent duplicate push race condition as known limitation.
 * 17.  Documents OfflineSyncEvent cleanup as known limitation.
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
  /[Ss]erver[Vv]ersion.{0,200}(future|planned|roadmap)|[Ff]uture.{0,200}[Ss]erver[Vv]ersion/s,
  "SYNC.md must document that serverVersion sync is future work"
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
  /[Cc]oncurrent.{0,100}(race|duplicate)|race.{0,100}condition/i,
  "SYNC.md must document the concurrent duplicate push race condition as a known limitation"
);

// ── 17. OfflineSyncEvent cleanup limitation documented ────────────────────────

assert.match(
  doc,
  /OfflineSyncEvent.{0,200}(cleanup|retention|grow)|cleanup.{0,200}OfflineSyncEvent/s,
  "SYNC.md must document the OfflineSyncEvent cleanup/retention limitation"
);

// ── 18. Test is in the chain ──────────────────────────────────────────────────

assert.ok(
  packageJson.scripts["test:billing"].includes("phase4g-sync-docs.examples.js"),
  "test:billing must include phase4g-sync-docs.examples.js"
);

console.log("Phase 4G sync docs examples passed");
