import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ tables: {} as Record<string, Array<Record<string, unknown>>>, settings: {} as Record<string, unknown> }));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (t: string) => (store.tables[t] ?? []).map((r) => ({ ...r }))),
    putMany: vi.fn(async (t: string, rows: Array<Record<string, unknown>>) => {
      const existing = store.tables[t] ?? [];
      const byId = new Map(existing.map((row) => [String(row.id), row]));
      rows.forEach((row) => byId.set(String(row.id), { ...row }));
      store.tables[t] = [...byId.values()];
    }),
    delete: vi.fn(async (t: string, id: string) => { store.tables[t] = (store.tables[t] ?? []).filter((r) => r.id !== id); }),
    getSetting: vi.fn(async (k: string) => store.settings[k] ?? null),
    setSetting: vi.fn(async (k: string, v: unknown) => { store.settings[k] = v; }),
  },
}));

import { clearDemoShopData, hasDemoData, seedDemoShopData } from "@/features/demo/demo-shop-data";

beforeEach(() => {
  store.tables = {
    products: [
      { id: "demo_product_atta", name: "Atta", demo_data: true },
      { id: "demo_product_rice", name: "Rice", demo_data: true },
      { id: "real_prod_1", name: "My Real Product" }, // user's own — must survive
    ],
    bills: [{ id: "demo_bill_today", demo_data: true }],
    customers: [{ id: "demo_customer_ramesh", demo_data: true }],
    bill_items: [{ id: "demo_item_atta", demo_data: true }],
    payments: [], customer_ledger: [], inventory_movements: [], suppliers: [{ id: "demo_supplier_wholesale", demo_data: true }],
  };
  store.settings = { "demo:shop-data:v1": { seededAt: "2026-06-20T00:00:00.000Z" } };
});

describe("demo shop data", () => {
  it("detects demo data when present", async () => {
    expect(await hasDemoData()).toBe(true);
  });

  it("clearDemoShopData removes only demo rows and keeps real data", async () => {
    const { removed } = await clearDemoShopData();
    expect(removed).toBeGreaterThan(0);
    // real product survives
    expect(store.tables.products).toEqual([{ id: "real_prod_1", name: "My Real Product" }]);
    // demo rows gone everywhere
    expect(store.tables.bills).toHaveLength(0);
    expect(store.tables.customers).toHaveLength(0);
    expect(store.tables.bill_items).toHaveLength(0);
    expect(store.tables.suppliers).toHaveLength(0);
    // seed guard reset so demo can be loaded again later
    expect(store.settings["demo:shop-data:v1"]).toBeNull();
    expect(await hasDemoData()).toBe(false);
  });

  it("seeds a financially balanced demo bill", async () => {
    store.tables = {};
    store.settings = {};

    await seedDemoShopData();

    const bill = store.tables.bills[0];
    const items = store.tables.bill_items;
    const payments = store.tables.payments;
    const itemTotal = items.reduce((sum, item) => sum + Number(item.line_total ?? 0), 0);
    const itemProfit = items.reduce((sum, item) => sum + (Number(item.ratePerRateUnit ?? 0) - Number(item.costPerRateUnit ?? 0)) * Number(item.quantity ?? 0), 0);
    const tenderTotal = payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);

    expect(itemTotal).toBe(Number(bill.grandTotal));
    expect(itemProfit).toBe(Number(bill.grossProfit));
    expect(tenderTotal + Number(bill.creditAmount)).toBe(Number(bill.grandTotal));
  });
});
