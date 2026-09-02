import assert from "node:assert/strict";
import { compareRestoreManifests, validateManifest } from "../scripts/restore-fidelity.js";
import { assertSafeRestoreTarget, postgresCliUrl, maskPostgresUrl } from "../scripts/postgres-url-safety.js";

const record = (rows = "1", sha256 = "a".repeat(64)) => ({ rows, sha256 });
const source = { tables: Object.fromEntries(["Shop", "Product", "Customer", "Bill", "BillItem", "Payment", "UdharLedger", "_prisma_migrations"].map((table) => [table, record()])) };
assert.equal(compareRestoreManifests(source, structuredClone(source)).contentHashesMatched, true);
assert.throws(() => compareRestoreManifests(source, { tables: { ...source.tables, Bill: record("1", "b".repeat(64)) } }), { code: "RESTORE_FIDELITY_MISMATCH" });
assert.throws(() => compareRestoreManifests(source, { tables: { ...source.tables, Unexpected: record() } }), { code: "RESTORE_FIDELITY_MISMATCH" });
assert.throws(() => compareRestoreManifests(source, { tables: { _prisma_migrations: record() } }), { code: "RESTORE_FIDELITY_MISMATCH" });
const empty = { tables: Object.fromEntries(Object.keys(source.tables).map((table) => [table, record(table === "_prisma_migrations" ? "1" : "0")])) };
assert.throws(() => compareRestoreManifests(empty, empty), { code: "RESTORE_WORKLOAD_EMPTY" });
assert.throws(() => validateManifest({ tables: {} }), /public tables/);
assert.throws(() => validateManifest({ tables: { Bill: record("NaN") } }), /Invalid/);
assert.throws(() => validateManifest({ tables: { Bill: record(9007199254740992) } }), /Invalid/);
const large = structuredClone(source);
large.tables.Bill.rows = "9007199254740993";
assert.equal(compareRestoreManifests(large, large).totalRows, "9007199254741000");
const changed = structuredClone(large);
changed.tables.Bill.rows = "9007199254740992";
assert.throws(() => compareRestoreManifests(large, changed), { code: "RESTORE_FIDELITY_MISMATCH" });

const a = "postgresql://owner:p%40ss@localhost/source_test?schema=public";
for (const restore of [
  "postgresql://owner:p%40ss@localhost:5432/source_test",
  "postgresql://other@127.0.0.1/source_test",
  "postgresql://other@db-alias/source_test",
  "postgresql://other@localhost/restore_test?dbname=source_test",
  "postgresql://other@localhost/restore_test?hostaddr=192.0.2.1",
  "postgresql://other@localhost/restore_test?service=production",
]) {
  assert.throws(() => assertSafeRestoreTarget({ sourceUrl: a, restoreUrl: restore, allowFlag: true }), /same database|override connection/);
}
assert.throws(() => assertSafeRestoreTarget({ sourceUrl: a, restoreUrl: "postgresql://owner@localhost/restore_test", allowFlag: false }), /ALLOW_RESTORE_TEST_DB/);
assert.throws(() => assertSafeRestoreTarget({ sourceUrl: a, restoreUrl: "postgresql://owner@localhost/live_restore", allowFlag: true }), /production-like/);
assert.equal(assertSafeRestoreTarget({ sourceUrl: a, restoreUrl: "postgresql://owner@localhost/restore_test", allowFlag: true }).restore.port, "5432");
const native = new URL(postgresCliUrl(a + "&connection_limit=5&pool_timeout=10&pgbouncer=true&socket_timeout=10&sslmode=verify-full&connect_timeout=9"));
for (const name of ["schema", "connection_limit", "pool_timeout", "pgbouncer", "socket_timeout"]) assert.equal(native.searchParams.has(name), false);
assert.equal(native.searchParams.get("sslmode"), "verify-full");
assert.equal(native.searchParams.get("connect_timeout"), "9");
assert.equal(native.password, "p%40ss");
const masked = maskPostgresUrl(a + "&sslpassword=hidden&token=hidden2");
for (const secret of ["owner", "p%40ss", "hidden", "hidden2"]) assert.equal(masked.includes(secret), false);
console.log("Restore fidelity behavior: non-empty business proof, same-count tampering, exact large integers, target alias/override safety and URL redaction passed");
