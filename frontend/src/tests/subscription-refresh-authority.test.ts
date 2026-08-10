import { beforeEach, describe, expect, it, vi } from "vitest";

const getSubscriptionStatus = vi.hoisted(() => vi.fn());
const writeSubscriptionSnapshot = vi.hoisted(() => vi.fn());

vi.mock("@/features/core/subscription/api", () => ({ getSubscriptionStatus }));
vi.mock("@/features/core/subscription/access", () => ({ writeSubscriptionSnapshot }));

import { subscriptionRefreshLocalFirst } from "@/features/core/subscription/local-actions";

describe("server-authoritative subscription refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("caches only a subscription state confirmed by the server", async () => {
    const subscription = { planCode: "growth", status: "active", syncAllowed: true };
    getSubscriptionStatus.mockResolvedValue(subscription);

    const result = await subscriptionRefreshLocalFirst("starter");

    expect(writeSubscriptionSnapshot).toHaveBeenCalledWith(subscription);
    expect(result).toEqual(expect.objectContaining({ success: true, pendingSync: false, subscription }));
  });

  it("does not enqueue or cache a fake refresh while offline", async () => {
    getSubscriptionStatus.mockRejectedValue(new Error("network unavailable"));

    await expect(subscriptionRefreshLocalFirst("growth")).rejects.toThrow("network unavailable");
    expect(writeSubscriptionSnapshot).not.toHaveBeenCalled();
  });
});
