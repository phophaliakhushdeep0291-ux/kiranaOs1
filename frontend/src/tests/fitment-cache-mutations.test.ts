import { beforeEach, expect, it, vi } from "vitest";
const { request, getSetting, setSetting } = vi.hoisted(() => ({ request: vi.fn(), getSetting: vi.fn(), setSetting: vi.fn() }));
vi.mock("@/lib/api/http", () => ({ apiRequest: request, ApiClientError: class extends Error {} }));
vi.mock("@/lib/offline/db", () => ({ offlineDB: { getSetting, setSetting } }));
const fitment = { id: "fit-1", productId: "part-1", productName: "Filter", make: "Maruti", model: "Swift" };
let saved: unknown;
beforeEach(() => {
  vi.resetModules(); request.mockReset(); getSetting.mockReset(); setSetting.mockReset(); saved = [fitment];
  getSetting.mockImplementation(async () => saved);
  setSetting.mockImplementation(async (_key, value) => { saved = value; });
});
it("does not resurrect a removed fitment when refresh fails; a new successful list restores caching", async () => {
  const api = await import("@/features/verticals/auto-parts/fitment/api");
  request.mockResolvedValueOnce({ ...fitment, deletedAt: "2026-09-23" });
  await api.deleteFitment(fitment.id);
  expect(saved).toBeNull();
  request.mockRejectedValueOnce(new Error("offline"));
  await expect(api.findPartsForVehicle({ make: "Maruti" })).rejects.toThrow("offline");
  request.mockResolvedValueOnce([]);
  expect(await api.listFitments()).toEqual([]);
  request.mockRejectedValueOnce(new Error("offline"));
  expect(await api.findPartsForVehicle({ make: "Maruti" })).toEqual([]);
});
it("a late list response started before a removal cannot repopulate the old cache", async () => {
  const api = await import("@/features/verticals/auto-parts/fitment/api");
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const list = api.listFitments();
  request.mockResolvedValueOnce({ ...fitment, deletedAt: "2026-09-23" });
  await api.deleteFitment(fitment.id);
  finish([fitment]); await list;
  expect(saved).toBeNull();
  request.mockRejectedValueOnce(new Error("offline"));
  await expect(api.listFitments()).rejects.toThrow("offline");
});
it("a rejected edit retains the last confirmed cache", async () => {
  const api = await import("@/features/verticals/auto-parts/fitment/api");
  request.mockRejectedValueOnce(new Error("denied"));
  await expect(api.updateFitment(fitment.id, { model: "Dzire" })).rejects.toThrow("denied");
  expect(setSetting).not.toHaveBeenCalled();
  request.mockRejectedValueOnce(new Error("offline"));
  expect(await api.listFitments()).toEqual([fitment]);
});
it("storage failure cannot turn a committed removal into a failed operation or reuse stale cache", async () => {
  const api = await import("@/features/verticals/auto-parts/fitment/api");
  setSetting.mockRejectedValue(new Error("disk full"));
  request.mockResolvedValueOnce({ ...fitment, deletedAt: "2026-09-23" });
  await expect(api.deleteFitment(fitment.id)).resolves.toMatchObject({ id: fitment.id });
  request.mockRejectedValueOnce(new Error("offline"));
  await expect(api.listFitments()).rejects.toThrow("offline");
});
