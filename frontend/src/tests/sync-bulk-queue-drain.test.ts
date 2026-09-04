import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_IDLE_STEP,
  SYNC_DRAINING_DELAY_MS,
  SYNC_INTERVAL_LADDER_MS,
  syncDelayForStep,
} from "@/features/core/sync/sync-cadence";
import { syncBannerMode } from "@/features/core/sync/SyncAlertBanner";
import { SYNC_BATCH_SIZE } from "@/features/core/sync/sync-types";

/**
 * Loading the built-in starter catalogue, as a shop experiences it.
 *
 * The catalogue queues one outbox row per product — several hundred at once —
 * and the engine sends SYNC_BATCH_SIZE of them per cycle. Two things made that
 * feel broken rather than busy.
 *
 * The batches were 2.5s apart. Even at the ladder's fastest rung the scheduler
 * slept between passes, so the wait was dominated by a timer rather than by the
 * network: about half a minute of doing nothing, on top of a few seconds of
 * real work.
 *
 * And the whole time, the top of the app wore an amber warning triangle
 * counting the backlog down — the same face it wears when a backup has actually
 * failed. The first thing a new shop does with its product list looked like a
 * fault it had caused.
 */

const CATALOGUE_ROWS = 560;

describe("draining a bulk queue", () => {
  it("does not sleep the ladder's rung between batches that are landing", () => {
    expect(syncDelayForStep(0, true)).toBe(SYNC_DRAINING_DELAY_MS);
    expect(syncDelayForStep(0, true)).toBeLessThan(syncDelayForStep(0));
  });

  it("ignores where the ladder had drifted to", () => {
    // Work can appear while the till has been idle all afternoon. What matters
    // is that rows are landing now, not how quiet it was a minute ago.
    for (let step = 0; step <= MAX_IDLE_STEP; step += 1) {
      expect(syncDelayForStep(step, true)).toBe(SYNC_DRAINING_DELAY_MS);
    }
  });

  it("still yields between batches rather than spinning", () => {
    // Zero would be a busy loop the moment the flag is ever computed wrongly.
    expect(SYNC_DRAINING_DELAY_MS).toBeGreaterThan(0);
    expect(SYNC_DRAINING_DELAY_MS).toBeLessThan(500);
  });

  it("leaves the ordinary ladder exactly as it was", () => {
    for (const step of [0, 1, 2, 3]) {
      expect(syncDelayForStep(step)).toBe(SYNC_INTERVAL_LADDER_MS[step]);
      expect(syncDelayForStep(step, false)).toBe(SYNC_INTERVAL_LADDER_MS[step]);
    }
  });

  it("takes the timer out of a starter-catalogue load", () => {
    const batches = Math.ceil(CATALOGUE_ROWS / SYNC_BATCH_SIZE);
    // Two levers, and the batch size is the one that removes round trips
    // rather than waiting: at 50 rows a push this was twelve passes.
    expect(batches).toBeLessThanOrEqual(3);
    expect(batches * syncDelayForStep(0, true)).toBeLessThan(1_000);
    // What it used to cost, held here so the saving cannot quietly regress:
    // twelve passes at the ladder's fast rung was half a minute of sleeping.
    expect(Math.ceil(CATALOGUE_ROWS / 50) * syncDelayForStep(0)).toBeGreaterThan(25_000);
  });

  it("never asks the server for a batch it will refuse", () => {
    // PUSH_MAX_BATCH_SIZE in backend sync.schema.js is 500, validated there and
    // rejected with maxAllowed. Going past it would not be slow — every push
    // would fail outright, and the queue would never drain at all.
    expect(SYNC_BATCH_SIZE).toBeLessThanOrEqual(500);
    expect(SYNC_BATCH_SIZE).toBeGreaterThan(0);
  });
});

describe("the scheduler only hurries when rows are actually landing", () => {
  const hook = readFileSync("src/features/core/sync/useOfflineStatus.ts", "utf8");

  it("requires progress, not merely a backlog", () => {
    // A push that keeps failing leaves the same rows behind. Hurrying on a
    // backlog alone would turn a broken sync into a hot loop against the server.
    expect(hook).toContain("draining = pushed > 0 && state.pendingCount > 0;");
    expect(hook).toContain("syncDelayForStep(idleStep, draining)");
  });

  it("drops back to the ladder when a tick throws", () => {
    expect(hook).toContain("draining = false;");
  });

  it("reports what it sent, which is what the decision reads", () => {
    expect(hook).toContain("return result.pushed;");
  });
});

describe("what the banner says while that happens", () => {
  const idle = { pendingCount: 0, failedCount: 0, conflictCount: 0, isSyncing: false };

  it("says nothing when there is nothing queued", () => {
    expect(syncBannerMode(idle)).toBeNull();
  });

  it("shows progress, not a warning, while a healthy queue is sending", () => {
    expect(syncBannerMode({ ...idle, pendingCount: CATALOGUE_ROWS, isSyncing: true })).toBe("backingUp");
  });

  it("goes back to waiting once nothing is moving", () => {
    // Offline, or paused between passes: still worth saying, but it is a wait,
    // not a failure.
    expect(syncBannerMode({ ...idle, pendingCount: CATALOGUE_ROWS, isSyncing: false })).toBe("waiting");
  });

  it.each([
    ["failed", { failedCount: 1 }],
    ["conflicted", { conflictCount: 1 }],
  ])("keeps a %s row visible even mid-batch", (_label, extra) => {
    // A batch can be landing while an earlier row sits failed. Showing a calm
    // spinner over that is how a stuck row goes unnoticed for a day.
    expect(syncBannerMode({ ...idle, pendingCount: 400, isSyncing: true, ...extra })).toBe("review");
  });

  it("renders the progress state without a warning triangle", () => {
    const banner = readFileSync("src/features/core/sync/SyncAlertBanner.tsx", "utf8");
    expect(banner).toContain('mode === "backingUp"');
    expect(banner).toContain("animate-spin");
    // And no Retry button while the queue is already moving.
    expect(banner).toContain('{mode === "backingUp" ? null : (');
  });
});
