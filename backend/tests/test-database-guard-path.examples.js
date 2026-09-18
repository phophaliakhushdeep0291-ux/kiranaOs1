// The DB-backed suite must refuse a dev/production database — and only that.
//
// The guard used to match "dev.db" or "prod" anywhere in the resolved SQLite
// URL, which is the whole absolute path. So a checkout living under a directory
// with "prod" in its name — a worktree called `prodready`, a folder called
// `products`, a user whose home is `/Users/prodeep` — could not run any DB test
// at all: every run died claiming it was pointed at a production database that
// did not exist. What must never be touched is a database NAMED like the dev or
// production one, and that is what the file name says.
import assert from "node:assert/strict";
import { assertSafeTestDatabaseUrl, sqliteDatabaseFileName } from "../scripts/test-db-utils.js";

function allows(url) {
  assert.equal(
    assertSafeTestDatabaseUrl(url),
    url,
    `Expected the guard to allow ${url}`,
  );
}

function refuses(url) {
  assert.throws(
    () => assertSafeTestDatabaseUrl(url),
    /dev\/production-looking/,
    `Expected the guard to refuse ${url}`,
  );
}

// ── A real test database stays allowed, wherever the repo happens to sit ──
allows("file:./prisma/test.db");
allows("file:/Users/x/prodready-wt/backend/prisma/test.db");
allows("file:/Users/prodeep/kiranaos/backend/prisma/test.db");
allows("file:/srv/products/backend/prisma/test.db");
allows("file:/c/Production Apps/kiranaos/prisma/test.db");

// ── The databases that must never be handed to a destructive suite ──
refuses("file:./prisma/dev.db");
refuses("file:/Users/x/kiranaos/backend/prisma/dev.db");
refuses("file:./prisma/prod.db");
refuses("file:./prisma/production.db");
refuses("file:/var/data/kirana-production.db");
refuses("file:/var/data/kirana_prod.db");

// ── The file name is read from the last path segment, on either separator ──
assert.equal(sqliteDatabaseFileName("file:./prisma/test.db"), "test.db");
assert.equal(sqliteDatabaseFileName("file:C:\\shop\\prisma\\Dev.DB"), "dev.db");
assert.equal(sqliteDatabaseFileName("file:/a/b/test.db?mode=rwc"), "test.db");
assert.equal(sqliteDatabaseFileName(undefined), "");

console.log("Test database path guard examples passed");
