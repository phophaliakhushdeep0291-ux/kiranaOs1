import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";

const result = spawnSync(process.execPath, ["--input-type=module", "-e", "import './src/db.js'"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", DATABASE_URL: "file:./dev.db", ALLOW_SHARED_TEST_DATABASE: "false" },
  encoding: "utf8",
});

assert.notEqual(result.status, 0);
assert.match(`${result.stdout}\n${result.stderr}`, /Refusing to run tests against the shared development database/);
console.log("shared-test-database-guard.examples.js OK");
