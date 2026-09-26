import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionCacheRow } from "@/lib/offline/db";
import type { LicenseEvaluation } from "@/features/core/devices/license";

/**
 * The launch promotion as the counter sees it: free until 1 January 2027.
 *
 * The backend's half is covered by backend/tests/free-access-window.examples.js.
 * This half has to stand on its own, because an offline till decides access from
 * what it cached — and what a lapsed shop cached says "expired".
 */

const mockState = vi.hoisted(() => ({
  subscriptionRows: [] as SubscriptionCacheRow[],
  license: null as LicenseEvaluation | null,
}));

vi.mock("@/features/core/devices/license", () => ({
  getLicenseEvaluation: vi.fn(async () => mockState.license),
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (storeName: string) => (storeName === "subscription_cache" ? mockState.subscriptionRows : [])),
  },
  dexieDB: {
    open: vi.fn(async () => undefined),
    settings: { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) },
    subscription_cache: { put: vi.fn(async () => undefined) },
  },
}));

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: vi.fn(() => ({ tenant_id: "tenant_free", store_id: "store_free", device_id: "device_free" })),
  nowIso: vi.fn(() => new Date().toISOString()),
}));

vi.mock("@/lib/offline/instant-cache", () => ({ emitLocalDataChanged: vi.fn() }));

import { decideFeature, getCurrentSubscriptionSnapshot } from "@/features/core/subscription/access";
import {
  formatFreeAccessDate,
  freeAccessPresaleFrom,
  freeAccessUntil,
  isFreeAccessPresale,
} from "@/features/core/subscription/free-access";
import { FEATURE_LABELS, PLAN_ORDER, getPlanForBusinessType, type FeatureName } from "@/features/core/subscription/plans";
import { BUSINESS_TYPE_IDS } from "@/features/core/settings/business-type-store";

// The shipped window shuts at midnight IST on 1 January 2027, which is 18:30Z the day before.
const WINDOW_END = "2026-12-31T18:30:00.000Z";
const DURING = "2026-09-21T10:00:00.000Z";
const AFTER = "2027-01-02T10:00:00.000Z";

function cachedRow(payload: Record<string, unknown>): SubscriptionCacheRow {
  return {
    id: "current",
    plan_code: String(payload.planCode),
    payload,
    tenant_id: "tenant_free",
    store_id: "store_free",
    device_id: "device_free",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    deleted_at: null,
    version: 1,
    sync_status: "synced",
    last_modified_by: null,
  } as SubscriptionCacheRow;
}

const lapsedStarter = cachedRow({
  planCode: "starter",
  status: "expired",
  currentPeriodEnd: "2026-05-01T00:00:00.000Z",
  offlineGraceEndsAt: "2026-05-08T00:00:00.000Z",
});

describe("launch promotion window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(DURING));
    // Other suites shut the window to test plan enforcement; this one wants the shipped date.
    vi.unstubAllEnvs();
    mockState.subscriptionRows = [];
    mockState.license = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe("where the window ends", () => {
    it("ships closing at midnight IST on 1 January 2027", () => {
      expect(freeAccessUntil(null)).toBe(WINDOW_END);
      expect(freeAccessUntil(null, Date.parse(WINDOW_END) - 1)).toBe(WINDOW_END);
      expect(freeAccessUntil(null, Date.parse(WINDOW_END))).toBeNull();
    });

    it("names that day as 1 January 2027, in either language, wherever the device clock is set", () => {
      expect(formatFreeAccessDate(WINDOW_END)).toBe("1 January 2027");
      expect(formatFreeAccessDate(WINDOW_END, "hi")).toContain("जनवरी");
      expect(formatFreeAccessDate(WINDOW_END, "hi")).toContain("2027");
    });

    it("follows the server once this device has heard from it", () => {
      const extended = "2027-03-31T18:30:00.000Z";
      expect(freeAccessUntil({ freeAccessUntil: extended }, Date.parse("2027-02-01T00:00:00.000Z"))).toBe(extended);
      expect(freeAccessUntil({ freeAccessUntil: null })).toBeNull();
    });

    it("keeps the shipped date for a subscription cached from a server that predates the promotion", () => {
      expect(freeAccessUntil({ planCode: "starter", status: "expired" })).toBe(WINDOW_END);
    });

    it("can be moved at build time", () => {
      vi.stubEnv("VITE_FREE_ACCESS_UNTIL", "2020-01-01T00:00:00+05:30");
      expect(freeAccessUntil(null)).toBeNull();
    });
  });

  describe("the last month, when plans go back on sale", () => {
    // Without it a shop would meet its first bill and its first lockout at the same
    // midnight, with no way to have paid beforehand.
    const PRESALE_FROM = "2026-11-30T18:30:00.000Z"; // 1 December 2026, midnight IST

    it("opens 31 days before the window shuts, and not a moment earlier", () => {
      expect(freeAccessPresaleFrom(WINDOW_END)).toBe(PRESALE_FROM);
      expect(isFreeAccessPresale(WINDOW_END, Date.parse(PRESALE_FROM) - 1)).toBe(false);
      expect(isFreeAccessPresale(WINDOW_END, Date.parse(PRESALE_FROM))).toBe(true);
      expect(isFreeAccessPresale(WINDOW_END, Date.parse("2026-12-31T17:30:00.000Z"))).toBe(true);
    });

    it("is over once the window shuts, and never runs without one", () => {
      expect(isFreeAccessPresale(WINDOW_END, Date.parse(WINDOW_END))).toBe(false);
      expect(isFreeAccessPresale(WINDOW_END, Date.parse(AFTER))).toBe(false);
      expect(isFreeAccessPresale(null)).toBe(false);
    });

    it("changes nothing about access: the product is still free until the window shuts", async () => {
      mockState.subscriptionRows = [lapsedStarter];
      vi.setSystemTime(new Date("2026-12-10T10:00:00.000Z"));

      const current = await getCurrentSubscriptionSnapshot();

      expect(current.freeAccessUntil).toBe(WINDOW_END);
      expect(current.isExpired).toBe(false);
      expect(decideFeature(current, "whatsapp_reminders").allowed).toBe(true);
    });
  });

  describe("what the counter allows", () => {
    it("opens everything to a lapsed shop while the window runs", async () => {
      mockState.subscriptionRows = [lapsedStarter];

      const current = await getCurrentSubscriptionSnapshot();

      expect(current).toMatchObject({
        planCode: "pro",
        status: "active",
        isExpired: false,
        isPaymentFailed: false,
        graceActive: false,
        localOnlyAfterExpiry: false,
        cloudSyncAllowed: true,
        canCreateNewBills: true,
        freeAccessUntil: WINDOW_END,
      });
      for (const feature of ["whatsapp_reminders", "staff_login", "stock_adjustment", "cloud_backup", "automatic_two_way_sync", "new_billing"] as const) {
        expect(decideFeature(current, feature).allowed, feature).toBe(true);
      }
    });

    it("opens the whole product, not just the trade's top plan", async () => {
      // Any shop can switch on another trade's module — a grocer turning on rentals —
      // and the trade's own top plan left those behind an upgrade nobody could buy.
      mockState.subscriptionRows = [lapsedStarter];

      const current = await getCurrentSubscriptionSnapshot();

      for (const feature of Object.keys(FEATURE_LABELS) as FeatureName[]) {
        expect(decideFeature(current, feature).allowed, feature).toBe(true);
      }
      const everyPlan = PLAN_ORDER.flatMap((code) => BUSINESS_TYPE_IDS.map((type) => getPlanForBusinessType(code, type)));
      for (const limit of ["maxDevices", "maxStaff", "maxStores"] as const) {
        expect(current.plan[limit], limit).toBe(Math.max(...everyPlan.map((plan) => plan[limit])));
      }
    });

    it("enforces the same shop's own row again once the window shuts, with nothing rewritten", async () => {
      mockState.subscriptionRows = [lapsedStarter];
      vi.setSystemTime(new Date(AFTER));

      const current = await getCurrentSubscriptionSnapshot();

      expect(current.freeAccessUntil).toBeNull();
      expect(current.planCode).toBe("starter");
      expect(current.isExpired).toBe(true);
      expect(decideFeature(current, "cloud_backup").allowed).toBe(false);
      expect(decideFeature(current, "whatsapp_reminders").allowed).toBe(false);
      expect(decideFeature(current, "new_billing").allowed).toBe(true);
    });

    it("does not let an expired device licence lock an offline till out of a free product", async () => {
      mockState.license = {
        state: "expired",
        token: {
          tenant_id: "tenant_free",
          store_id: "store_free",
          plan: "starter",
          features: ["basic_billing"],
          max_devices: 1,
          valid_until: "2026-05-01T00:00:00.000Z",
          offline_grace_until: "2026-05-08T00:00:00.000Z",
          signature: "server-signature",
        },
        plan: "starter",
        maxDevices: 1,
        cloudSyncAllowed: false,
        billingAllowed: false,
        premiumActionsAllowed: false,
        message: "Offline grace expired.",
        validUntil: "2026-05-01T00:00:00.000Z",
        offlineGraceUntil: "2026-05-08T00:00:00.000Z",
      };

      const current = await getCurrentSubscriptionSnapshot();

      expect(current.isExpired).toBe(false);
      expect(current.cloudSyncAllowed).toBe(true);
      expect(decideFeature(current, "staff_login").allowed).toBe(true);
    });

    it("never tells a shop paid beyond the window that its access ends sooner", async () => {
      mockState.subscriptionRows = [cachedRow({
        planCode: "growth",
        status: "active",
        currentPeriodEnd: "2027-06-01T00:00:00.000Z",
        offlineGraceEndsAt: "2027-06-08T00:00:00.000Z",
      })];

      const current = await getCurrentSubscriptionSnapshot();

      expect(current.freeAccessUntil).toBe(WINDOW_END);
      expect(current.currentPeriodEnd).toBe("2027-06-01T00:00:00.000Z");
      expect(current.offlineGraceEndsAt).toBe("2027-06-08T00:00:00.000Z");
    });

    it("stops when the server says the promotion is over, even before the shipped date", async () => {
      mockState.subscriptionRows = [cachedRow({ ...lapsedStarter.payload as Record<string, unknown>, freeAccessUntil: null })];

      const current = await getCurrentSubscriptionSnapshot();

      expect(current.freeAccessUntil).toBeNull();
      expect(current.isExpired).toBe(true);
    });
  });
});
