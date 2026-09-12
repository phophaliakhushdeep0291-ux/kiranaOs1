import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ setting: vi.fn(), rows: vi.fn(), write: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/offline/db", () => ({ offlineDB: { getSetting: mocks.setting, getAll: mocks.rows, setSetting: mocks.write, transaction: mocks.transaction } }));
vi.mock("@/features/core/reports/api", () => ({ getDailyClosingDrawerCounts: async () => [] }));
import { loadDrawerAdjustments, saveOpeningFloat, saveCashMovement, removeCashMovement } from "@/features/core/reports/cash-drawer";
import { loadDrawerCounts, saveDrawerCount, refreshDrawerCountsFromCloud } from "@/features/core/reports/drawer-counts";

beforeEach(() => { vi.clearAllMocks(); mocks.setting.mockResolvedValue(null); mocks.rows.mockResolvedValue([]); });
describe("drawer read failures protect history and totals", () => {
  it("does not treat an unreadable float/movement setting as a zero drawer", async () => {
    mocks.setting.mockRejectedValue(Error("unreadable settings"));
    await expect(loadDrawerAdjustments("2026-09-09")).rejects.toThrow("unreadable settings");
    await expect(loadDrawerCounts()).rejects.toThrow("unreadable settings");
    mocks.setting.mockResolvedValue(null);
    await expect(loadDrawerAdjustments("2026-09-09")).resolves.toEqual({ openingCash: 0, cashIn: 0, cashOut: 0 });
  });
  it("never overwrites existing history after a failed read", async () => {
    mocks.setting.mockRejectedValue(Error("unreadable settings"));
    await expect(saveOpeningFloat({ date: "2026-09-09", amount: 100 } as never)).rejects.toThrow();
    await expect(saveCashMovement({ id: "move", date: "2026-09-09", amount: 10 } as never)).rejects.toThrow();
    await expect(removeCashMovement("move")).rejects.toThrow();
    await expect(saveDrawerCount({ date: "2026-09-09" } as never)).rejects.toThrow();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("cannot overwrite a pending local count if the outbox cannot be checked", async () => {
    mocks.rows.mockRejectedValue(Error("outbox unavailable"));
    await expect(refreshDrawerCountsFromCloud()).rejects.toThrow("outbox unavailable");
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
