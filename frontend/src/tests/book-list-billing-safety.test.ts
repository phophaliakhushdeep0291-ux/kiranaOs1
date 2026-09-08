import { beforeEach, expect, it, vi } from "vitest";
import type { BookList, Product } from "@/types/api";

const storage = vi.hoisted(() => ({ values: new Map<string, unknown>(), failDraftWrite: false }));
vi.mock("@/lib/offline/db", () => ({ offlineDB: {
  getSetting: async (key: string) => structuredClone(storage.values.get(key) ?? null),
  transaction: async (_stores: string[], work: (tx: { setSetting: (key: string, value: unknown) => Promise<void> }) => Promise<unknown>) => {
    const before = structuredClone(storage.values);
    try {
      return await work({ setSetting: async (key, value) => {
        if (storage.failDraftWrite && key.includes("billing-draft")) throw new Error("Storage full");
        storage.values.set(key, structuredClone(value));
      } });
    } catch (error) { storage.values = before; throw error; }
  },
} }));

import { openBookListInBilling } from "@/features/verticals/stationery-books/book-lists/service/open-list-in-billing";
import { BILLING_DRAFT_KEY, HELD_BILLS_KEY, MAX_OPEN_BILLS } from "@/features/core/billing/pages/open-bills";

const product = { id: "notebook", name: "Notebook", defaultPricePerRateUnit: 20, displayUnit: "piece" } as Product;
const list = { label: "Class 6", items: [{ productId: product.id, name: product.name, qty: 2 }] } as BookList;
const current = { activeBillId: "existing-sale", cart: [{ product, quantity: 1, rate: 20, unit: "piece" }] };

beforeEach(() => {
  storage.values = new Map([[BILLING_DRAFT_KEY, structuredClone(current)], [HELD_BILLS_KEY, []]]);
  storage.failDraftWrite = false;
});

it("opens the complete set while preserving the sale already at the counter", async () => {
  const result = await openBookListInBilling(list, [product]);
  expect(result.bill.cart[0].quantity).toBe(2);
  const held = storage.values.get(HELD_BILLS_KEY) as Array<{ id: string }>;
  expect(held.map((bill) => bill.id)).toEqual([result.bill.id, current.activeBillId]);
  expect(storage.values.get(BILLING_DRAFT_KEY)).toMatchObject({ activeBillId: result.bill.id });
});

it("rolls back parking when saving the new draft fails", async () => {
  storage.failDraftWrite = true;
  await expect(openBookListInBilling(list, [product])).rejects.toThrow("Storage full");
  expect(storage.values.get(BILLING_DRAFT_KEY)).toEqual(current);
  expect(storage.values.get(HELD_BILLS_KEY)).toEqual([]);
});

it("never silently evicts an open sale when the counter is full", async () => {
  const held = Array.from({ length: MAX_OPEN_BILLS }, (_, index) => ({ id: `held-${index}`, cart: current.cart }));
  storage.values.set(HELD_BILLS_KEY, held);
  await expect(openBookListInBilling(list, [product])).rejects.toThrow("Finish or close");
  expect(storage.values.get(HELD_BILLS_KEY)).toEqual(held);
  expect(storage.values.get(BILLING_DRAFT_KEY)).toEqual(current);
});

it("keeps the current bill when no requested books resolve to products", async () => {
  await expect(openBookListInBilling(list, [])).rejects.toThrow("None of this list's products");
  expect(storage.values.get(BILLING_DRAFT_KEY)).toEqual(current);
  expect(storage.values.get(HELD_BILLS_KEY)).toEqual([]);
});
