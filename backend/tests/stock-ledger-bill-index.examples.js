/**
 * stock-ledger-bill-index.examples.js
 *
 * StockLedger carried a `billId` column and not one index containing it. Four
 * separate reads ask what stock a single bill moved:
 *
 *   cancelBill      count(shopId, billId, action='sale') — decides whether a
 *                   cancellation restores stock at all
 *   restoreBill     count(shopId, billId, action='cancel_reversal')
 *   the sync echo   findMany(shopId, billId, action='sale'), built into the reply
 *                   to every replayed offline sale
 *   assurance       findMany(shopId, billId), with no action filter
 *
 * None of the eight existing indexes has billId anywhere in it, so all four
 * seeked on a shopId prefix and then filtered the shop's ENTIRE movement history
 * in the engine. A stock ledger is the fastest-growing table a shop has — one row
 * per line of every sale, purchase, damage and count — so the cost of cancelling
 * one bill grew with how long the shop had been trading.
 *
 * `action` is deliberately the third column, not the second: the assurance read
 * does not filter on it, and a two-column prefix still serves that.
 */

import assert from "node:assert/strict";
import fs from "node:fs";

const INDEX = "StockLedger_shopId_billId_action_idx";

function modelBlock(schema, model) {
  return schema.match(new RegExp(`model\\s+${model}\\s*\\{[\\s\\S]*?\\n\\}`, "m"))?.[0] ?? "";
}

// ── 1. Both schemas declare it, on StockLedger specifically ──────────────────
for (const [label, path] of [["SQLite", "prisma/schema.prisma"], ["PostgreSQL", "prisma-postgres/schema.prisma"]]) {
  const block = modelBlock(fs.readFileSync(path, "utf8"), "StockLedger");
  assert.ok(block, `${label}: StockLedger model not found`);
  assert.match(
    block,
    /@@index\(\[shopId, billId, action\]\)/,
    `${label}: StockLedger is missing @@index([shopId, billId, action]); per-bill stock reads fall back to scanning the shop's whole movement history`,
  );
  // The sync keyset index is what pull pagination rides on; losing it while adding
  // this one would trade a slow cancel for a broken sync.
  assert.match(block, /@@index\(\[shopId, updatedAt, id\]\)/, `${label}: lost the sync pull keyset index`);
}

// ── 2. Both migration trees create it, idempotently ──────────────────────────
const migrations = [
  ["SQLite", "prisma/migrations/20260921060000_stock_ledger_bill_index/migration.sql"],
  ["PostgreSQL", "prisma-postgres/migrations/000135_stock_ledger_bill_index/migration.sql"],
];
for (const [label, path] of migrations) {
  assert.ok(fs.existsSync(path), `${label}: migration missing at ${path}`);
  const sql = fs.readFileSync(path, "utf8");
  assert.ok(sql.includes(INDEX), `${label}: migration does not create ${INDEX}`);
  assert.match(sql, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i, `${label}: migration is not replay-safe`);
  assert.match(sql, /"shopId",\s*"billId",\s*"action"/, `${label}: migration indexes the wrong columns, or in the wrong order`);
}

// The Postgres deploy script only auto-replays migrations that certify themselves.
const pgSql = fs.readFileSync(migrations[1][1], "utf8");
assert.match(pgSql, /@replay-safe/, "PostgreSQL migration is missing the @replay-safe marker");

// ── 3. The release gate knows about it ───────────────────────────────────────
assert.ok(
  fs.readFileSync("scripts/production-check.js", "utf8").includes(INDEX),
  `production-check.js does not list ${INDEX} among the critical indexes`,
);

// ── 4. The reads that need it still ask in the shape it covers ───────────────
// If these stop filtering on billId, this index is no longer the one they need.
const bills = fs.readFileSync("src/modules/bills/bills.service.js", "utf8");
assert.ok(
  bills.includes('where: { shopId, billId: bill.id, action: "sale" }'),
  "cancelBill no longer counts sale rows by (shopId, billId, action); re-check this index",
);
assert.ok(
  bills.includes('where: { shopId, billId: bill.id, action: "cancel_reversal" }'),
  "restoreBill no longer counts reversal rows by (shopId, billId, action); re-check this index",
);
const sync = fs.readFileSync("src/modules/sync/sync.service.js", "utf8");
assert.ok(
  sync.includes('where: { shopId, billId: bill.id, action: "sale" }'),
  "the sync echo no longer reads sale rows by (shopId, billId, action); re-check this index",
);
// The assurance read is the reason `action` is third rather than second.
const assurance = fs.readFileSync("src/modules/assurance/context.service.js", "utf8");
assert.ok(
  assurance.includes("stockLedger.findMany({ where: { shopId, billId: bill.id } })"),
  "the assurance context no longer reads StockLedger by (shopId, billId) alone; the column order was chosen for it",
);

console.log("stock-ledger-bill-index.examples.js OK");
