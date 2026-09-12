/**
 * Whether this database can still tell other devices what changed.
 *
 * Nothing in application code writes ChangeLog. Every row in it is produced by a
 * database trigger, and /sync/pull is a straight read of that table — so if the
 * triggers are gone, pull answers "no changes" forever while push keeps working
 * perfectly. Every device reports a clean "Synced", the owner has no reason to
 * doubt it, and a second terminal simply never learns about the first one's
 * bills. Nothing anywhere says so.
 *
 * That is not a theoretical state. `prisma db push` recreates tables and drops
 * their triggers with them, and it is the documented local schema workflow; a
 * restore that rebuilds a table does the same. The triggers live in migrations,
 * not in schema.prisma, so nothing regenerates them.
 *
 * The check is coverage per table rather than per trigger name, because the two
 * engines spell the same guarantee differently: SQLite needs a separate trigger
 * for insert, update and delete, while PostgreSQL covers all three in one
 * (see 20260714011000_monotonic_sync_feed and 000053_monotonic_sync_feed).
 * Comparing names would report a false failure on whichever engine was not the
 * one the list was written against.
 */
export const SYNC_FEED_TABLES = Object.freeze([
  "Bill",
  "BillItem",
  "Customer",
  "Expense",
  "Payment",
  "Product",
  "ProductSellingUnit",
  "PurchaseHistory",
  "StockLedger",
  "Supplier",
  "UdharLedger",
]);

async function readTriggeredTables(client, engine) {
  if (engine === "sqlite") {
    const rows = await client.$queryRawUnsafe(
      `SELECT DISTINCT tbl_name AS "table" FROM sqlite_master WHERE type = 'trigger' AND substr(name, 1, 5) = 'sync_'`,
    );
    return rows.map((row) => String(row.table));
  }
  if (engine === "postgres") {
    const rows = await client.$queryRawUnsafe(
      `SELECT DISTINCT c.relname AS "table"
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND left(t.tgname, 5) = 'sync_'`,
    );
    return rows.map((row) => String(row.table));
  }
  return null;
}

/**
 * @returns {Promise<{ engine: string, checked: boolean, ok: boolean, missing: string[] }>}
 * `checked: false` means the engine is one this cannot inspect, which is
 * reported as such rather than as a pass — "we did not look" and "we looked and
 * it was fine" are the two answers this whole check exists to keep apart.
 */
export async function inspectSyncFeedTriggers(client, engine) {
  const triggered = await readTriggeredTables(client, engine);
  if (triggered === null) {
    return { engine, checked: false, ok: false, missing: [] };
  }
  const present = new Set(triggered);
  const missing = SYNC_FEED_TABLES.filter((table) => !present.has(table));
  return { engine, checked: true, ok: missing.length === 0, missing };
}

export function syncFeedRepairHint(engine) {
  return engine === "sqlite"
    ? "Run: node scripts/install-sqlite-sync-triggers.js"
    : "Re-apply the monotonic sync feed migrations (000053, 000076).";
}

/**
 * What to say about a feed that did not verify, and whether to serve anyway.
 *
 * Kept here rather than inline at the call site so the production decision can
 * be tested without booting a server against PostgreSQL — env validation
 * rejects a SQLite datasource in production long before startup reaches this
 * check, so a boot test can only ever exercise the development branch.
 */
export function describeSyncFeedFailure(feed) {
  return feed.checked
    ? `Sync change feed is broken: no triggers on ${feed.missing.join(", ")}. `
      + `Pull will report no changes forever while push keeps working. `
      + syncFeedRepairHint(feed.engine)
    : `Sync change feed could not be verified for datasource "${feed.engine}".`;
}

/**
 * Production refuses to serve: continuing means knowingly selling
 * automatic_two_way_sync while it cannot work, and the damage is silent and
 * unrecoverable for the window it lasts — changes made with the triggers gone
 * were never recorded, so reinstalling them later starts capturing only from
 * that point. A failed boot is visible and a rollback fixes it.
 *
 * Everywhere else it is loud but not fatal: `prisma db push` is the documented
 * local schema workflow and it drops triggers, so a developer who just ran it
 * needs telling, not blocking.
 */
export function shouldRefuseStartup(feed, nodeEnv) {
  return !feed.ok && nodeEnv === "production";
}
