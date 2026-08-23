import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isTransientSyncFailure,
  transientRetryDelayMs,
} from "@/features/core/sync/sync-failure-classification";

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

  it("honours the deferral so a failing server is not hammered every cycle", () => {
    const db = readFileSync("src/lib/offline/db.ts", "utf8");
    const pendingBranch = db.slice(db.indexOf("if (isPending) {"));
    // A PENDING row is normally due at once; one carrying next_retry_at was
    // deferred by a transient failure and must wait its turn.
    expect(pendingBranch.slice(0, 600)).toContain("if (!event.next_retry_at) return true;");
    expect(db).toContain('status === "FAILED" || retryDelayMs > 0');
  });
});
