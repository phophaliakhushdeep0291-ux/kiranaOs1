import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isTransientSyncEventResult,
  isTransientSyncFailure,
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
