import { describe, expect, it } from "vitest";
import { MAX_REPAIR_REQUEUES } from "@/features/core/sync/sync-status-repair";

/**
 * The sweep↔push loop that reached retry_count 108 on a production device.
 *
 * A repair sweep rescues an event by flipping it back to PENDING. isOutboxPendingNow
 * treats PENDING as immediately eligible and only checks the attempt cap on the
 * FAILED branch, so a swept event bypasses the cap by construction. That is correct
 * when the sweep is right about the cause being fixed — and unbounded when it isn't:
 *
 *   sweep -> PENDING -> push -> server still rejects -> FAILED -> sweep -> ...
 *
 * The shop sees "will retry automatically" forever while every sync cycle re-pushes
 * a change that cannot succeed. The bound below is what makes that loop terminate.
 */

interface LoopRow {
  status: "PENDING" | "FAILED";
  retry_count: number;
  repair_requeues?: number;
}

// Mirrors requeuedForRetry's contract: bounded, and resets the attempt budget
// because the sweep only fires once it believes the blocking cause is gone.
function sweepRequeue(row: LoopRow): LoopRow | null {
  const requeues = row.repair_requeues ?? 0;
  if (requeues >= MAX_REPAIR_REQUEUES) return null;
  return { status: "PENDING", retry_count: 0, repair_requeues: requeues + 1 };
}

function serverRejects(row: LoopRow): LoopRow {
  return { ...row, status: "FAILED", retry_count: row.retry_count + 1 };
}

describe("a repair sweep cannot re-queue an event forever", () => {
  it("stops re-queueing once the bound is reached, against a server that never accepts", () => {
    let row: LoopRow = { status: "FAILED", retry_count: 1 };
    let sweeps = 0;

    // Run far more cycles than the bound; the loop must go quiet on its own.
    for (let cycle = 0; cycle < 200; cycle += 1) {
      const requeued = sweepRequeue(row);
      if (!requeued) break;
      sweeps += 1;
      row = serverRejects(requeued);
    }

    expect(sweeps).toBe(MAX_REPAIR_REQUEUES);
    expect(sweepRequeue(row)).toBeNull();
    // The runaway counter is what the shopkeeper actually saw. Bounded now.
    expect(row.retry_count).toBeLessThan(12);
  });

  it("still rescues an event as soon as the cause is genuinely fixed", () => {
    const stuck: LoopRow = { status: "FAILED", retry_count: 9, repair_requeues: 1 };
    const requeued = sweepRequeue(stuck);

    expect(requeued).not.toBeNull();
    expect(requeued?.status).toBe("PENDING");
    // Attempts burned against the OLD cause must not count against the fixed one,
    // or a long-stuck change would be dead on arrival the moment it could succeed.
    expect(requeued?.retry_count).toBe(0);
  });

  it("lets the owner's explicit Retry outrank the bound", () => {
    const exhausted: LoopRow = { status: "FAILED", retry_count: 40, repair_requeues: MAX_REPAIR_REQUEUES };
    expect(sweepRequeue(exhausted)).toBeNull();

    // What retryFailedSyncOperations writes when the owner taps Retry. It clears
    // the sweep bound but keeps retry_count, which is the history shown on the
    // Sync Status screen — PENDING already bypasses the attempt cap on its own.
    const manual = { ...exhausted, status: "PENDING" as const, repair_requeues: 0 };
    expect(sweepRequeue(manual)).not.toBeNull();
    expect(manual.retry_count).toBe(40);
  });
});
