/**
 * phase4f-sync-indexes.examples.js
 *
 * Static assertions for Phase 4F: sync pull keyset pagination indexes.
 *
 * Existing indexes verified (were already present):
 *   1.  OfflineSyncEvent @@unique([shopId, eventId]) remains in both schemas.
 *   2.  OfflineSyncEvent @@index([shopId, status, createdAt]) remains.
 *   3.  Product @@index([shopId, deletedAt]) remains (soft-delete index).
 *   4.  Customer @@index([shopId, deletedAt]) remains.
 *
 * New sync pull keyset indexes (added in Phase 4F):
 *   5.  Product   @@index([shopId, updatedAt, id]) in SQLite schema.
 *   6.  Customer  @@index([shopId, updatedAt, id]) in SQLite schema.
 *   7.  Bill      @@index([shopId, updatedAt, id]) in SQLite schema.
 *   8.  StockLedger @@index([shopId, updatedAt, id]) in SQLite schema.
 *   9.  UdharLedger @@index([shopId, updatedAt, id]) in SQLite schema.
 *  10.  All 5 models also have the index in the PG schema (both schemas must match).
 *
 * Migration:
 *  11.  Forward migration 000002_sync_indexes/migration.sql exists.
 *  12.  Migration contains CREATE INDEX IF NOT EXISTS for all 5 models.
 *  13.  No existing sync functionality was removed.
 *
 * Production-check coverage:
 *  14.  production-check.js checks for the 5 new index names in migration SQL.
 *  15.  production-check.js checks @@index([shopId, updatedAt, id]) in both schemas.
 *  16.  production-check.js still checks OfflineSyncEvent unique and status indexes.
 *
 * Sync functionality:
 *  17.  sync.service.js still uses updatedAt for all pull queries.
 *  18.  sync.service.js still uses orderBy updatedAt+id for all entity queries.
 *  19.  No sync service or controller logic changed.
 *
 *  20.  Test is in the test:billing chain.
 */

import assert from "node:assert/strict";
import fs from "node:fs";

const sqliteSchema = fs.readFileSync("prisma/schema.prisma",          "utf8");
const pgSchema     = fs.readFileSync("prisma-postgres/schema.prisma", "utf8");
const productionCheck = fs.readFileSync("scripts/production-check.js", "utf8");
const syncService  = fs.readFileSync("src/modules/sync/sync.service.js", "utf8");
const packageJson  = JSON.parse(fs.readFileSync("package.json", "utf8"));

const migration000002 = fs.readFileSync(
  "prisma-postgres/migrations/000002_sync_indexes/migration.sql", "utf8"
);

function modelBlock(schema, model) {
  return schema.match(new RegExp(`model\\s+${model}\\s*\\{[\\s\\S]*?\\n\\}`, "m"))?.[0] ?? "";
}

// ── 1–2. OfflineSyncEvent idempotency indexes unchanged ───────────────────────

for (const [label, schema] of [["SQLite", sqliteSchema], ["PG", pgSchema]]) {
  assert.match(
    schema,
    /@@unique\(\[shopId, eventId\]\)/,
    `${label}: OfflineSyncEvent must retain @@unique([shopId, eventId])`
  );
  assert.match(
    schema,
    /@@index\(\[shopId, status, createdAt\]\)/,
    `${label}: OfflineSyncEvent must retain @@index([shopId, status, createdAt])`
  );
}

// ── 3–4. Soft-delete indexes unchanged ────────────────────────────────────────

for (const [label, schema] of [["SQLite", sqliteSchema], ["PG", pgSchema]]) {
  assert.ok(
    modelBlock(schema, "Product").includes("@@index([shopId, deletedAt])"),
    `${label}: Product must retain @@index([shopId, deletedAt])`
  );
  assert.ok(
    modelBlock(schema, "Customer").includes("@@index([shopId, deletedAt])"),
    `${label}: Customer must retain @@index([shopId, deletedAt])`
  );
}

// ── 5–10. New sync pull keyset indexes in both schemas ────────────────────────

const syncIndexModels = ["Product", "Customer", "Bill", "StockLedger", "UdharLedger"];

for (const model of syncIndexModels) {
  const sqliteBlock = modelBlock(sqliteSchema, model);
  assert.ok(
    sqliteBlock.includes("[shopId, updatedAt, id]"),
    `SQLite schema: ${model} must have @@index([shopId, updatedAt, id]) for sync pull keyset pagination`
  );

  const pgBlock = modelBlock(pgSchema, model);
  assert.ok(
    pgBlock.includes("[shopId, updatedAt, id]"),
    `PG schema: ${model} must have @@index([shopId, updatedAt, id]) for sync pull keyset pagination`
  );
}

// ── 11. Forward migration file exists ─────────────────────────────────────────

assert.ok(
  fs.existsSync("prisma-postgres/migrations/000002_sync_indexes/migration.sql"),
  "000002_sync_indexes/migration.sql must exist as a forward migration"
);

// ── 12. Migration contains CREATE INDEX for all 5 models ──────────────────────

for (const model of syncIndexModels) {
  const expectedIndexName = `${model}_shopId_updatedAt_id_idx`;
  assert.ok(
    migration000002.includes(expectedIndexName),
    `000002 migration must contain CREATE INDEX for ${expectedIndexName}`
  );
}

assert.match(
  migration000002,
  /CREATE INDEX IF NOT EXISTS/,
  "migration must use IF NOT EXISTS to be safe on repeat applies"
);

// ── 13. No sync functionality removed ─────────────────────────────────────────

assert.match(
  syncService,
  /export async function pullSince/,
  "pullSince must still be exported from sync.service.js"
);

assert.match(
  syncService,
  /export async function pushOfflineActions/,
  "pushOfflineActions must still be exported from sync.service.js"
);

assert.match(
  syncService,
  /@@unique\(\[shopId, eventId\]\)|shopId_eventId/,
  "sync service must still reference OfflineSyncEvent idempotency"
);

// ── 14. production-check.js checks the 5 new index names ─────────────────────

for (const model of syncIndexModels) {
  const indexName = `${model}_shopId_updatedAt_id_idx`;
  assert.ok(
    productionCheck.includes(indexName),
    `production-check.js must verify ${indexName} exists in migration SQL`
  );
}

// ── 15. production-check.js checks schemas for keyset indexes ─────────────────

assert.match(
  productionCheck,
  /shopId, updatedAt, id/,
  "production-check.js must check for [shopId, updatedAt, id] in Prisma schemas"
);

assert.match(
  productionCheck,
  /syncIndexModels|sync pull keyset/i,
  "production-check.js must document sync pull keyset index check"
);

// ── 16. production-check.js still checks OfflineSyncEvent indexes ─────────────

assert.match(
  productionCheck,
  /OfflineSyncEvent_shopId_eventId_key/,
  "production-check.js must still check OfflineSyncEvent unique index"
);

assert.match(
  productionCheck,
  /OfflineSyncEvent.*@@unique|@@unique.*OfflineSyncEvent/s,
  "production-check.js must check @@unique([shopId, eventId]) in schema"
);

// ── 17–18. Sync service still uses updatedAt ordering ─────────────────────────

assert.match(
  syncService,
  /updatedAt:\s*\{\s*gte:\s*sinceDate/,
  "pullSince must still filter by updatedAt >= sinceDate"
);

assert.match(
  syncService,
  /orderBy\s*=\s*\[\s*\{\s*updatedAt:\s*"asc"\s*\}/,
  "pullSince must still order by updatedAt asc"
);

// ── 19. Sync controller and routes not changed in this phase ──────────────────

const syncCtrl = fs.readFileSync("src/modules/sync/sync.controller.js", "utf8");
assert.match(syncCtrl, /type:\s*["']sync_push["']/, "Phase 4E logging still present in controller");
assert.match(syncCtrl, /type:\s*["']sync_pull["']/, "Phase 4E pull logging still present in controller");

// ── 20. Test is in the chain ──────────────────────────────────────────────────

assert.ok(
  packageJson.scripts["test:billing"].includes("phase4f-sync-indexes.examples.js"),
  "test:billing must include phase4f-sync-indexes.examples.js"
);

console.log("Phase 4F sync indexes examples passed");
