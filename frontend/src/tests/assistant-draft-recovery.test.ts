import { beforeEach, expect, it, vi } from "vitest";
import type { Product } from "@/lib/api/client";
import type { BillingDraft } from "@/features/core/billing/pages/billing-types";
const memory = vi.hoisted(() => ({ rows: new Map<string, unknown>(), tail: Promise.resolve() as Promise<unknown>, failRead: "", failWrite: "", afterWrite: null as null | ((key: string) => void) }));
vi.mock("@/lib/offline/db", () => ({ offlineDB: {
  getSetting: async (key: string) => { if (key === memory.failRead) throw Error("Read failed"); return structuredClone(memory.rows.get(key)); },
  transaction: async (_stores: string[], work: (tx: { setSetting: (key: string, value: unknown) => Promise<void> }) => Promise<unknown>) => {
    const result = memory.tail.then(async () => {
      const before = structuredClone(memory.rows);
      try { return await work({ setSetting: async (key, value) => {
        if (key === memory.failWrite) throw Error("Write failed");
        memory.rows.set(key, structuredClone(value)); memory.afterWrite?.(key);
      } }); } catch (error) { memory.rows = before; throw error; }
    });
    memory.tail = result.catch(() => undefined); return result;
  },
} }));
import { recoverAssistantBillingDraft, stageBillLines } from "@/features/core/billing/assistant-staging";
const draftKey = "draft";
const queueKey = "kirana-os:assistant-bill-lines:v1";
const product = { id: "soap", name: "Soap", baseUnit: "piece", rateUnit: "piece", sellingUnits: [] } as unknown as Product;
const products = new Map([[product.id, product]]);
const line = { productId: product.id, name: product.name, quantity: 2, unit: "piece", rate: 50 };
const initial: BillingDraft = { activeBillId: "existing-bill", tableId: "table-1", customerName: "Asha", selectedCustomerId: "customer-1", discount: 5, cart: [{ product, quantity: 1, unit: "piece", rate: 50 }] };
beforeEach(() => { memory.rows = new Map([[draftKey, structuredClone(initial)]]); memory.tail = Promise.resolve(); memory.failRead = ""; memory.failWrite = ""; memory.afterWrite = null; });

it("recovers the committed draft after a lost UI acknowledgement without adding the same items twice", async () => {
  await stageBillLines([line]);
  await recoverAssistantBillingDraft(draftKey, products); // Simulate closing the page before React receives this result.
  const recovered = await recoverAssistantBillingDraft(draftKey, products);
  expect(recovered?.draft.cart?.[0].quantity).toBe(3);
  expect(recovered?.draft).toMatchObject({ activeBillId: "existing-bill", tableId: "table-1", customerName: "Asha", selectedCustomerId: "customer-1", discount: 5 });
  expect(recovered?.added).toBe(0);
});

it.each([draftKey, queueKey])("rolls back both records when writing %s fails", async key => {
  await stageBillLines([line]); memory.failWrite = key;
  await expect(recoverAssistantBillingDraft(draftKey, products)).rejects.toThrow("Write failed");
  expect(memory.rows.get(draftKey)).toEqual(initial);
  expect(memory.rows.get(queueKey)).toMatchObject({ lines: [line] });
  memory.failWrite = "";
  expect((await recoverAssistantBillingDraft(draftKey, products))?.draft.cart?.[0].quantity).toBe(3);
});

it.each([draftKey, queueKey])("never replaces saved work after a %s read failure", async key => {
  await stageBillLines([line]); const before = structuredClone(memory.rows); memory.failRead = key;
  await expect(recoverAssistantBillingDraft(draftKey, products)).rejects.toThrow("Read failed");
  expect(memory.rows).toEqual(before);
});

it("serializes concurrent recovery so only one caller applies the queue", async () => {
  await stageBillLines([line]);
  const results = await Promise.all([recoverAssistantBillingDraft(draftKey, products), recoverAssistantBillingDraft(draftKey, products)]);
  expect(results.map(result => result?.added).sort()).toEqual([0, 1]);
  expect(results.every(result => result?.draft.cart?.[0].quantity === 3)).toBe(true);
});

it("rolls back if navigation cancels recovery between its two writes", async () => {
  await stageBillLines([line]); let active = true;
  memory.afterWrite = key => { if (key === draftKey) active = false; };
  await expect(recoverAssistantBillingDraft(draftKey, products, () => active)).rejects.toThrow("cancelled");
  expect(memory.rows.get(draftKey)).toEqual(initial);
  expect(memory.rows.get(queueKey)).toMatchObject({ lines: [line] });
});

it("keeps unavailable products queued and consumes them once the catalogue can resolve them", async () => {
  const missing = { ...line, productId: "missing" };
  await stageBillLines([line, missing]);
  expect((await recoverAssistantBillingDraft(draftKey, products))?.remaining).toBe(1);
  expect(memory.rows.get(queueKey)).toMatchObject({ lines: [missing] });
  const expanded = new Map([...products, ["missing", { ...product, id: "missing" }]]);
  const next = await recoverAssistantBillingDraft(draftKey, expanded);
  expect(next?.draft.cart?.map(row => row.quantity)).toEqual([3, 2]);
  expect(next?.added).toBe(1); expect(next?.remaining).toBe(0);
});

it("retains ambiguous pack sizes instead of choosing the default pack", async () => {
  const packed = { ...product, sellingUnits: [{ id: "small", name: "Small bag", unitCode: "small", unitType: "pack", conversionToBase: 2, isActive: true, isDefault: true }, { id: "large", name: "Large bag", unitCode: "large", unitType: "pack", conversionToBase: 5, isActive: true }] } as unknown as Product;
  await stageBillLines([{ ...line, unit: "pack" }, { ...line, unit: "large" }]);
  const next = await recoverAssistantBillingDraft(draftKey, new Map([[packed.id, packed]]));
  expect(next?.added).toBe(1); expect(next?.remaining).toBe(1);
  expect(next?.draft.cart?.at(-1)?.sellingUnit?.id).toBe("large");
});

it("does not add an expired assistant request to a later bill", async () => {
  memory.rows.set(queueKey, { lines: [line], stagedAt: Date.now() - 31 * 60_000 });
  const next = await recoverAssistantBillingDraft(draftKey, products);
  expect(next?.draft).toEqual(initial); expect(next?.added).toBe(0);
});
