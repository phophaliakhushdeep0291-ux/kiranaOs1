import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const coordinator = readFileSync("src/lib/browser/multiTabCoordinator.ts", "utf8");
const http = readFileSync("src/lib/api/http.ts", "utf8");
const bootstrap = readFileSync("src/features/sync/CloudDataBootstrap.tsx", "utf8");
const offlineStatus = readFileSync("src/features/sync/useOfflineStatus.ts", "utf8");
const realtimeBridge = readFileSync("src/lib/realtime/useRealtimeRefreshBridge.ts", "utf8");
const syncApi = readFileSync("src/features/sync/api.ts", "utf8");
const syncEngine = readFileSync("src/features/sync/sync-engine.ts", "utf8");
const syncPull = readFileSync("src/features/sync/sync-pull.ts", "utf8");
const authContext = readFileSync("src/features/auth/AuthContext.tsx", "utf8");

describe("multi-session request isolation", () => {
  it("allows visible tabs/devices to make interactive requests independently", () => {
    expect(coordinator).toContain("shouldRunInteractiveNetworkWork");
    expect(coordinator).toContain("return typeof document === \"undefined\" || document.visibilityState === \"visible\"");
    expect(coordinator).toContain("shouldRunScheduledNetworkWork");
    expect(coordinator).toContain("return isBackgroundLeader()");
  });

  it("keeps only scheduled sync leader-locked, not all network requests", () => {
    expect(bootstrap).toContain("shouldRunScheduledNetworkWork");
    expect(offlineStatus).toContain("shouldRunScheduledNetworkWork");
    expect(realtimeBridge).toContain("shouldRunInteractiveNetworkWork");
  });

  it("actively refetches visible queries after local writes without hammering sync status churn", () => {
    expect(realtimeBridge).toContain("scheduleRefresh(FAST_REFRESH_DELAY_MS, \"active\")");
    expect(realtimeBridge).toContain("detail?.source === \"broadcast\"");
    expect(realtimeBridge).toContain("kirana.localActiveQueryRefresh.lastRun");
    expect(realtimeBridge).toContain("const onSyncQueueUpdated = () => scheduleRefresh()");
    expect(realtimeBridge).toContain("void queryClient.invalidateQueries({ refetchType })");
  });

  it("lets the visible tab with local backup items recover its own queue", () => {
    expect(offlineStatus).toContain("LOCAL_QUEUE_RECOVERY_THROTTLE_KEY");
    expect(offlineStatus).toContain("counts.totalBlocking === 0");
    expect(offlineStatus).toContain("syncNow({ manual: true, hydrate: false })");
    expect(offlineStatus).toContain("shouldPassSharedThrottle");
  });

  it("uses per-route 429 cooldown only for background reads", () => {
    expect(http).toContain("const readRateLimitCooldownByBucket = new Map");
    expect(http).toContain("function rateLimitBucket");
    expect(http).toContain("background?: boolean");
    expect(http).toContain("if (!background || !isReadMethod(method)) return");
    expect(http).not.toContain("readRateLimitCooldownUntil");
  });

  it("marks scheduled sync reads as background traffic", () => {
    expect(syncApi).toContain("background: params.background");
    expect(syncEngine).toContain("getSyncStatus({ background: true })");
    expect(syncPull).toContain("background: true");
  });

  it("serializes refresh rotation across tabs and propagates shared session changes", () => {
    expect(coordinator).toContain("withCrossTabLock");
    expect(coordinator).toContain("locks.request(name, { mode: \"exclusive\" }, callback)");
    expect(http).toContain("AUTH_REFRESH_LOCK_NAME");
    expect(http).toContain("stored.refreshToken !== refreshToken");
    expect(http).toContain("refreshStoredAuthSession");
    expect(authContext).toContain("AUTH_SESSION_STORAGE_KEY");
    expect(authContext).toContain('window.addEventListener("storage", handleSharedSessionChange)');
  });
});
