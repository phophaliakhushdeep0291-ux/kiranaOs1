import { describe, expect, it } from "vitest";
import { syncPushTimeoutMs } from "@/features/core/sync/api";
import { SYNC_BATCH_SIZE } from "@/features/core/sync/sync-types";

/**
 * A push carries up to SYNC_BATCH_SIZE operations and the server applies them
 * one at a time, each in its own audited transaction. A full starter-catalog
 * batch measured 16-27s against local SQLite; the generic 30s POST timeout is
 * sized for a single request and cut it off.
 *
 * The abort does not stop the server — it commits every operation and only the
 * verdict is lost, leaving those rows in SYNCING until the two-minute stale
 * repair frees them. The queue then advances one batch per two minutes with the
 * counter reading "backing up" throughout.
 */
describe("the push waits for the work it asked the server to do", () => {
  it("gives a full batch far more than the 30s a single request gets", () => {
    const full = syncPushTimeoutMs(SYNC_BATCH_SIZE);
    expect(full).toBeGreaterThan(30_000);
    // Comfortably past the 27s a full batch took on the slowest measured run.
    expect(full).toBeGreaterThanOrEqual(90_000);
  });

  it("still fails a small push fast, so a dead backend does not hang a till", () => {
    expect(syncPushTimeoutMs(1)).toBeLessThanOrEqual(31_000);
    expect(syncPushTimeoutMs(0)).toBe(30_000);
  });

  it("is bounded, so a malformed count cannot wedge a request open", () => {
    expect(syncPushTimeoutMs(1_000_000)).toBe(180_000);
    expect(syncPushTimeoutMs(Number.NaN)).toBe(30_000);
    expect(syncPushTimeoutMs(-5)).toBe(30_000);
  });

  it("grows with the batch", () => {
    expect(syncPushTimeoutMs(50)).toBeLessThan(syncPushTimeoutMs(200));
  });
});
