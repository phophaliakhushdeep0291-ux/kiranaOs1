import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Three separate defects let the app run far more sync cycles than it scheduled.
 * Measured on an idle Products page before the fix: 38 cycles in 101 seconds,
 * arriving in threes on the same millisecond. Each one is pinned here because
 * each is invisible to the existing suites — every test stayed green throughout.
 */
describe("sync scheduling runs one engine, not one per caller", () => {
  it("keeps the sync engine in module scope so twenty call sites share it", () => {
    const source = readFileSync("src/features/core/sync/useOfflineStatus.ts", "utf8");
    // useOfflineStatus is called from twenty components. While the interval,
    // health probe and listeners lived in the hook body, every mount started its
    // own engine and the useRef re-entrancy guard was private to each one, so it
    // could not stop them overlapping. The hook must stay a subscription.
    // Matched against the import line, not the whole file: the comment above the
    // engine explains the useRef/useEffect history and would satisfy a bare search.
    expect(source).toContain('import { useSyncExternalStore } from "react";');
    const reactImport = source.split("\n").find((line) => line.includes('from "react"')) ?? "";
    expect(reactImport).not.toContain("useRef");
    expect(reactImport).not.toContain("useEffect");
    // The engine itself: started once, torn down when the last subscriber leaves.
    expect(source).toContain("function start()");
    expect(source).toContain("function stop()");
    expect(source).toContain("subscribers.size === 0");
  });

  it("ignores its own completion echo so two schedulers cannot feed each other", () => {
    const source = readFileSync("src/features/core/sync/useOfflineStatus.ts", "utf8");
    // useMultiDeviceSync announces a finished cycle on kirana:local-data-changed,
    // the same channel a local edit uses. Treating that as fresh work scheduled
    // another cycle, which announced itself, and so on. useMultiDeviceSync already
    // filtered its own echo; this side did not.
    expect(source).toContain('detail?.type === "sync"');
  });

  it("serialises every sync cycle in the tab, coalescing instead of dropping", () => {
    const source = readFileSync("src/features/core/sync/sync-engine.ts", "utf8");
    // Two schedulers (18s and 8s) plus manual retries all call runSyncCycle, and
    // their separate re-entrancy flags did not compose. One shared gate fixes it.
    expect(source).toContain("let inFlightCycle");
    expect(source).toContain("let queuedCycle");
    expect(source).toContain("runExclusiveSyncCycle");
    // Dropping a concurrent caller would silently discard the shopkeeper pressing
    // Retry, so a caller that arrives mid-cycle chains exactly one follow-up.
    expect(source).toContain("return queuedCycle");
  });

  it("checks the in-flight guard before consuming the shared recovery throttle", () => {
    const source = readFileSync("src/features/core/sync/useOfflineStatus.ts", "utf8");
    // shouldPassSharedThrottle SETS the token when it passes. Winning it and then
    // returning at the re-entrancy guard locked every other tab out of recovery
    // for three seconds having done nothing, which is how a pending queue ends up
    // waiting for a human to press Sync. Order matters: guard first, throttle second.
    // Both needles are code shapes rather than bare identifiers, because the
    // comment explaining this ordering names shouldPassSharedThrottle too.
    const body = source.slice(source.indexOf("async function recoverLocalQueueIfNeeded"));
    const guardAt = body.indexOf("if (isSyncing) return;");
    const throttleAt = body.indexOf("if (!shouldPassSharedThrottle(");
    expect(guardAt).toBeGreaterThan(0);
    expect(throttleAt).toBeGreaterThan(guardAt);
  });

  it("frees failed work from its backoff when the connection returns", () => {
    const repair = readFileSync("src/features/core/sync/sync-status-repair.ts", "utf8");
    const engine = readFileSync("src/features/core/sync/useOfflineStatus.ts", "utf8");
    // A non-bill operation backs off 2.5s, 5, 10, 20, 40, 80 then 120s between
    // attempts, and nothing used to reset that when the network came back — so a
    // product edit made just before a wifi blink sat for two minutes after the
    // wifi was fine. Backoff protects a failing SERVER; it is the wrong penalty
    // for a client that was merely offline.
    expect(repair).toContain("export async function clearRetryBackoffAfterReconnect");
    expect(engine).toContain("clearRetryBackoffAfterReconnect");
    // Fires on the backend actually answering, not on the `online` event, which
    // only claims a network interface exists.
    expect(engine).toContain("function noteReachabilityTransition");
    expect(engine).toContain("if (wasReachable || !isReachable) return;");
    // retry_count must survive, or the twelve-attempt cap stops retiring an
    // operation the server genuinely refuses and it loops across a flapping link.
    const body = repair.slice(repair.indexOf("export async function clearRetryBackoffAfterReconnect"));
    expect(body).toContain("MAX_AUTOMATIC_RETRY_ATTEMPTS) continue;");
    expect(body).toContain("next_retry_at: null");
    expect(body).not.toContain("retry_count: 0");
  });

  it("paces the sync loop by whether there is work, not by a fixed clock", () => {
    const offline = readFileSync("src/features/core/sync/useOfflineStatus.ts", "utf8");
    // A till with a queued sale wants the next attempt in seconds; a till idle
    // since breakfast should stop waking the radio. The ladder steps down only on
    // a quiet tick and any queued work snaps it back to the top, so the busy case
    // is FASTER than the old fixed 18s while the idle case is much cheaper.
    // The ladder itself is real logic with its own behavioural test — see
    // sync-cadence-ladder.test.ts. What this file pins is that the engine
    // actually uses it rather than reintroducing a fixed clock.
    //
    // The second argument is the drain rung: a cycle that SENT rows and left
    // more queued skips the wait, so a bulk import is not paced by a timer.
    // sync-bulk-queue-drain.test.ts holds the rule that gates it on progress.
    expect(offline).toContain("syncDelayForStep(idleStep, draining)");
    expect(offline).toContain("idleStep = nextIdleStep(idleStep, hadWork);");
    expect(offline).toContain("function resetSyncCadence()");
    expect(offline).not.toContain("window.setInterval(() => {\n    void refreshCount();");
    // Reset must be wired to both new local work and regaining the network.
    const queueHandler = offline.slice(offline.indexOf("function handleQueueUpdated"));
    expect(queueHandler.slice(0, queueHandler.indexOf("\n}"))).toContain("resetSyncCadence()");
    const onlineHandler = offline.slice(offline.indexOf("function handleOnline"));
    expect(onlineHandler.slice(0, onlineHandler.indexOf("\n}"))).toContain("resetSyncCadence()");
  });

  it("leaves exactly one scheduler owning the sync cadence", () => {
    const multi = readFileSync("src/lib/realtime/useMultiDeviceSync.tsx", "utf8");
    // This hook used to run a second full cycle every 8s next to the engine's own
    // loop. It keeps the jobs only it does — cross-tab broadcast, focus/online
    // catch-up, and the periodic authoritative snapshot — but no sync interval.
    expect(multi).not.toContain("SYNC_INTERVAL_MS");
    expect(multi).toContain("const SNAPSHOT_INTERVAL_MS = 60_000");
    expect(multi).toContain("BroadcastChannel");
    // The one remaining timer is the snapshot, and it must stay on the snapshot
    // interval rather than quietly becoming a sync loop again.
    const timers = multi.split("window.setInterval").length - 1;
    expect(timers).toBe(1);
    expect(multi).toContain("}, SNAPSHOT_INTERVAL_MS);");
  });
});
