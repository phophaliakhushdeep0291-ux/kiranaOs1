import { setTimeout as delay } from "node:timers/promises";
import db from "../db.js";
import { recordWriteConflict } from "./metrics.js";

/**
 * Serializable transactions, and what to do when PostgreSQL refuses one.
 *
 * SQLite has one writer, so two requests racing for the same rows queue: the
 * second transaction runs after the first commits, reads its result, and its own
 * guards decide the outcome — a guarded update matches no row and answers 409, an
 * idempotent replay finds the row and succeeds. PostgreSQL runs both at once and,
 * under SERIALIZABLE, aborts one instead: Prisma P2034, "write conflict or
 * deadlock". Nothing caught that, so every such race answered 500 in production
 * while the SQLite suite stayed green (owner PIN, 2026-09-10).
 *
 * Running the aborted callback again IS the SQLite schedule. It starts after the
 * winner committed, re-reads what it reads, and its guards give the answer SQLite
 * would have given. That holds for any callback whose only effects are its
 * database writes, which is why every caller stages webhooks, provider calls,
 * metrics and logs outside the callback and acts on them after it returns.
 *
 * A write conflict is deliberately NOT a 409 by default. The till's sync engine
 * parks any 4xx for a human (frontend sync-failure-classification.ts), so a
 * momentary conflict would strand a sale. When the attempts run out, the error
 * reaches the error handler, which answers 503 with Retry-After — transient to
 * the sync engine. A caller whose conflict has a real domain meaning (the owner
 * PIN's credential version) can still translate what finally escapes.
 */

const DEFAULT_ATTEMPTS = 3;

// PostgreSQL's serialization_failure and deadlock_detected. Prisma reports both
// as P2034; a raw query inside the transaction (the FOR UPDATE and advisory
// locks) reports the same failure as P2010 carrying the SQLSTATE instead.
const WRITE_CONFLICT_SQLSTATES = new Set(["40001", "40P01"]);

export function isWriteConflict(error) {
  if (error?.code === "P2034") return true;
  return error?.code === "P2010" && WRITE_CONFLICT_SQLSTATES.has(String(error?.meta?.code ?? ""));
}

/**
 * `db.$transaction(work, { isolationLevel: "Serializable" })`, retried when it
 * loses a write conflict. Other transaction options (maxWait, timeout) pass
 * through unchanged. `client` exists so a test can supply its own.
 */
export async function serializableTransaction(work, options = {}) {
  const { attempts = DEFAULT_ATTEMPTS, client = db, ...transactionOptions } = options;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await client.$transaction(work, { ...transactionOptions, isolationLevel: "Serializable" });
    } catch (error) {
      if (!isWriteConflict(error)) throw error;
      if (attempt >= attempts) {
        recordWriteConflict("exhausted");
        throw error;
      }
      recordWriteConflict("retried");
      await delay(retryDelayMs(attempt));
    }
  }
}

// Jittered, so two losers do not meet again in lockstep: 20–40ms, then 40–80ms.
function retryDelayMs(attempt) {
  const base = 20 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * base);
}
