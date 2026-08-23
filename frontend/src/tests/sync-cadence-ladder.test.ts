import { describe, expect, it } from "vitest";
import {
  MAX_IDLE_STEP,
  SYNC_INTERVAL_LADDER_MS,
  nextIdleStep,
  syncDelayForStep,
} from "@/features/core/sync/sync-cadence";

describe("sync cadence ladder", () => {
  it("tries again quickly while work is queued", () => {
    // The old loop was a flat 18s, so a queued sale could sit that long before
    // anything tried to send it. The busy rung must be well under that.
    expect(syncDelayForStep(0)).toBe(2_500);
    expect(syncDelayForStep(0)).toBeLessThan(18_000);
  });

  it("backs off one rung per quiet tick and settles at the slowest", () => {
    let step = 0;
    const delays: number[] = [syncDelayForStep(step)];
    for (let tick = 0; tick < 6; tick += 1) {
      step = nextIdleStep(step, false);
      delays.push(syncDelayForStep(step));
    }
    expect(delays).toEqual([2_500, 8_000, 20_000, 45_000, 45_000, 45_000, 45_000]);
    expect(step).toBe(MAX_IDLE_STEP);
  });

  it("snaps back to the fast rung the moment work appears", () => {
    // Drift all the way to idle, then find something to send.
    let step = 0;
    for (let tick = 0; tick < 10; tick += 1) step = nextIdleStep(step, false);
    expect(syncDelayForStep(step)).toBe(45_000);

    step = nextIdleStep(step, true);
    expect(step).toBe(0);
    expect(syncDelayForStep(step)).toBe(2_500);
  });

  it("holds the fast rung for as long as work keeps being found", () => {
    // A queue needing several passes must get them at the fast cadence; backing
    // off while rows are still pending is what strands a till.
    let step = 0;
    for (let tick = 0; tick < 5; tick += 1) {
      step = nextIdleStep(step, true);
      expect(syncDelayForStep(step)).toBe(2_500);
    }
  });

  it("never returns a delay outside the ladder, whatever it is handed", () => {
    // idleStep is module state nudged from several handlers; a stray value must
    // not produce NaN (a setTimeout of NaN fires immediately — a busy loop).
    for (const input of [-5, -1, 0, 1, 2, 3, 4, 99, 2.7]) {
      const delay = syncDelayForStep(input);
      expect(SYNC_INTERVAL_LADDER_MS).toContain(delay);
      expect(Number.isFinite(delay)).toBe(true);
    }
    expect(nextIdleStep(-3, false)).toBe(1);
    expect(nextIdleStep(99, false)).toBe(MAX_IDLE_STEP);
  });

  it("keeps the idle rung long enough to matter but short enough to stay live", () => {
    // Sanity bounds: fast enough that a device still acks (device liveness rides
    // on the ack), slow enough to be a real saving over the old fixed interval.
    const slowest = syncDelayForStep(MAX_IDLE_STEP);
    expect(slowest).toBeGreaterThan(18_000);
    expect(slowest).toBeLessThanOrEqual(60_000);
  });
});
