import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  describeSyncFeedFailure,
  shouldRefuseStartup,
  syncFeedRepairHint,
  SYNC_FEED_TABLES,
} from '../src/modules/sync/sync-feed-integrity.js';

/**
 * Nothing in application code writes ChangeLog — every row is produced by a
 * database trigger, and /sync/pull is a straight read of that table. Lose the
 * triggers and two-way sync becomes push-only with no symptom at all: every
 * device still reports "Synced" while a second terminal never receives the
 * first one's bills.
 */
function run() {
  // The table list is the contract, and both engines must state it. SQLite needs
  // one trigger per operation and PostgreSQL covers all three at once, so the
  // check compares coverage per table rather than trigger names — but the set of
  // tables has to match, or one engine is silently unguarded.
  const sqliteMigrations = [
    'prisma/migrations/20260714011000_monotonic_sync_feed/migration.sql',
    'prisma/migrations/20260731190000_expense_sync_feed/migration.sql',
  ].map((file) => readFileSync(file, 'utf8')).join('\n');
  const postgresMigrations = [
    'prisma-postgres/migrations/000053_monotonic_sync_feed/migration.sql',
    'prisma-postgres/migrations/000076_expense_sync_feed/migration.sql',
  ].map((file) => readFileSync(file, 'utf8')).join('\n');

  for (const table of SYNC_FEED_TABLES) {
    assert.ok(
      sqliteMigrations.includes(`ON "${table}"`),
      `${table} is checked at startup but no SQLite migration puts a trigger on it`,
    );
    assert.ok(
      postgresMigrations.includes(`ON "${table}"`),
      `${table} is checked at startup but no PostgreSQL migration puts a trigger on it`,
    );
  }

  // A datasource this cannot inspect must not read as a pass. "We did not look"
  // and "we looked and it was fine" are the two answers the check exists to
  // keep apart, so an unknown engine still reports a failure.
  const unknown = { engine: 'unknown', checked: false, ok: false, missing: [] };
  assert.match(describeSyncFeedFailure(unknown), /could not be verified/);
  assert.equal(shouldRefuseStartup(unknown, 'production'), true);

  // The failure names the tables, says what the symptom will be, and ends with
  // the command that repairs it — an operator reading one log line should not
  // have to find this file to know what to do.
  const broken = { engine: 'sqlite', checked: true, ok: false, missing: ['Payment', 'Product'] };
  const detail = describeSyncFeedFailure(broken);
  assert.match(detail, /Payment, Product/);
  assert.match(detail, /push keeps working/);
  assert.ok(detail.endsWith(syncFeedRepairHint('sqlite')), 'failure must end with the repair command');
  assert.match(syncFeedRepairHint('sqlite'), /install-sqlite-sync-triggers/);
  assert.match(syncFeedRepairHint('postgres'), /migrations/);

  // Production refuses to serve; development is told but not blocked, because
  // `prisma db push` is the documented local workflow and it drops triggers.
  assert.equal(shouldRefuseStartup(broken, 'production'), true);
  assert.equal(shouldRefuseStartup(broken, 'development'), false);
  assert.equal(shouldRefuseStartup(broken, 'test'), false);

  // A healthy feed never blocks anything, in any environment.
  const healthy = { engine: 'sqlite', checked: true, ok: true, missing: [] };
  assert.equal(shouldRefuseStartup(healthy, 'production'), false);

  // The startup path must actually consult it, and db:push must put the
  // triggers back — otherwise the check cries wolf on the documented workflow
  // and a developer learns to ignore it.
  const server = readFileSync('src/server.js', 'utf8');
  assert.ok(server.includes('inspectSyncFeedTriggers(db, databaseEngine)'), 'server startup must verify the sync feed');
  assert.ok(server.includes('shouldRefuseStartup(feed, env.NODE_ENV)'), 'server startup must honour the refusal rule');
  const pushScript = readFileSync('scripts/update-local-sqlite-schema.js', 'utf8');
  assert.ok(
    pushScript.includes('install-sqlite-sync-triggers.js'),
    'db push drops triggers, so the local schema script must reinstall them',
  );

  console.log('sync feed integrity examples passed');
}

run();
