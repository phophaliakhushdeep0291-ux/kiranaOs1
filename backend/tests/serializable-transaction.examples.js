import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isWriteConflict, serializableTransaction } from "../src/lib/transactions.js";
import { AppError, errorHandler } from "../src/middleware/error.js";
import { classifySyncError } from "../src/utils/syncRules.js";
import { createAuditLog } from "../src/modules/audit/audit.service.js";

// On 2026-09-10 two simultaneous owner-PIN changes answered [200, 500] on
// PostgreSQL and [200, 409] on SQLite. PostgreSQL aborts the losing Serializable
// transaction with P2034 where SQLite queues it, and nothing caught P2034 at 57
// call sites. The PostgreSQL race itself is proven in
// tests/integration/serializable-conflicts.integration.test.js; this pins the
// contract around it without a database.

function prismaError(code, meta) {
  return Object.assign(new Error(`prisma ${code}`), { code, ...(meta ? { meta } : {}) });
}
const writeConflict = () => prismaError("P2034");

// A $transaction that fails with the scripted errors, then runs the callback.
function scriptedClient(failures) {
  const calls = [];
  return {
    calls,
    async $transaction(work, options) {
      calls.push(options);
      const failure = failures.shift();
      if (failure) throw failure;
      return work("tx");
    },
  };
}

// ── what counts as a write conflict ─────────────────────────────────
assert.equal(isWriteConflict(writeConflict()), true);
// The FOR UPDATE / advisory-lock raw queries report the same failure as P2010.
assert.equal(isWriteConflict(prismaError("P2010", { code: "40001" })), true, "serialization_failure from a raw query");
assert.equal(isWriteConflict(prismaError("P2010", { code: "40P01" })), true, "deadlock_detected from a raw query");
assert.equal(isWriteConflict(prismaError("P2010", { code: "42601" })), false, "a raw syntax error is not a conflict");
for (const other of [prismaError("P2002"), prismaError("P2028"), new AppError("Order changed", 409, "CONCURRENT_ORDER_UPDATE"), null, undefined]) {
  assert.equal(isWriteConflict(other), false, `not a write conflict: ${other?.code ?? other}`);
}

// ── the loser runs again, and only a conflict earns a retry ─────────
{
  const client = scriptedClient([writeConflict(), writeConflict()]);
  const result = await serializableTransaction(async (tx) => `ran in ${tx}`, { client, timeout: 15_000, maxWait: 5_000 });
  assert.equal(result, "ran in tx");
  assert.equal(client.calls.length, 3, "two conflicts, then the attempt that commits");
  for (const options of client.calls) {
    assert.deepEqual(options, { timeout: 15_000, maxWait: 5_000, isolationLevel: "Serializable" }, "Prisma options pass through; attempts/client do not");
  }
}
{
  const exhausted = writeConflict();
  const client = scriptedClient([writeConflict(), writeConflict(), exhausted]);
  await assert.rejects(serializableTransaction(async () => "never", { client }), (error) => error === exhausted);
  assert.equal(client.calls.length, 3, "three attempts by default, then the conflict itself escapes");
}
{
  const client = scriptedClient([writeConflict()]);
  await assert.rejects(serializableTransaction(async () => "never", { client, attempts: 1 }), (error) => error.code === "P2034");
  assert.equal(client.calls.length, 1);
}
for (const failure of [prismaError("P2002"), new AppError("Owner credentials changed. Try again.", 409, "OWNER_CREDENTIALS_CHANGED")]) {
  const client = scriptedClient([failure]);
  await assert.rejects(serializableTransaction(async () => "never", { client }), (error) => error === failure);
  assert.equal(client.calls.length, 1, `${failure.code} is an answer, not a conflict, and must not be retried`);
}

// ── an escaped conflict is transient, never a 4xx ───────────────────
// The till's sync engine parks any 4xx for a human; 5xx/no status is requeued.
function respond(error) {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  errorHandler(error, { requestId: "req-conflict", method: "POST", originalUrl: "/api/auth/pin/set" }, res, () => {});
  return res;
}
for (const conflict of [writeConflict(), prismaError("P2010", { code: "40001" })]) {
  const res = respond(conflict);
  assert.equal(res.statusCode, 503, "a write conflict must reach the client as transient");
  assert.equal(res.headers["retry-after"], "1");
  assert.equal(res.body.code, "WRITE_CONFLICT");
  assert.notEqual(res.body.error, "Internal server error", "the client is told to try again, not that the server broke");
}
assert.equal(respond(prismaError("P2002")).statusCode, 409, "a unique violation is still a 409");
// A domain translation made at the call site (the owner PIN) is untouched.
assert.equal(respond(new AppError("Owner credentials changed. Try again.", 409, "OWNER_CREDENTIALS_CHANGED")).body.code, "OWNER_CREDENTIALS_CHANGED");

// Inside a sync push, an escaped conflict fails the event as retryable, never as
// a durable conflict.
const classified = classifySyncError(writeConflict());
assert.equal(classified.retryable, true);
assert.notEqual(classified.resultStatus, "conflict");

// ── an audit write inside a transaction must not hide the conflict ──
// Swallowing it made writeRequired*Audit answer "could not be audited" (503)
// for what serializableTransaction could simply have run again.
const conflictingTx = { auditLog: { create: async () => { throw writeConflict(); } } };
await assert.rejects(
  createAuditLog({ shopId: "shop-1", action: "PIN_CHANGED", client: conflictingTx }),
  (error) => error.code === "P2034",
);
const brokenTx = { auditLog: { create: async () => { throw new Error("audit table unavailable"); } } };
assert.equal(await createAuditLog({ shopId: "shop-1", action: "PIN_CHANGED", client: brokenTx }), null, "other audit failures keep their contract");

// ── no Serializable transaction bypasses the retry ──────────────────
// A raw db.$transaction(..., { isolationLevel: "Serializable" }) passes every
// SQLite test and answers 500 on its first PostgreSQL write conflict.
const helperFile = path.join("src", "lib", "transactions.js");
const bypasses = [];
(function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (file.endsWith(".js") && file !== helperFile) {
      const source = fs.readFileSync(file, "utf8");
      if (/isolationLevel\s*:\s*["'](?:Serializable|RepeatableRead)["']|TransactionIsolationLevel\.(?:Serializable|RepeatableRead)/.test(source)) bypasses.push(file);
    }
  }
})("src");
assert.deepEqual(bypasses, [], `use serializableTransaction from src/lib/transactions.js instead: ${bypasses.join(", ")}`);

console.log("serializable-transaction.examples.js OK");
