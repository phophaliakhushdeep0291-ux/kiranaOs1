import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cached: null as Record<string, unknown> | null,
  cacheFails: false,
}));

const updateShop = vi.hoisted(() => vi.fn());

vi.mock("@/features/core/settings/api", () => ({ updateShop }));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    setSetting: vi.fn(async (_key: string, value: Record<string, unknown>) => {
      if (state.cacheFails) throw new Error("cache unavailable");
      state.cached = structuredClone(value);
    }),
  },
}));

import { updateSettingsLocalFirst } from "@/features/core/settings/local-actions";

describe("server-authoritative settings changes", () => {
  beforeEach(() => {
    state.cached = null;
    state.cacheFails = false;
    vi.clearAllMocks();
  });

  it("updates the server before changing the local shop cache", async () => {
    updateShop.mockResolvedValue({
      id: "shop_1",
      name: "Krish Store",
      ownerName: "Owner",
      city: "Jodhpur",
      address: "Main Road",
      settingsJson: JSON.stringify({ customerOrdering: { enabled: true } }),
    });

    const saved = await updateSettingsLocalFirst({ settingsJson: "{\"customerOrdering\":{\"enabled\":true}}", ownerPin: "1234" });

    expect(updateShop).toHaveBeenCalledWith(expect.objectContaining({ ownerPin: "1234" }));
    expect(saved.id).toBe("shop_1");
    expect(state.cached).toEqual(expect.objectContaining({ id: "shop_1" }));
  });

  it("does not manufacture a local settings change when the server rejects it", async () => {
    updateShop.mockRejectedValue(new Error("network unavailable"));

    await expect(updateSettingsLocalFirst({ name: "Offline Rename", ownerPin: "1234" }))
      .rejects.toThrow("network unavailable");
    expect(state.cached).toBeNull();
  });

  it("does not report a confirmed server update as failed when only caching fails", async () => {
    state.cacheFails = true;
    updateShop.mockResolvedValue({
      id: "shop_1",
      name: "Confirmed Name",
      ownerName: "Owner",
      city: "Jodhpur",
      address: "Main Road",
    });

    await expect(updateSettingsLocalFirst({ name: "Confirmed Name", ownerPin: "1234" }))
      .resolves.toEqual(expect.objectContaining({ name: "Confirmed Name" }));
  });
});
