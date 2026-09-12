import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isTransientSyncEventResult,
  isTransientSyncFailure,
  nextTransientFailureCount,
  transientFailureCount,
  transientRetryDelayMs,
} from "@/features/core/sync/sync-failure-classification";

/** A per-event result exactly as the backend's `buildSyncResult` shapes a failure. */
function eventFailure(code: string, retryable: boolean | undefined, error = "Sync event failed") {
  return {
    clientEventId: "evt_1",
    eventId: "evt_1",
    type: "CREATE_BILL",
    status: "failed",
    success: false,
    serverId: null,
    error,
    code,
    result: retryable === undefined ? { code } : { code, retryable },
  };
}

/**
 * The property being protected: a failure that is not the operation's fault must
 * never be able to retire that operation. `retry_count` only increments on
 * FAILED, and twelve of those remove a row from automatic sync for good — so a
 * shop on patchy wifi could strand a morning of sales in about a dozen blips.
 */
describe("sync failure classification", () => {
  it("treats a request that never got a verdict as transient", () => {
    // A dropped connection throws a bare TypeError with no status at all.
    expect(isTransientSyncFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientSyncFailure(new Error("NetworkError"))).toBe(true);
    expect(isTransientSyncFailure(undefined)).toBe(true);
    expect(isTransientSyncFailure(null)).toBe(true);
    expect(isTransientSyncFailure({ status: 0 })).toBe(true);
  });

  it("treats a server that failed to answer as transient", () => {
    for (const status of [500, 502, 503, 504, 507, 522, 524, 599]) {
      expect(isTransientSyncFailure({ status })).toBe(true);
    }
  });

  it("treats timeouts, rate limits and expired tokens as transient", () => {
    expect(isTransientSyncFailure({ status: 408 })).toBe(true);
    expect(isTransientSyncFailure({ status: 429 })).toBe(true);
    // 401 is refreshable — the shop's work must not be retired because a token
    // aged out in the middle of a push.
    expect(isTransientSyncFailure({ status: 401 })).toBe(true);
  });

  it("treats a definite refusal as permanent, so it parks instead of hammering", () => {
    // These are verdicts: the server read the operation and said no. Retrying the
    // same bytes twelve times over twenty minutes helps nobody.
    for (const status of [400, 403, 404, 409, 410, 422]) {
      expect(isTransientSyncFailure({ status })).toBe(false);
    }
  });

  it("backs off transient retries but comes back promptly", () => {
    expect(transientRetryDelayMs(0)).toBe(1_000);
    expect(transientRetryDelayMs(1)).toBe(2_000);
    expect(transientRetryDelayMs(3)).toBe(8_000);
    // Capped: the operation is not suspect, we are only waiting for the network.
    expect(transientRetryDelayMs(50)).toBe(30_000);
    expect(transientRetryDelayMs(-4)).toBe(1_000);
    expect(Number.isFinite(transientRetryDelayMs(Number.NaN))).toBe(true);
  });

  it("defers the batch as PENDING rather than FAILED, so no attempt is spent", () => {
    const push = readFileSync("src/features/core/sync/sync-push.ts", "utf8");
    const branch = push.slice(push.indexOf("if (isTransientSyncFailure(error))"));
    // PENDING is the whole point: retry_count only increments on FAILED.
    expect(branch).toContain('"PENDING"');
    expect(branch).toContain("deferMs: transientRetryDelayMs(attempt)");
    // And it must not report a failure, or a wifi blip lights the review banner.
    expect(branch).toContain("failed: 0");
  });

  it("treats a per-event result the server marked retryable as transient", () => {
    // Inside a 200 push, one event can still fail without being judged. The
    // server's classifySyncError says so with `retryable: true` on the result.
    const writeConflict = eventFailure(
      "SERVER_ERROR",
      true,
      "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
    );
    expect(isTransientSyncEventResult(writeConflict)).toBe(true);
    expect(isTransientSyncEventResult(eventFailure("SERVER_ERROR", true, "Service unavailable"))).toBe(true);
    expect(isTransientSyncEventResult(eventFailure("SYNC_EVENT_IN_PROGRESS", true))).toBe(true);
    expect(isTransientSyncEventResult(eventFailure("SYNC_DEPENDENCY_PENDING", true))).toBe(true);
    // 408/425/429 come back as SERVER_ERROR + retryable too.
    expect(isTransientSyncEventResult(eventFailure("SERVER_ERROR", true, "Too many requests"))).toBe(true);
  });

  it("reads the retryable flag at the top level as well as on the result envelope", () => {
    expect(isTransientSyncEventResult({ status: "failed", success: false, retryable: true })).toBe(true);
    expect(isTransientSyncEventResult({ status: "failed", result: { retryable: true } })).toBe(true);
  });

  it("keeps a per-event refusal permanent, so it still parks for a human", () => {
    // 401/403 per event is a missing or wrong owner PIN — a verdict, not an
    // expired token — and the server marks it retryable: false.
    expect(isTransientSyncEventResult(eventFailure("PERMISSION_DENIED", false))).toBe(false);
    expect(isTransientSyncEventResult(eventFailure("PACKAGING_MODE_STOCK_MIGRATION_REQUIRED", false))).toBe(false);
  });

  it("lets an explicit retryable: false outrank a transient-looking code", () => {
    expect(isTransientSyncEventResult(eventFailure("SERVER_ERROR", false))).toBe(false);
    expect(isTransientSyncEventResult({ code: "SERVER_ERROR", retryable: false, result: { retryable: true } })).toBe(false);
    expect(isTransientSyncEventResult({ code: "SYNC_EVENT_IN_PROGRESS", retryable: true, result: { retryable: false } })).toBe(false);
  });

  it("falls back to the transient codes only when the result carries no flag", () => {
    expect(isTransientSyncEventResult(eventFailure("SERVER_ERROR", undefined))).toBe(true);
    expect(isTransientSyncEventResult(eventFailure("SYNC_EVENT_IN_PROGRESS", undefined))).toBe(true);
    expect(isTransientSyncEventResult({ status: "failed", result: { code: "SYNC_DEPENDENCY_PENDING" } })).toBe(true);
    expect(isTransientSyncEventResult(eventFailure("PERMISSION_DENIED", undefined))).toBe(false);
    // A bare failure with neither a flag nor a code is what older responses and
    // the existing FAILED-path tests send. It must stay on the FAILED path.
    expect(isTransientSyncEventResult({ op_id: "op_1", status: "FAILED", error_message: "payment rejected" })).toBe(false);
    expect(isTransientSyncEventResult(undefined)).toBe(false);
    expect(isTransientSyncEventResult(null)).toBe(false);
    expect(isTransientSyncEventResult("failed")).toBe(false);
  });

  it("honours the deferral so a failing server is not hammered every cycle", () => {
    const db = readFileSync("src/lib/offline/db.ts", "utf8");
    const pendingBranch = db.slice(db.indexOf("if (isPending) {"));
    // A PENDING row is normally due at once; one carrying next_retry_at was
    // deferred by a transient failure and must wait its turn.
    expect(pendingBranch.slice(0, 600)).toContain("if (!event.next_retry_at) return true;");
    expect(db).toContain('status === "FAILED" || retryDelayMs > 0');
  });
});

/**
 * How long a deferred row waits. It used to be sized from `retry_count`, which a
 * transient failure never moves — that is the whole point of sending it back to
 * PENDING — so a row the server had never refused waited 1s every time, and a
 * till facing a 500ing server re-sent on every scheduler tick until it recovered.
 */
describe("transient failure streak", () => {
  it("backs a row off further with every transient failure in a row", () => {
    // What the outbox does on each failure: size the deferral from the count as
    // it stands, then record one more. retry_count takes no part in it.
    let row: { retry_count: number; transient_failures?: number } = { retry_count: 0 };
    const waits: number[] = [];
    for (let failure = 0; failure < 8; failure += 1) {
      const deferMs = transientRetryDelayMs(transientFailureCount(row));
      waits.push(deferMs);
      row = { ...row, transient_failures: nextTransientFailureCount(row, "PENDING", deferMs) };
    }

    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    expect(row.transient_failures).toBe(8);
    expect(row.retry_count).toBe(0);
  });

  it("ignores retry_count, so a row with refusals behind it is not made to wait longer", () => {
    // Eleven refusals, then the network drops: still the first transient failure.
    const refusedOften: { retry_count: number; attempts: number; transient_failures?: number } = {
      retry_count: 11,
      attempts: 11,
    };
    expect(transientFailureCount(refusedOften)).toBe(0);
    expect(transientRetryDelayMs(transientFailureCount(refusedOften))).toBe(1_000);
  });

  it("ends the streak on any verdict", () => {
    const streak = { transient_failures: 4 };
    expect(nextTransientFailureCount(streak, "SYNCED", 0)).toBe(0);
    expect(nextTransientFailureCount(streak, "CONFLICT", 0)).toBe(0);
    // FAILED carries its own ladder's delay; that is not a transient deferral.
    expect(nextTransientFailureCount(streak, "FAILED", 0)).toBe(0);
    expect(nextTransientFailureCount(streak, "FAILED", 5_000)).toBe(0);
  });

  it("keeps the streak through a push in flight and a plain requeue", () => {
    const streak = { transient_failures: 4 };
    // Every retry passes through SYNCING. Resetting there would erase the backoff
    // on the very attempt it was spacing out.
    expect(nextTransientFailureCount(streak, "SYNCING", 0)).toBe(4);
    // PENDING with no deferral is not a failure.
    expect(nextTransientFailureCount(streak, "PENDING", 0)).toBe(4);
    expect(nextTransientFailureCount(streak, "PENDING", 16_000)).toBe(5);
  });

  it("reads a missing or unreadable counter as no failures", () => {
    // Every row queued before the counter existed has no such field.
    expect(transientFailureCount({})).toBe(0);
    expect(transientFailureCount({ transient_failures: undefined })).toBe(0);
    expect(transientFailureCount({ transient_failures: null })).toBe(0);
    expect(transientFailureCount({ transient_failures: Number.NaN })).toBe(0);
    expect(transientFailureCount({ transient_failures: "3" })).toBe(0);
    expect(transientFailureCount({ transient_failures: -2 })).toBe(0);
    expect(transientFailureCount({ transient_failures: 2.7 })).toBe(2);
    expect(nextTransientFailureCount({ transient_failures: "garbage" }, "PENDING", 1_000)).toBe(1);
  });

  it("persists the streak where the outbox row is written", () => {
    // Structural: the Dexie path cannot run here (no fake-indexeddb). The rule is
    // the one tested above; what this pins is that updatePendingEventStatus
    // stores it, fed the same deferral the caller sized.
    const db = readFileSync("src/lib/offline/db.ts", "utf8");
    expect(db).toContain("transient_failures: nextTransientFailureCount(row, status, options?.deferMs ?? 0)");
  });
});
