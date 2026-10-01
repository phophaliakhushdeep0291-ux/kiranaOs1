import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shellEn } from "@/features/core/settings/translations/shell";
import type { SubscriptionSnapshot } from "@/features/core/subscription/access";
import { getPlanForBusinessType } from "@/features/core/subscription/plans";

const state = vi.hoisted(() => ({ snapshot: null as SubscriptionSnapshot | null }));

vi.mock("@/features/core/settings/i18n", () => ({
  useAppLanguage: () => ({
    language: "en",
    t: (key: string, vars?: Record<string, string | number>) =>
      String((shellEn as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
        vars && name in vars ? String(vars[name]) : match),
  }),
}));
vi.mock("@/features/core/subscription/access", () => ({
  useSubscriptionSnapshot: () => ({ snapshot: state.snapshot, loading: false, refresh: vi.fn() }),
  writeSubscriptionRequest: vi.fn(),
  writeSubscriptionSnapshot: vi.fn(),
}));
vi.mock("@/features/core/subscription/local-actions", () => ({ subscriptionRefreshLocalFirst: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import PlansPage from "@/features/core/subscription/pages/PlansPage";
import SubscriptionPage from "@/features/core/subscription/pages/SubscriptionPage";
import { SubscriptionStatusBanner } from "@/features/core/subscription/components/SubscriptionStatusBanner";

const WINDOW_END = "2026-12-31T18:30:00.000Z";

function snapshotFor(freeAccessUntil: string | null): SubscriptionSnapshot {
  const plan = getPlanForBusinessType(freeAccessUntil ? "pro" : "starter", "kirana");
  return {
    plan,
    planCode: plan.code,
    status: "active",
    isTrial: false,
    isExpired: false,
    isPaymentFailed: false,
    trialEndsAt: null,
    currentPeriodEnd: "2027-01-15T00:00:00.000Z",
    offlineGraceEndsAt: "2027-01-22T00:00:00.000Z",
    graceActive: false,
    localOnlyAfterExpiry: false,
    cloudSyncAllowed: true,
    canCreateNewBills: true,
    message: "",
    foundingCustomer: false,
    foundingEndsAt: null,
    intendedPaidPlanCode: "starter",
    source: "local-cache",
    freeAccessUntil,
  };
}

function render(page: () => ReturnType<typeof createElement> | null, snapshot: SubscriptionSnapshot) {
  state.snapshot = snapshot;
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/plans" }, createElement(page)));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("screens during the launch promotion", () => {
  it("the plans page says the product is free and offers nothing to buy", () => {
    const html = render(PlansPage, snapshotFor(WINDOW_END));

    expect(html).toContain("Free until 1 January 2027");
    expect(html).toContain("Every feature on every plan is already unlocked for your shop.");
    expect(html).toContain("Manage current plan");
    expect(html).not.toContain("Upgrade to ");
    expect(html).toContain("Free · ");
    expect(html).not.toMatch(/>Rs \d+ Business</);
  });

  it("the subscription page shows the plan as free, with no upgrade or cancel to press", () => {
    const html = render(SubscriptionPage, snapshotFor(WINDOW_END));

    expect(html).toContain("Everything is free until 1 January 2027.");
    expect(html).toContain("Every plan is free until 1 January 2027. These prices apply after that.");
    expect(html).not.toContain("Compare and upgrade");
    expect(html).not.toContain("Cancel plan");
    expect(html).toContain('text-emerald-700">Free</p>');
    expect(html).not.toContain('text-[#66758d]">/month');
    // The comparison grid is still shown, as the prices that apply afterwards, but cannot start a checkout.
    expect(html.match(/<button[^>]*disabled=""[^>]*>/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("sells plans again in the last month, dated from the day the window shuts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-10T10:00:00.000Z"));

    const plans = render(PlansPage, snapshotFor(WINDOW_END));
    const subscription = render(SubscriptionPage, snapshotFor(WINDOW_END));

    // Still free, and it says so — but now there is something to buy for January.
    expect(plans).toContain("Free until 1 January 2027 — plans start then");
    expect(plans).toContain("none of your free days come out of it");
    expect(plans).toContain("Upgrade to ");
    // The subscription page has no "upgrade" button to show — the free plan is already
    // the top one — so its comparison grid is what picks January's plan: live again,
    // and each card says when what it sells begins.
    expect(subscription).toContain("Starts on 1 January 2027");
    expect(subscription).not.toMatch(/<button[^>]*disabled=""/);
    expect(subscription).toContain("Choose a plan now and it starts on 1 January 2027");
  });

  it("warns that free access is ending while there is still time to act", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-10T10:00:00.000Z"));

    const banner = render(SubscriptionStatusBanner, snapshotFor(WINDOW_END));

    expect(banner).toContain("Free access ends on 1 January 2027");
    expect(banner).toContain("See plans");
    expect(banner).toContain('href="/plans"');
  });

  it("stays quiet earlier in the window, when there is nothing to do about it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T10:00:00.000Z"));

    expect(render(SubscriptionStatusBanner, snapshotFor(WINDOW_END))).toBe("");
    expect(render(PlansPage, snapshotFor(WINDOW_END))).not.toContain("Upgrade to ");
  });

  it("both pages sell plans as before once the window has shut", () => {
    const plans = render(PlansPage, snapshotFor(null));
    const subscription = render(SubscriptionPage, snapshotFor(null));

    expect(plans).toContain("Upgrade to ");
    expect(plans).not.toContain("Free until");
    expect(subscription).toContain("Compare and upgrade");
    expect(subscription).toContain("Cancel plan");
    expect(subscription).not.toContain("Free until");
  });
});
