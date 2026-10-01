import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Expense } from "@/types/api";

const mocks = vi.hoisted(() => ({ rows: vi.fn(), setting: vi.fn() }));
vi.mock("@/lib/offline/db", () => ({
  offlineDB: { getAll: mocks.rows, getSetting: mocks.setting },
  filterRowsForCurrentScope: (rows: { tenant_id?: string }[]) => rows.filter((row) => row.tenant_id !== "other-shop"),
}));
vi.mock("@/features/core/sync/local-data-hardening", () => ({ hardenLocalFinancialData: async () => undefined }));
import { aggregateFinancialRows, buildFinancialAggregationSnapshot } from "@/features/core/finance/services/FinancialAggregationService";

const date = "2026-09-27";
function expense(overrides: Partial<Expense> & Record<string, unknown> = {}): Expense & Record<string, unknown> {
  return { id: "cash", title: "Carry bags", amount: 5, category: "general", paymentMode: "cash", status: "paid",
    recurringInterval: "none", spentAt: `${date}T00:00:00`, ...overrides } as Expense & Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.mockResolvedValue([]);
  mocks.setting.mockResolvedValue(null);
  vi.stubEnv("TZ", "Asia/Kolkata");
});
afterEach(() => vi.unstubAllEnvs());

describe("dashboard expenses and cash drawer", () => {
  it("shows every recorded expense but removes only paid cash from the drawer", () => {
    const snapshot = aggregateFinancialRows({ date, openingCash: 100, expenses: [
      expense(), expense({ id: "digital", amount: 20, paymentMode: "upi" }),
      expense({ id: "unpaid", amount: 30, status: "pending" }),
    ] });
    expect(snapshot.expensesToday).toBe(55);
    expect(snapshot.cashDrawer.expenses).toBe(5);
    expect(snapshot.cashDrawer.expectedClosingCash).toBe(95);
  });

  it("uses the local spending day rather than the creation day or UTC date", () => {
    const snapshot = aggregateFinancialRows({ date, expenses: [
      expense({ spentAt: "2026-09-26T18:30:00.000Z", createdAt: "2026-09-28T12:00:00.000Z" }),
      expense({ id: "yesterday", amount: 99, spentAt: "2026-09-26T18:29:59.999Z" }),
      expense({ id: "invalid", amount: 99, spentAt: "invalid" }),
      expense({ id: "deleted", amount: 99, deletedAt: "2026-09-27T12:00:00Z" }),
      expense({ id: "local-delete", amount: 99, deleted_at: "2026-09-27T12:00:00Z" }),
    ] });
    expect(snapshot.expensesToday).toBe(5);
    expect(snapshot.cashDrawer.expenses).toBe(5);
  });

  it("lets closing's authoritative cash total replace the cached total without double counting", () => {
    const snapshot = aggregateFinancialRows({ date, expenses: [expense()], cashExpenses: 7 });
    expect(snapshot.expensesToday).toBe(5);
    expect(snapshot.cashDrawer.expenses).toBe(7);
  });

  it("loads scoped saved expenses and the opening float into the dashboard snapshot", async () => {
    mocks.rows.mockImplementation(async (table: string) => table === "expenses"
      ? [expense(), expense({ id: "foreign", amount: 999, tenant_id: "other-shop" })] : []);
    mocks.setting.mockImplementation(async (key: string) => key === "kirana:opening-float:v1"
      ? [{ date, amount: 100, at: `${date}T08:00:00` }] : []);
    const snapshot = await buildFinancialAggregationSnapshot(date);
    expect(snapshot.expensesToday).toBe(5);
    expect(snapshot.cashDrawer.openingCash).toBe(100);
    expect(snapshot.cashDrawer.expectedClosingCash).toBe(95);
    expect(snapshot.hasLocalData).toBe(true);
  });

  it("does not report zero expenses when their saved rows cannot be read", async () => {
    mocks.rows.mockImplementation(async (table: string) => {
      if (table === "expenses") throw new Error("expense storage unavailable");
      return [];
    });
    await expect(buildFinancialAggregationSnapshot(date)).rejects.toThrow("expense storage unavailable");
  });
});
