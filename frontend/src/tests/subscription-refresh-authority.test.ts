import { beforeEach, describe, expect, it, vi } from "vitest";

const getSubscriptionStatus = vi.hoisted(() => vi.fn());
const getOfflineLicense = vi.hoisted(() => vi.fn());
const parseOfflineLicenseToken = vi.hoisted(() => vi.fn());
const writeOfflineLicenseToken = vi.hoisted(() => vi.fn());
const writeSubscriptionSnapshot = vi.hoisted(() => vi.fn());

vi.mock("@/features/core/subscription/api", () => ({ getSubscriptionStatus }));
vi.mock("@/features/core/subscription/access", () => ({ writeSubscriptionSnapshot }));
vi.mock("@/features/core/devices/api", () => ({ getOfflineLicense }));
vi.mock("@/features/core/devices/license", () => ({
  parseOfflineLicenseToken,
  writeOfflineLicenseToken,
}));

import { subscriptionRefreshLocalFirst } from "@/features/core/subscription/local-actions";

describe("server-authoritative subscription refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("caches only a subscription state confirmed by the server", async () => {
    const subscription = { planCode: "growth", status: "active", syncAllowed: true };
    const licensePayload = { planCode: "growth", signature: "server-signature" };
    const license = {
      tenant_id: "shop_1",
      store_id: "shop_1",
      plan: "growth",
      features: ["staff_login"],
      max_devices: 5,
      valid_until: "2026-09-01T00:00:00.000Z",
      offline_grace_until: "2026-09-08T00:00:00.000Z",
      signature: "server-signature",
    };
    getSubscriptionStatus.mockResolvedValue(subscription);
    getOfflineLicense.mockResolvedValue(licensePayload);
    parseOfflineLicenseToken.mockReturnValue(license);

    const result = await subscriptionRefreshLocalFirst("starter");

    expect(parseOfflineLicenseToken).toHaveBeenCalledWith(licensePayload);
    expect(writeOfflineLicenseToken).toHaveBeenCalledWith(license, "subscription-refresh");
    expect(writeSubscriptionSnapshot).toHaveBeenCalledWith(subscription);
    expect(writeOfflineLicenseToken.mock.invocationCallOrder[0]).toBeLessThan(
      writeSubscriptionSnapshot.mock.invocationCallOrder[0],
    );
    expect(result).toEqual(expect.objectContaining({ success: true, pendingSync: false, subscription }));
  });

  it("does not enqueue or cache a fake refresh while offline", async () => {
    getSubscriptionStatus.mockRejectedValue(new Error("network unavailable"));

    await expect(subscriptionRefreshLocalFirst("growth")).rejects.toThrow("network unavailable");
    expect(writeOfflineLicenseToken).not.toHaveBeenCalled();
    expect(writeSubscriptionSnapshot).not.toHaveBeenCalled();
  });

  it("does not report success or overwrite caches when signed licence refresh fails", async () => {
    getSubscriptionStatus.mockResolvedValue({ planCode: "growth", status: "active" });
    getOfflineLicense.mockRejectedValue(new Error("licence endpoint unavailable"));

    await expect(subscriptionRefreshLocalFirst("starter")).rejects.toThrow("licence endpoint unavailable");
    expect(writeOfflineLicenseToken).not.toHaveBeenCalled();
    expect(writeSubscriptionSnapshot).not.toHaveBeenCalled();
  });

  it("rejects malformed unsigned licence payloads before granting paid access", async () => {
    getSubscriptionStatus.mockResolvedValue({ planCode: "growth", status: "active" });
    getOfflineLicense.mockResolvedValue({ planCode: "growth", signature: null });
    parseOfflineLicenseToken.mockReturnValue(null);

    await expect(subscriptionRefreshLocalFirst("starter")).rejects.toThrow("valid signed device licence");
    expect(writeOfflineLicenseToken).not.toHaveBeenCalled();
    expect(writeSubscriptionSnapshot).not.toHaveBeenCalled();
  });

  it("rejects inconsistent server plan and signed licence responses", async () => {
    getSubscriptionStatus.mockResolvedValue({ planCode: "growth", status: "active" });
    getOfflineLicense.mockResolvedValue({ planCode: "starter", signature: "server-signature" });
    parseOfflineLicenseToken.mockReturnValue({ plan: "starter", signature: "server-signature" });

    await expect(subscriptionRefreshLocalFirst("starter")).rejects.toThrow("inconsistent subscription and device licence plans");
    expect(writeOfflineLicenseToken).not.toHaveBeenCalled();
    expect(writeSubscriptionSnapshot).not.toHaveBeenCalled();
  });
});
