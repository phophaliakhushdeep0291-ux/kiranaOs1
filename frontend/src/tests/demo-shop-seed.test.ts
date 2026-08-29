import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  settings: {} as Record<string, unknown>,
  failOn: null as string | null,
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getSetting: vi.fn(async (k: string) => state.settings[k] ?? null),
    setSetting: vi.fn(async (k: string, v: unknown) => { state.settings[k] = v; }),
    putMany: vi.fn(async (table: string, values: unknown[]) => {
      if (state.failOn === table) throw new Error(`write to ${table} failed`);
      state.tables[table] = [...(state.tables[table] ?? []), ...values];
    }),
    put: vi.fn(async (table: string, value: unknown) => {
      state.tables[table] = [...(state.tables[table] ?? []), value];
    }),
    getAll: vi.fn(async (table: string) => state.tables[table] ?? []),
    delete: vi.fn(async () => {}),
  },
}));

import { seedDemoShopData } from "@/features/core/demo/demo-shop-data";

/**
 * The demo button is often the first thing an evaluating buyer presses. If it
 * does nothing, the honest reading is that the product does nothing.
 */
describe("loading the demo shop", () => {
  beforeEach(() => {
    state.tables = {};
    state.settings = {};
    state.failOn = null;
    vi.clearAllMocks();
  });

  it("writes a catalogue the dashboard can actually show", async () => {
    const result = await seedDemoShopData();
    expect(result.created).toBe(true);
    expect((state.tables.products ?? []).length).toBeGreaterThan(0);
  });

  it("marks itself done only after the data is in", async () => {
    await seedDemoShopData();
    expect(state.settings["demo:shop-data:v1"]).toBeTruthy();
  });

  it("does not claim success when the write fails", async () => {
    // A half-seeded shop that reports "loaded" is worse than one that reports
    // nothing: the flag would suppress every later attempt.
    state.failOn = "products";
    await expect(seedDemoShopData()).rejects.toThrow();
    expect(state.settings["demo:shop-data:v1"]).toBeFalsy();
  });

  it("speaks the shop's own trade", async () => {
    // Offering a cafe owner "Aashirvaad Atta 5kg" as their sample menu says the
    // software was built for a different shop and nobody thought about theirs.
    await seedDemoShopData("restaurant");
    const names = (state.tables.products as Array<Record<string, unknown>>).map((p) => p.name);
    expect(names).toContain("Paneer Butter Masala");
    expect(names.join(" ")).not.toMatch(/Atta|Basmati|Tata Tea/);
    const units = (state.tables.products as Array<Record<string, unknown>>).map((p) => p.rateUnit);
    expect(units).toContain("plate");
  });

  it("renames the bill lines with the dishes, not just the catalogue", async () => {
    await seedDemoShopData("restaurant");
    const items = (state.tables.bill_items as Array<Record<string, unknown>>).map((i) => i.name);
    expect(items).toContain("Paneer Butter Masala");
    expect(items.join(" ")).not.toMatch(/Atta|Basmati/);
  });

  it("leaves the money exactly where it was", async () => {
    // Renaming may not move a total. Every bill, payment and ledger row is
    // written against these ids and adds up to these prices, so the selling
    // price is the one thing the trade must not change.
    await seedDemoShopData("restaurant");
    const restaurant = (state.tables.bill_items as Array<Record<string, unknown>>)
      .reduce((sum, i) => sum + Number(i.line_total ?? 0), 0);
    state.tables = {}; state.settings = {};
    await seedDemoShopData();
    const kirana = (state.tables.bill_items as Array<Record<string, unknown>>)
      .reduce((sum, i) => sum + Number(i.line_total ?? 0), 0);
    expect(restaurant).toBe(kirana);
  });

  it("leaves a trade it has no catalogue for exactly as it was", async () => {
    await seedDemoShopData("pharmacy");
    const names = (state.tables.products as Array<Record<string, unknown>>).map((p) => p.name);
    expect(names).toContain("Aashirvaad Atta 5kg");
  });

  it("is a no-op the second time rather than doubling the catalogue", async () => {
    await seedDemoShopData();
    const after = (state.tables.products ?? []).length;
    const again = await seedDemoShopData();
    expect(again.created).toBe(false);
    expect((state.tables.products ?? []).length).toBe(after);
  });
});
