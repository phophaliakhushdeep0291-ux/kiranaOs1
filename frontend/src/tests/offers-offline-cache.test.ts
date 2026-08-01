import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ cached: undefined as unknown, request: vi.fn() }));
vi.mock("@/lib/api/http", () => ({
  ApiClientError: class ApiClientError extends Error { constructor(public message: string, public status: number) { super(message); } },
  apiRequest: state.request,
}));
vi.mock("@/lib/offline/db", () => ({ offlineDB: {
  setSetting: vi.fn(async (_key: string, value: unknown) => { state.cached = value; }),
  getSetting: vi.fn(async () => state.cached),
} }));

import { listOffers } from "@/features/offers/api";

describe("offers offline cache", () => {
  beforeEach(() => { state.cached = undefined; state.request.mockReset(); });

  it("stores a successful server list and reuses it during an outage", async () => {
    const offers = [{ id: "o1", title: "Festival", type: "flat", value: 10 }];
    state.request.mockResolvedValueOnce(offers);
    await expect(listOffers()).resolves.toEqual(offers);
    state.request.mockRejectedValueOnce(new TypeError("network down"));
    await expect(listOffers()).resolves.toEqual(offers);
  });

  it("does not hide authorization errors behind cached data", async () => {
    state.cached = [{ id: "old" }];
    const { ApiClientError } = await import("@/lib/api/http");
    state.request.mockRejectedValueOnce(new ApiClientError("Forbidden", 403));
    await expect(listOffers()).rejects.toThrow("Forbidden");
  });
});
