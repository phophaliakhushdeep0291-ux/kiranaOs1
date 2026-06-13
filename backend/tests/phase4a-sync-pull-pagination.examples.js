/**
 * phase4a-sync-pull-pagination.examples.js
 *
 * Static assertions for Phase 4A: Sync pull pagination / chunking.
 *
 *   1. pullQuerySchema accepts since, cursor (optional), limit (optional).
 *   2. Default limit is PULL_DEFAULT_LIMIT (500).
 *   3. Max limit is PULL_MAX_LIMIT (1000).
 *   4. limit > 1000 is rejected by schema.
 *   5. cursor is optional; missing cursor means "start from since".
 *   6. encodeCursor / decodeCursor round-trips correctly.
 *   7. decodeCursor returns null for invalid inputs.
 *   8. pullSince signature accepts { cursor, limit } options.
 *   9. pullSince returns sync.hasMore, sync.nextCursor, sync.serverTime, sync.limit, sync.returnedCount.
 *  10. pullSince still returns backward-compat fields: syncedAt, products[], customers[], bills[], stockLedger[], udharLedger[].
 *  11. pull controller passes cursor and limit to pullSince.
 *  12. sync.schema.js exports PULL_DEFAULT_LIMIT = 500, PULL_MAX_LIMIT = 1000.
 *  13. All entity queries use orderBy updatedAt ASC, id ASC.
 *  14. StockLedger now filters by updatedAt (not createdAt) for consistency.
 *  15. Test is in the test chain.
 */

import assert from "node:assert/strict";
import fs from "node:fs";

const syncSchema  = fs.readFileSync("src/modules/sync/sync.schema.js",     "utf8");
const syncService = fs.readFileSync("src/modules/sync/sync.service.js",     "utf8");
const syncCtrl    = fs.readFileSync("src/modules/sync/sync.controller.js",  "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

// ── 1. Schema: cursor and limit in pullQuerySchema ────────────────────────────

assert.match(
  syncSchema,
  /cursor.*optional/,
  "pullQuerySchema must include optional cursor field"
);

assert.match(
  syncSchema,
  /limit.*coerce.*number/i,
  "pullQuerySchema must coerce limit to number"
);

assert.match(
  syncSchema,
  /since.*datetime/,
  "pullQuerySchema must still require since as ISO datetime"
);

// ── 2. Default limit = 500 ────────────────────────────────────────────────────

assert.match(
  syncSchema,
  /PULL_DEFAULT_LIMIT\s*=\s*500/,
  "PULL_DEFAULT_LIMIT must be 500"
);

assert.match(
  syncSchema,
  /PULL_MAX_LIMIT\s*=\s*1000/,
  "PULL_MAX_LIMIT must be 1000"
);

// ── 3. Max limit enforced in schema ───────────────────────────────────────────

assert.match(
  syncSchema,
  /\.max\(PULL_MAX_LIMIT\)|\.max\(1000\)/,
  "pullQuerySchema must enforce .max(PULL_MAX_LIMIT) on limit"
);

// ── 4. Default applied in schema ──────────────────────────────────────────────

assert.match(
  syncSchema,
  /\.default\(PULL_DEFAULT_LIMIT\)|\.default\(500\)/,
  "pullQuerySchema limit must have .default(PULL_DEFAULT_LIMIT)"
);

// ── 5. encodeCursor / decodeCursor exported from schema ───────────────────────

assert.match(
  syncSchema,
  /export function encodeCursor/,
  "sync.schema.js must export encodeCursor"
);

assert.match(
  syncSchema,
  /export function decodeCursor/,
  "sync.schema.js must export decodeCursor"
);

// ── 6. encodeCursor / decodeCursor round-trip ─────────────────────────────────

// Import and test the helpers directly
const { encodeCursor, decodeCursor, PULL_DEFAULT_LIMIT, PULL_MAX_LIMIT } = await import("../src/modules/sync/sync.schema.js");

assert.equal(PULL_DEFAULT_LIMIT, 500,  "PULL_DEFAULT_LIMIT must be 500");
assert.equal(PULL_MAX_LIMIT,     1000, "PULL_MAX_LIMIT must be 1000");

const testDate = new Date("2026-06-05T17:30:00.000Z");
const testId   = "clxyz1234567890";
const encoded  = encodeCursor(testDate, testId);

assert.equal(typeof encoded, "string", "encodeCursor must return a string");
assert.ok(encoded.includes("|"), "cursor must contain pipe separator");
assert.ok(encoded.startsWith("2026-06-05T17:30:00.000Z"), "cursor must start with ISO timestamp");
assert.ok(encoded.endsWith(testId), "cursor must end with id");

const decoded = decodeCursor(encoded);
assert.ok(decoded !== null, "decodeCursor must parse a valid cursor");
assert.ok(decoded.date instanceof Date, "decoded.date must be a Date");
assert.equal(decoded.date.toISOString(), "2026-06-05T17:30:00.000Z", "decoded date must match");
assert.equal(decoded.id, testId, "decoded id must match");

// String updatedAt also works (Prisma returns Dates, but defensive handling)
const encodedFromStr = encodeCursor("2026-06-05T12:00:00.000Z", "clid999");
const decodedFromStr = decodeCursor(encodedFromStr);
assert.ok(decodedFromStr !== null, "decodeCursor must handle string-encoded cursor");
assert.equal(decodedFromStr.id, "clid999");

// ── 7. decodeCursor returns null for invalid inputs ────────────────────────────

assert.equal(decodeCursor(null),      null, "decodeCursor(null) must return null");
assert.equal(decodeCursor(""),        null, "decodeCursor('') must return null");
assert.equal(decodeCursor("nopipe"), null, "decodeCursor without pipe must return null");
assert.equal(decodeCursor("invalid-date|abc"), null, "decodeCursor with bad date must return null");
assert.equal(decodeCursor("|"),       null, "decodeCursor('|') must return null (empty parts)");

// ── 8. pullSince accepts options object with cursor and limit ─────────────────

assert.match(
  syncService,
  /pullSince\(shopId, since, \{\s*cursor, limit/,
  "pullSince must accept { cursor, limit } options as third argument"
);

assert.match(
  syncService,
  /decodeCursor\(cursor\)/,
  "pullSince must call decodeCursor to parse cursor"
);

// ── 9. pullSince returns sync metadata object ─────────────────────────────────

assert.match(
  syncService,
  /sync:\s*\{/,
  "pullSince must return a `sync` metadata object"
);

assert.match(
  syncService,
  /hasMore/,
  "pullSince sync metadata must include hasMore"
);

assert.match(
  syncService,
  /nextCursor/,
  "pullSince sync metadata must include nextCursor"
);

assert.match(
  syncService,
  /serverTime/,
  "pullSince sync metadata must include serverTime"
);

assert.match(
  syncService,
  /returnedCount/,
  "pullSince sync metadata must include returnedCount"
);

assert.match(
  syncService,
  /sync:\s*\{[\s\S]*limit,/,
  "pullSince sync metadata must include limit"
);

// ── 10. Backward-compat fields preserved ─────────────────────────────────────

assert.match(
  syncService,
  /syncedAt:\s*new Date\(\)/,
  "pullSince must still return syncedAt"
);

// Note: products/bills are role-redacted in the return (cashiers get cost/profit
// stripped), so they read `products: privileged ? products : products.map(...)`.
// Match the property regardless of inline redaction expression.
assert.match(
  syncService,
  /products:[^\n]*\n\s*customers,/,
  "pullSince must still return products and customers arrays"
);

assert.match(
  syncService,
  /bills:[^\n]*\n\s*stockLedger,/,
  "pullSince must still return bills and stockLedger arrays"
);

assert.match(
  syncService,
  /udharLedger,/,
  "pullSince must still return udharLedger array"
);

// ── 11. Controller passes cursor and limit to service ─────────────────────────

assert.match(
  syncCtrl,
  /const \{ since, cursor, limit \} = req\.query/,
  "pull controller must destructure since, cursor, limit from req.query"
);

assert.match(
  syncCtrl,
  /pullSince\(req\.shopId, since, \{ cursor, limit \}\)/,
  "pull controller must pass { cursor, limit } to pullSince"
);

// ── 12. Ordering uses updatedAt ASC + id ASC ──────────────────────────────────

assert.match(
  syncService,
  /orderBy\s*=\s*\[\s*\{\s*updatedAt:\s*"asc"\s*\}/,
  "pullSince must order by updatedAt asc"
);

assert.match(
  syncService,
  /\{\s*id:\s*"asc"\s*\}/,
  "pullSince must include id asc as tie-breaker"
);

// ── 13. StockLedger now uses updatedAt (not createdAt) for filtering ──────────

// The stockLedger query must use buildWhere() which applies updatedAt
// and must NOT use a separate { createdAt: ... } filter
assert.doesNotMatch(
  syncService,
  /stockLedger\.findMany\([\s\S]{0,200}createdAt:\s*\{/,
  "stockLedger query must not filter by createdAt (use updatedAt via buildWhere)"
);

// All entities use the same buildWhere() helper
assert.match(
  syncService,
  /function buildWhere/,
  "pullSince must define a buildWhere helper"
);

assert.match(
  syncService,
  /updatedAt:\s*\{\s*gte:\s*sinceDate\s*\}/,
  "buildWhere must filter by updatedAt >= sinceDate"
);

// ── 14. Per-entity limit applied via take: limit ──────────────────────────────

// Each findMany call must have take: limit
const takeCount = (syncService.match(/take:\s*limit/g) || []).length;
assert.ok(
  takeCount >= 5,
  `All 5 entity queries must have take: limit — found ${takeCount}`
);

// ── 15. hasMore logic checks === limit (not >) ────────────────────────────────

assert.match(
  syncService,
  /\.length === limit/,
  "hasMore must check length === limit (exact match, not greater-than)"
);

// ── 16. findLastRecord helper exists ─────────────────────────────────────────

assert.match(
  syncService,
  /function findLastRecord/,
  "sync.service.js must define findLastRecord helper"
);

// ── 17. Test is in the test chain ────────────────────────────────────────────

assert.ok(
  packageJson.scripts["test:billing"].includes("phase4a-sync-pull-pagination.examples.js"),
  "test:billing must include phase4a-sync-pull-pagination.examples.js"
);

console.log("Phase 4A sync pull pagination examples passed");
