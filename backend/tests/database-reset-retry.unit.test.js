import test from "node:test";
import assert from "node:assert/strict";
import { retryDatabaseReset } from "./integration/reset-retry.js";

test("successful cleanup runs once without a delay", async () => {
  let calls = 0;
  const result = await retryDatabaseReset(async () => { calls += 1; return "reset"; }, { wait: () => assert.fail("success must not wait") });
  assert.equal(result, "reset");
  assert.equal(calls, 1);
});

for (const [name, error] of [
  ["Prisma transaction conflict", { code: "P2034" }],
  ["raw SQL deadlock", { code: "P2010", meta: { code: "40P01" } }],
  ["wrapped cascading-delete deadlock", new Error('ConnectorError(QueryError(PostgresError { code: "40P01", message: "deadlock detected" }))')],
]) {
  test(`${name} recreates the reset after rollback`, async () => {
    let calls = 0;
    const delays = [];
    await retryDatabaseReset(async () => {
      calls += 1;
      if (calls === 1) throw error;
    }, { wait: async (ms) => { delays.push(ms); } });
    assert.equal(calls, 2);
    assert.deepEqual(delays, [50]);
  });
}

test("persistent deadlocks still fail after the bounded retries", async () => {
  const error = { code: "P2034" };
  let calls = 0;
  const delays = [];
  await assert.rejects(retryDatabaseReset(async () => { calls += 1; throw error; }, { wait: async (ms) => { delays.push(ms); } }), (actual) => actual === error);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [50, 100]);
});

for (const code of ["P2002", "SQLITE_BUSY"]) {
  test(`${code} is not hidden by a PostgreSQL cleanup retry`, async () => {
    const error = { code };
    let calls = 0;
    await assert.rejects(retryDatabaseReset(async () => { calls += 1; throw error; }, { wait: () => assert.fail("unrelated failures must not wait") }), (actual) => actual === error);
    assert.equal(calls, 1);
  });
}
