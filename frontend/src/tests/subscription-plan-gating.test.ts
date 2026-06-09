import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionCacheRow } from "@/lib/offline/db";
import type { PlanCode, SubscriptionState } from "@/features/subscription/plans";

const mockState = vi.hoisted(() => ({
  subscriptionRows: [] as SubscriptionCacheRow[],
}));

vi.mock("@/features/devices/license", () => ({
  getLicenseEvaluation: vi.fn(async () => null),
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (storeName: string) => {
      if (storeName === "subscription_cache") return mockState.subscriptionRows;
      return [];
    }),
  },
  dexieDB: {
    open: vi.fn(async () => undefined),
    settings: {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    },
    subscription_cache: {
      put: vi.fn(async () => undefined),
    },
  },
}));

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: vi.fn(() => ({
    tenant_id: "tenant_subscription_tests",
    store_id: "store_subscription_tests",
    device_id: "device_subscription_tests",
  })),
  nowIso: vi.fn(() => new Date().toISOString()),
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  emitLocalDataChanged: vi.fn(),
}));

import { decideFeature, getCurrentSubscriptionSnapshot, type SubscriptionSnapshot } from "@/features/subscription/access";
import { getPlan } from "@/features/subscription/plans";

function snapshot(planCode: PlanCode, overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  const plan = getPlan(planCode);
  return {
    plan,
    planCode: plan.code,
    status: "active",
    isTrial: false,
    isExpired: false,
    isPaymentFailed: false,
    trialEndsAt: null,
    currentPeriodEnd: "2026-07-06T00:00:00.000Z",
    offlineGraceEndsAt: "2026-07-13T00:00:00.000Z",
    graceActive: false,
    localOnlyAfterExpiry: false,
    cloudSyncAllowed: true,
    canCreateNewBills: true,
    message: "Subscription active.",
    source: "local-cache",
    ...overrides,
  };
}

function cachedSubscription({
  planCode,
  status = "active",
  currentPeriodEnd,
  offlineGraceEndsAt,
  syncAllowed = true,
}: {
  planCode: PlanCode;
  status?: SubscriptionState;
  currentPeriodEnd: string;
  offlineGraceEndsAt: string;
  syncAllowed?: boolean;
}): SubscriptionCacheRow {
  return {
    id: `subscription_${planCode}_${status}`,
    plan_code: planCode,
    payload: {
      planCode,
      status,
      currentPeriodEnd,
      offlineGraceEndsAt,
      syncAllowed,
    },
    tenant_id: "tenant_subscription_tests",
    store_id: "store_subscription_tests",
    device_id: "device_subscription_tests",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-05T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    sync_status: "synced",
    last_modified_by: null,
  } as SubscriptionCacheRow;
}

describe("subscription and plan gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T10:00:00.000Z"));
    mockState.subscriptionRows = [];
  });

  it("Starter does not unlock Growth features", () => {
    const decision = decideFeature(snapshot("starter"), "stock_adjustment");

    expect(decision.allowed).toBe(false);
    expect(decision.upgradeRequired).toBe(true);
    expect(decision.requiredPlan.code).toBe("growth");
    expect(decision.reason).toMatch(/requires Growth/i);
  });

  it("Starter does not unlock Pro features", () => {
    const decision = decideFeature(snapshot("starter"), "whatsapp_reminders");

    expect(decision.allowed).toBe(false);
    expect(decision.upgradeRequired).toBe(true);
    expect(decision.requiredPlan.code).toBe("pro");
    expect(decision.reason).toMatch(/requires Pro/i);
  });

  it("Staff login locked below Growth", () => {
    const decision = decideFeature(snapshot("standard"), "staff_login");

    expect(decision.allowed).toBe(false);
    expect(decision.upgradeRequired).toBe(true);
    expect(decision.requiredPlan.code).toBe("growth");
  });

  it("WhatsApp reminders locked below Pro", () => {
    const decision = decideFeature(snapshot("growth"), "whatsapp_reminders");

    expect(decision.allowed).toBe(false);
    expect(decision.upgradeRequired).toBe(true);
    expect(decision.requiredPlan.code).toBe("pro");
  });

  it("expired subscription blocks cloud sync", async () => {
    mockState.subscriptionRows = [cachedSubscription({
      planCode: "pro",
      status: "expired",
      currentPeriodEnd: "2026-05-01T00:00:00.000Z",
      offlineGraceEndsAt: "2026-05-08T00:00:00.000Z",
    })];

    const current = await getCurrentSubscriptionSnapshot();
    const cloudBackup = decideFeature(current, "cloud_backup");
    const twoWaySync = decideFeature(current, "automatic_two_way_sync");

    expect(current.isExpired).toBe(true);
    expect(current.cloudSyncAllowed).toBe(false);
    expect(cloudBackup.allowed).toBe(false);
    expect(twoWaySync.allowed).toBe(false);
  });

  it("expired subscription blocks premium actions", async () => {
    mockState.subscriptionRows = [cachedSubscription({
      planCode: "pro",
      status: "expired",
      currentPeriodEnd: "2026-05-01T00:00:00.000Z",
      offlineGraceEndsAt: "2026-05-08T00:00:00.000Z",
    })];

    const current = await getCurrentSubscriptionSnapshot();
    const whatsapp = decideFeature(current, "whatsapp_reminders");
    const staffLogin = decideFeature(current, "staff_login");

    expect(whatsapp.allowed).toBe(false);
    expect(staffLogin.allowed).toBe(false);
    expect(whatsapp.upgradeRequired).toBe(false);
    expect(whatsapp.reason).toMatch(/renew subscription/i);
  });

  it("old data remains viewable after expiry", async () => {
    mockState.subscriptionRows = [cachedSubscription({
      planCode: "starter",
      status: "expired",
      currentPeriodEnd: "2026-05-01T00:00:00.000Z",
      offlineGraceEndsAt: "2026-05-08T00:00:00.000Z",
    })];

    const current = await getCurrentSubscriptionSnapshot();
    const oldData = decideFeature(current, "view_old_data");

    expect(current.isExpired).toBe(true);
    expect(oldData.allowed).toBe(true);
    expect(oldData.reason).toMatch(/always viewable/i);
  });

  it("does not unlock a higher plan from a pending upgrade request", async () => {
    mockState.subscriptionRows = [
      cachedSubscription({
        planCode: "starter",
        status: "active",
        currentPeriodEnd: "2026-07-01T00:00:00.000Z",
        offlineGraceEndsAt: "2026-07-08T00:00:00.000Z",
      }),
      {
        id: "subscription_request_pro",
        plan_code: "pro",
        payload: {
          requestedPlanCode: "pro",
          status: "upgrade_requested",
          requestedAt: "2026-06-05T12:00:00.000Z",
        },
        tenant_id: "tenant_subscription_tests",
        store_id: "store_subscription_tests",
        device_id: "device_subscription_tests",
        created_at: "2026-06-05T12:00:00.000Z",
        updated_at: "2026-06-05T12:00:00.000Z",
        deleted_at: null,
        version: 1,
        sync_status: "pending_sync",
        last_modified_by: null,
      } as SubscriptionCacheRow,
    ];

    const current = await getCurrentSubscriptionSnapshot();
    const whatsapp = decideFeature(current, "whatsapp_reminders");

    expect(current.planCode).toBe("starter");
    expect(whatsapp.allowed).toBe(false);
    expect(whatsapp.upgradeRequired).toBe(true);
  });

  it("accepts backend graceEndsAt when hydrating subscription cache", async () => {
    mockState.subscriptionRows = [{
      id: "current",
      plan_code: "standard",
      payload: {
        planCode: "standard",
        status: "grace",
        currentPeriodEnd: "2026-06-01T00:00:00.000Z",
        graceEndsAt: "2026-06-10T00:00:00.000Z",
      },
      tenant_id: "tenant_subscription_tests",
      store_id: "store_subscription_tests",
      device_id: "device_subscription_tests",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-05T00:00:00.000Z",
      deleted_at: null,
      version: 1,
      sync_status: "synced",
      last_modified_by: null,
    } as SubscriptionCacheRow];

    const current = await getCurrentSubscriptionSnapshot();

    expect(current.status).toBe("grace");
    expect(current.graceActive).toBe(true);
    expect(current.offlineGraceEndsAt).toBe("2026-06-10T00:00:00.000Z");
    expect(current.cloudSyncAllowed).toBe(false);
    expect(current.canCreateNewBills).toBe(true);
  });

  it("offline grace allows billing until grace ends", async () => {
    mockState.subscriptionRows = [cachedSubscription({
      planCode: "starter",
      status: "active",
      currentPeriodEnd: "2026-06-01T00:00:00.000Z",
      offlineGraceEndsAt: "2026-06-10T00:00:00.000Z",
    })];

    const current = await getCurrentSubscriptionSnapshot();
    const billing = decideFeature(current, "new_billing");
    const premiumAction = decideFeature(current, "stock_adjustment");
    const cloudBackup = decideFeature(current, "cloud_backup");

    expect(current.graceActive).toBe(true);
    expect(current.canCreateNewBills).toBe(true);
    expect(billing.allowed).toBe(true);
    expect(current.cloudSyncAllowed).toBe(false);
    expect(cloudBackup.allowed).toBe(false);
    expect(premiumAction.allowed).toBe(false);
  });

  it("grace expired blocks new billing but does not block viewing old data", async () => {
    mockState.subscriptionRows = [cachedSubscription({
      planCode: "starter",
      status: "active",
      currentPeriodEnd: "2026-05-01T00:00:00.000Z",
      offlineGraceEndsAt: "2026-05-08T00:00:00.000Z",
    })];

    const current = await getCurrentSubscriptionSnapshot();
    const billing = decideFeature(current, "new_billing");
    const oldData = decideFeature(current, "view_old_data");

    expect(current.graceActive).toBe(false);
    expect(current.isExpired).toBe(true);
    expect(current.canCreateNewBills).toBe(false);
    expect(billing.allowed).toBe(false);
    expect(oldData.allowed).toBe(true);
  });
});
