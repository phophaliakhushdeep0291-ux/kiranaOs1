import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shellEn } from "@/features/core/settings/translations/shell";
import { syncEn } from "@/features/core/settings/translations/sync";
import type { SubscriptionSnapshot } from "@/features/core/subscription/access";
import { getPlanForBusinessType } from "@/features/core/subscription/plans";

/**
 * What a shop sees when its plan runs out.
 *
 * Before this, an expired shop was told three things that were not true, all at
 * once: that its unsent bills would "retry automatically when the connection is
 * healthy" (the engine had stopped trying, and the connection was fine), that
 * after a retry "backup will finish shortly" (it would not finish), and — by a
 * header badge worded exactly like a paid one — that nothing was wrong. The one
 * control that led to paying was a line of small print. These render the
 * surfaces with a lapsed plan and check what they now say and where they lead.
 */

const dictionary: Record<string, string> = { ...shellEn, ...syncEn };
const state = vi.hoisted(() => ({
  snapshot: null as SubscriptionSnapshot | null,
  queue: { queueStatus: "ready", pendingCount: 0, failedCount: 0, conflictCount: 0, isSyncing: false },
}));

vi.mock("@/features/core/settings/i18n", () => ({
  useAppLanguage: () => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? `{${name}}`)),
  }),
}));
vi.mock("@/features/core/subscription/access", async (importOriginal) => ({
  // The real subscriptionBlocksSync, so these renders exercise the rule the app uses.
  ...(await importOriginal<typeof import("@/features/core/subscription/access")>()),
  useSubscriptionSnapshot: () => ({ snapshot: state.snapshot, loading: state.snapshot === null, refresh: vi.fn() }),
}));
vi.mock("@/features/core/settings/business-types", () => ({ useBusinessTypeKey: () => "kirana" }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/features/core/sync/useOfflineStatus", () => ({ useOfflineStatus: () => state.queue }));
vi.mock("@/features/core/sync/manual-sync", () => ({ runManualSyncCycle: vi.fn() }));

import { SyncAlertBanner, syncBannerMode } from "@/features/core/sync/SyncAlertBanner";
import { SubscriptionStatusBanner } from "@/features/core/subscription/components/SubscriptionStatusBanner";
import { PlanBadge } from "@/features/core/subscription/components/PlanBadge";

function snapshot(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  const plan = getPlanForBusinessType("pro", "kirana");
  return {
    plan,
    planCode: plan.code,
    status: "active",
    isTrial: false,
    isExpired: false,
    isPaymentFailed: false,
    trialEndsAt: null,
    currentPeriodEnd: "2026-10-17T00:00:00.000Z",
    offlineGraceEndsAt: "2026-10-24T00:00:00.000Z",
    graceActive: false,
    localOnlyAfterExpiry: false,
    cloudSyncAllowed: true,
    canCreateNewBills: true,
    message: "Subscription active.",
    foundingCustomer: false,
    foundingEndsAt: null,
    intendedPaidPlanCode: plan.code,
    source: "local-cache",
    ...overrides,
  };
}

const expired = () => snapshot({
  status: "expired",
  isExpired: true,
  localOnlyAfterExpiry: true,
  cloudSyncAllowed: false,
  currentPeriodEnd: "2026-08-21T00:00:00.000Z",
  offlineGraceEndsAt: "2026-08-28T00:00:00.000Z",
  message: "Subscription expired.",
});

const render = (element: Parameters<typeof createElement>[0], props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(Router, { ssrPath: "/dashboard" }, createElement(element, props)));

beforeEach(() => {
  state.snapshot = null;
  state.queue = { queueStatus: "ready", pendingCount: 0, failedCount: 0, conflictCount: 0, isSyncing: false };
});

describe("which face the sync strip wears once the engine will not send", () => {
  const idle = { pendingCount: 0, failedCount: 0, conflictCount: 0, isSyncing: false };

  it("still says nothing about an empty queue", () => {
    expect(syncBannerMode({ ...idle, cloudSyncBlocked: true })).toBeNull();
  });

  it("calls a queue the server will refuse blocked, not waiting", () => {
    expect(syncBannerMode({ ...idle, pendingCount: 1, cloudSyncBlocked: true })).toBe("blocked");
  });

  it("puts blocked above review, because renewing is what unsticks the refused row too", () => {
    expect(syncBannerMode({ ...idle, pendingCount: 2, failedCount: 1, cloudSyncBlocked: true })).toBe("blocked");
  });

  it("leaves every existing face alone when nothing is blocked", () => {
    expect(syncBannerMode({ ...idle, pendingCount: 3 })).toBe("waiting");
    expect(syncBannerMode({ ...idle, pendingCount: 3, isSyncing: true })).toBe("backingUp");
    expect(syncBannerMode({ ...idle, pendingCount: 3, failedCount: 1 })).toBe("review");
  });
});

describe("the sync strip with an expired plan", () => {
  it("says the bill is on this device only, and drops the Retry that could never move it", () => {
    state.snapshot = expired();
    state.queue = { ...state.queue, pendingCount: 1 };

    const html = render(SyncAlertBanner);

    expect(html).toContain('data-mode="blocked"');
    expect(html).toContain("1 change is saved on this device only");
    expect(html).toContain("Cloud backup is paused until you renew");
    expect(html).not.toContain("Retry now");
    expect(html).not.toContain("connection is healthy");
    // Renew belongs to the subscription strip stacked directly above; a second
    // copy here was the same button twice. The queue itself stays inspectable.
    expect(html).not.toContain('href="/subscription"');
    expect(html).toContain('href="/sync-status"');
  });

  it("counts every stuck row, refused ones included", () => {
    state.snapshot = expired();
    state.queue = { ...state.queue, pendingCount: 3, failedCount: 1 };

    expect(render(SyncAlertBanner)).toContain("4 changes are saved on this device only");
  });

  it("treats a failed payment the same way, since the server refuses that push too", () => {
    state.snapshot = snapshot({ status: "payment_failed", isPaymentFailed: true, localOnlyAfterExpiry: true, cloudSyncAllowed: false });
    state.queue = { ...state.queue, pendingCount: 2 };

    expect(render(SyncAlertBanner)).toContain('data-mode="blocked"');
  });

  it("keeps the ordinary wait during grace, when the server still accepts the push", () => {
    // isSubscriptionActive honours the grace window, so these rows really are
    // waiting on the connection. Calling them blocked would be a new false alarm.
    state.snapshot = snapshot({ status: "grace", graceActive: true, localOnlyAfterExpiry: true, cloudSyncAllowed: false });
    state.queue = { ...state.queue, pendingCount: 1 };

    const html = render(SyncAlertBanner);

    expect(html).toContain('data-mode="waiting"');
    expect(html).toContain("Retry now");
  });

  it("does not claim a block before the subscription has been read", () => {
    state.snapshot = null;
    state.queue = { ...state.queue, pendingCount: 1 };

    expect(render(SyncAlertBanner)).toContain('data-mode="waiting"');
  });
});

describe("the subscription strip with an expired plan", () => {
  it("links out with Renew instead of Owner details", () => {
    state.snapshot = expired();

    const html = render(SubscriptionStatusBanner);

    expect(html).toContain('href="/subscription"');
    expect(html).toContain(shellEn["chrome.subscription.renew"]);
    expect(html).not.toContain(shellEn["chrome.subscription.ownerDetails"]);
  });

  it("says the plan expired at desktop width too, not only on the phone", () => {
    state.snapshot = expired();

    const html = render(SubscriptionStatusBanner);

    expect(html).toContain(shellEn["chrome.subscription.expiredLong"]);
    expect(html).toContain(shellEn["chrome.subscription.expiredShort"]);
    expect(html).not.toContain("Your saved records are available on this device");
  });

  it("does not tell a shop in grace that its backup has stopped", () => {
    // The server accepts pushes until grace ends, so the queue keeps draining.
    state.snapshot = snapshot({ status: "grace", graceActive: true, localOnlyAfterExpiry: true, cloudSyncAllowed: false });

    const html = render(SubscriptionStatusBanner);

    expect(html).toContain(shellEn["chrome.subscription.graceLong"]);
    expect(html).not.toContain("will resume after renewal");
    expect(html).toContain(shellEn["chrome.subscription.renew"]);
  });

  it("still offers Owner details to a trial that is running normally", () => {
    state.snapshot = snapshot({ status: "trial", isTrial: true, cloudSyncAllowed: false, trialEndsAt: "2026-12-01T00:00:00.000Z" });

    expect(render(SubscriptionStatusBanner)).toContain(shellEn["chrome.subscription.ownerDetails"]);
  });
});

describe("the plan badge", () => {
  it("writes an expired plan's state in words, not just in red", () => {
    const html = render(PlanBadge, { planCode: "pro", status: "expired" });

    expect(html).toContain("Business · Expired");
    expect(html).not.toContain(">Rs ");
  });

  it("names an unpaid plan and a plan in grace too", () => {
    expect(render(PlanBadge, { planCode: "pro", status: "payment_failed" })).toContain("Business · Unpaid");
    expect(render(PlanBadge, { planCode: "pro", status: "grace" })).toContain("Business · Grace");
  });

  it("keeps the price label for a plan that is simply active", () => {
    expect(render(PlanBadge, { planCode: "pro", status: "active" })).toMatch(/>Rs \d+ Business</);
  });
});
