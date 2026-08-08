import assert from "assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { serializeTicket, KOT_MAX_AGE_MS } from "../src/verticals/restaurant/kot/kot.service.js";
import {
  KOT_STATUSES,
  fireTicketSchema,
  updateTicketStatusSchema,
} from "../src/verticals/restaurant/kot/kot.schema.js";

/**
 * Kitchen tickets.
 *
 * The rules pinned here are the ones that made a device-local KOT wrong, and
 * that nothing may quietly re-derive: what a ticket looks like to the screen
 * reading it, what the server refuses to accept, and the guarantees the schema
 * itself carries — server-assigned numbering and durable create idempotency.
 *
 * The behaviour that needs a database (numbering retries, the idempotent
 * re-fire, soft-void not resurrecting) is exercised against a real one and is
 * not re-stated here; what this file can hold is everything that is true
 * without one.
 */

const root = dirname(fileURLToPath(new URL("../src/app.js", import.meta.url)));
const readRepo = (relative) => readFileSync(join(root, "..", relative), "utf8");
const readFrontend = (relative) => readFileSync(join(root, "..", "..", "frontend", relative), "utf8");

// ── What the kitchen screen is handed ────────────────────────────────────────

const row = {
  id: "kt1",
  ticketNo: 14,
  tableId: "table-3",
  tableName: "T3",
  billId: "bill-9",
  status: "new",
  linesJson: JSON.stringify([{ key: "k1", name: "Dal", qty: 2, unit: "plate" }]),
  firedAt: new Date("2026-08-07T10:00:00.000Z"),
  servedAt: null,
  locationId: null,
};

const ticket = serializeTicket(row);
assert.deepStrictEqual(
  ticket.lines,
  [{ key: "k1", name: "Dal", qty: 2, unit: "plate" }],
  "lines must survive the round trip through the stored column",
);
assert.strictEqual(ticket.servedAt, null, "an uncooked ticket has no served time");

// `createdAt` mirrors `firedAt` because the client's KotTicket has always been
// keyed on createdAt — the screen ages a ticket from it, and renaming the field
// under the screen would silently make every ticket read as 0 minutes old.
assert.strictEqual(
  ticket.createdAt,
  row.firedAt,
  "createdAt must mirror firedAt, which is what the screen ages a ticket from",
);

// A ticket whose lines cannot be parsed is still work the kitchen has to see.
// Dropping the row would hide a dish that is already on the pass.
const damaged = serializeTicket({ ...row, linesJson: "{not json" });
assert.deepStrictEqual(damaged.lines, [], "unreadable lines degrade to empty");
assert.strictEqual(damaged.ticketNo, 14, "but the ticket itself survives");
assert.strictEqual(serializeTicket(null), null, "a missing ticket stays missing");

// ── What the server refuses ──────────────────────────────────────────────────

assert.ok(
  !fireTicketSchema.safeParse({ tableId: "t", tableName: "T", billId: "b", lines: [] }).success,
  "an empty ticket must be refused — there is nothing to cook",
);

for (const qty of [0, -1]) {
  assert.ok(
    !fireTicketSchema.safeParse({
      tableId: "t", tableName: "T", billId: "b",
      lines: [{ key: "k", name: "Dal", qty }],
    }).success,
    `a line of ${qty} must be refused`,
  );
}

const parsed = fireTicketSchema.parse({
  tableId: "t", tableName: "T", billId: "b",
  lines: [{ key: "k", name: "  Dal  ", qty: 1 }],
});
assert.strictEqual(parsed.lines[0].unit, "piece", "a line without a unit is counted in pieces");
assert.strictEqual(parsed.lines[0].name, "Dal", "the dish name is trimmed before it reaches the pass");

// billId is required, and that is the point of it: counting "already fired"
// against the table alone would tell a fresh party's two naan they had been
// sent, because the last party's ticket had two.
assert.ok(
  !fireTicketSchema.safeParse({ tableId: "t", tableName: "T", lines: [{ key: "k", name: "Dal", qty: 1 }] }).success,
  "a ticket must name the sitting it belongs to, not only the table",
);

assert.ok(!updateTicketStatusSchema.safeParse({ status: "burnt" }).success, "an unknown status is refused");
for (const status of KOT_STATUSES) {
  assert.ok(updateTicketStatusSchema.safeParse({ status }).success, `${status} is a real state`);
}

// ── The two halves must agree on the flow ────────────────────────────────────

// The kitchen screen draws its rail from KOT_STATUS_FLOW. If the two lists ever
// disagree, a status the server accepts becomes a column the screen cannot
// show, and the ticket disappears mid-service rather than erroring.
const tableStore = readFrontend("src/features/verticals/restaurant/service/table-store.ts");
const flow = tableStore.match(/KOT_STATUS_FLOW: KotStatus\[\] = \[([^\]]+)\]/);
assert.ok(flow, "table-store.ts must still declare KOT_STATUS_FLOW");
assert.deepStrictEqual(
  flow[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean),
  KOT_STATUSES,
  "the client's status flow and the server's accepted statuses must match",
);

assert.strictEqual(KOT_MAX_AGE_MS, 24 * 60 * 60 * 1000, "the rail looks back one day");

// ── The screens must read the server, not this device ────────────────────────

// The bug this whole module exists to fix: a kitchen display is a DIFFERENT
// device from the till that fires the ticket, so a ticket kept in the firing
// device's IndexedDB reached nobody.
const kitchenPage = readFrontend("src/features/verticals/restaurant/pages/KitchenPage.tsx");
assert.ok(
  kitchenPage.includes("listKitchenTickets"),
  "the kitchen display must read tickets from the server",
);
assert.ok(
  !/\bloadKotTickets\b|\bsaveKotTickets\b/.test(kitchenPage),
  "the kitchen display must not fall back to this device's own ticket store",
);

const tablesPage = readFrontend("src/features/verticals/restaurant/pages/TablesPage.tsx");
assert.ok(
  tablesPage.includes("fireKitchenTicket"),
  "firing must reach the server, or the kitchen never hears about it",
);
assert.ok(
  !/\bsaveKotTickets\b/.test(tablesPage),
  "a send that failed must NOT be consoled with a local copy the kitchen cannot see",
);

// ── Route and tenant guards ──────────────────────────────────────────────────

const routes = readRepo("src/verticals/restaurant/kot/kot.routes.js");
assert.ok(
  routes.includes('requireCapability("KOT")'),
  "a shop without a kitchen is turned away by the server, not only by a hidden sidebar entry",
);

const service = readRepo("src/verticals/restaurant/kot/kot.service.js");
assert.ok(
  service.includes("resolveOperationalLocation"),
  "the location must be resolved through the helper that checks it belongs to THIS shop",
);
assert.ok(
  !/locationId:\s*input\.locationId\s*[,}]/.test(service),
  "a client-sent locationId must never be trusted as given",
);

// ── What the schema itself guarantees ────────────────────────────────────────

for (const schemaPath of ["prisma/schema.prisma", "prisma-postgres/schema.prisma"]) {
  const schema = readRepo(schemaPath);
  assert.ok(schema.includes("model KitchenTicket"), `${schemaPath} must declare KitchenTicket`);
  assert.match(schema, /kitchenTickets\s+KitchenTicket\[\]/, `${schemaPath} must relate tickets back to the shop`);

  // The guard that turns a two-till numbering race into a retry rather than two
  // tickets sharing a number.
  assert.match(
    schema,
    /@@unique\(\[shopId, ticketNo\]\)/,
    `${schemaPath} must stop two tills claiming one ticket number`,
  );
  // Durable create idempotency: a retried fire must not put the dish on twice.
  assert.match(
    schema,
    /@@unique\(\[shopId, idempotencyKey\]\)/,
    `${schemaPath} must make a retried fire land once`,
  );
  // Nullable on purpose — NULLs are DISTINCT in a unique index, so tickets
  // fired without a key never collide with each other.
  assert.match(schema, /idempotencyKey\s+String\?/, `${schemaPath} must leave the key optional`);
}

// Both databases must gain the table, or the feature 500s on one of them —
// which is exactly how the clothing rentals shipped broken.
const pgMigration = readRepo("prisma-postgres/migrations/000094_restaurant_kitchen_tickets/migration.sql");
const sqliteMigration = readRepo("prisma/migrations/20260807160000_restaurant_kitchen_tickets/migration.sql");
for (const [name, sql] of [["postgres", pgMigration], ["sqlite", sqliteMigration]]) {
  assert.ok(sql.includes('CREATE TABLE'), `the ${name} migration must create the table`);
  assert.ok(sql.includes('"KitchenTicket"'), `the ${name} migration must name KitchenTicket`);
}

// An interrupted deploy must be able to replay this rather than wedging the
// container, which runs migrations before the app and exits if they fail.
assert.ok(
  pgMigration.includes("@replay-safe"),
  "the postgres migration must certify itself replay-safe",
);
assert.ok(
  pgMigration.includes("CREATE TABLE IF NOT EXISTS"),
  "and must actually be idempotent, not merely claim to be",
);
assert.ok(
  pgMigration.includes("duplicate_object"),
  "its foreign keys must be guarded — ADD CONSTRAINT has no IF NOT EXISTS in PostgreSQL",
);

console.log("kitchen-tickets.examples.js OK");
