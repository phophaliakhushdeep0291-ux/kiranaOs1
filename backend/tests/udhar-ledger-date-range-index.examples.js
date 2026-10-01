/**
 * udhar-ledger-date-range-index.examples.js
 *
 * Every shop-wide report that asks what was collected in a window reads UdharLedger
 * by shopId and a businessDate range, with neither a customerId nor a locationId to
 * narrow it — daily closing, the payment-mode report, P&L (twice) and the payment
 * summary. "All locations" is the default, so this is the common shape, not the edge.
 *
 * UdharLedger already carried @@index([shopId, customerId, businessDate]) and
 * @@index([shopId, locationId, businessDate]), and NEITHER can serve that query: the
 * second column is unconstrained, so the range on the third cannot be seeked. The
 * planner fell back to the shopId prefix of a unique key and then filtered the shop's
 * ENTIRE ledger history by date in the engine. End of day therefore got slower every
 * day the shop traded — on a five-year ledger the read measured 4.7 ms against 0.008 ms
 * with this index, and the gap only widens.
 *
 * Bill, Expense and StockLedger all have their own (shopId, date) index. UdharLedger was
 * the one that did not, which is why it is worth a test rather than a comment: the two
 * near-miss composites make it look covered.
 */

import assert from "node:assert/strict";
import fs from "node:fs";

const INDEX = "UdharLedger_shopId_businessDate_idx";

function modelBlock(schema, model) {
  return schema.match(new RegExp(`model\\s+${model}\\s*\\{[\\s\\S]*?\\n\\}`, "m"))?.[0] ?? "";
}

// ── 1. Both schemas declare it, and on UdharLedger specifically ───────────────
for (const [label, path] of [["SQLite", "prisma/schema.prisma"], ["PostgreSQL", "prisma-postgres/schema.prisma"]]) {
  const block = modelBlock(fs.readFileSync(path, "utf8"), "UdharLedger");
  assert.ok(block, `${label}: UdharLedger model not found`);
  assert.match(
    block,
    /@@index\(\[shopId, businessDate\]\)/,
    `${label}: UdharLedger is missing @@index([shopId, businessDate]); shop-wide date-range reports fall back to scanning the shop's whole ledger`,
  );
  // The near misses stay — customer statements and per-branch reads still need them.
  assert.match(block, /@@index\(\[shopId, customerId, businessDate\]\)/, `${label}: lost the customer composite`);
  assert.match(block, /@@index\(\[shopId, locationId, businessDate\]\)/, `${label}: lost the location composite`);
}

// ── 2. Both migration trees create it, idempotently ──────────────────────────
const migrations = [
  ["SQLite", "prisma/migrations/20260919120000_udhar_ledger_business_date_index/migration.sql"],
  ["PostgreSQL", "prisma-postgres/migrations/000134_udhar_ledger_business_date_index/migration.sql"],
];
for (const [label, path] of migrations) {
  assert.ok(fs.existsSync(path), `${label}: migration missing at ${path}`);
  const sql = fs.readFileSync(path, "utf8");
  assert.ok(sql.includes(INDEX), `${label}: migration does not create ${INDEX}`);
  assert.match(sql, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i, `${label}: migration is not replay-safe`);
  assert.match(sql, /"shopId",\s*"businessDate"/, `${label}: migration indexes the wrong columns`);
}

// The Postgres deploy script only auto-replays migrations that certify themselves.
const pgSql = fs.readFileSync(migrations[1][1], "utf8");
assert.match(pgSql, /@replay-safe/, "PostgreSQL migration is missing the @replay-safe marker");

// ── 3. The release gate knows about it ───────────────────────────────────────
assert.ok(
  fs.readFileSync("scripts/production-check.js", "utf8").includes(INDEX),
  `production-check.js does not list ${INDEX} among the critical indexes`,
);

// ── 4. The reports that need it still ask in the shape it covers ─────────────
// If a report starts filtering by customerId or locationId instead, this index is no
// longer the one it needs — and if these queries lose `businessDate`, they are reading
// the wrong clock (createdAt is sync time, not when the money moved).
const reports = fs.readFileSync("src/modules/reports/reports.service.js", "utf8");
const shopWideUdharReads = reports.match(/db\.udharLedger\.findMany|client\.udharLedger\.findMany/g) ?? [];
assert.ok(shopWideUdharReads.length >= 4, "expected the report service to still read UdharLedger directly");
assert.ok(
  reports.includes('type: "payment", mode: { in: ["cash", "upi", "bank"] }, businessDate: { gte: start, lte: end }'),
  "the shop-wide udhar collection read changed shape; re-check that (shopId, businessDate) is still the right index",
);

console.log("udhar-ledger-date-range-index.examples.js OK");
