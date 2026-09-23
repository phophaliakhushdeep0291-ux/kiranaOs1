import { beforeEach, describe, expect, it, vi } from "vitest";
const { request, cached } = vi.hoisted(() => ({ request: vi.fn(), cached: vi.fn() }));
vi.mock("@/lib/api/http", () => ({
  apiRequest: request,
  ApiClientError: class extends Error { constructor(message: string, public status: number, public data: unknown) { super(message); } },
}));
vi.mock("@/lib/offline/db", () => ({ offlineDB: { getSetting: cached } }));
import { findPartsForVehicle, listFitments } from "@/features/verticals/auto-parts/fitment/api";
beforeEach(() => { request.mockReset(); cached.mockReset(); });
describe("vehicle year validation before network or cached matching", () => {
  it.each(["abc", "2024.5", "205", "2101", " "])("rejects invalid year %s", async (year) => {
    await expect(findPartsForVehicle({ make: "Maruti", year })).rejects.toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
    expect(cached).not.toHaveBeenCalled();
  });
  it("keeps inclusive year boundaries in offline matching", async () => {
    request.mockRejectedValue(new Error("offline"));
    cached.mockResolvedValue([{ productId: "part", productName: "Filter", make: "Maruti", model: "Swift", yearFrom: 2020, yearTo: 2026 }]);
    expect(await findPartsForVehicle({ make: "Maruti", year: 2019 })).toHaveLength(0);
    expect(await findPartsForVehicle({ make: "Maruti", year: 2020 })).toMatchObject([{ stockKnown: false, inCatalogue: false }]);
    expect(await findPartsForVehicle({ make: "Maruti", year: 2026 })).toHaveLength(1);
    expect(await findPartsForVehicle({ make: "Maruti", year: 2027 })).toHaveLength(0);
  });
});

describe("offline fitment book filters", () => {
  it("preserves make, model and search filters when using the cached register", async () => {
    request.mockRejectedValue(new Error("offline"));
    cached.mockResolvedValue([
      { id: "yes", productName: "Oil Filter", make: "Maruti", model: "Swift", variant: "Diesel" },
      { id: "other-model", productName: "Oil Filter", make: "Maruti", model: "Dzire" },
      { id: "other-make", productName: "Oil Filter", make: "Suzuki", model: "Swift" },
      { id: "other-part", productName: "Brake Pad", make: "Maruti", model: "Swift" },
    ]);
    expect(await listFitments({ make: "maruti", model: "swift", search: "filter" })).toMatchObject([{ id: "yes" }]);
    expect(await listFitments({ search: "nothing" })).toEqual([]);
  });
});
