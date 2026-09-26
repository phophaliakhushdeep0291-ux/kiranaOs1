import { beforeEach, expect, it, vi } from "vitest";
import type { Product } from "@/lib/api/client";
import type { BillingDraft } from "@/features/core/billing/pages/billing-types";
import { mergeCartProduct, type CartLinePricer } from "@/features/core/billing/cart-product";

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
import { PENDING_CART_KEY, queueProductsForBilling, recoverQueuedBillingDraft } from "@/features/core/billing/pending-cart-additions";

const draftKey = "draft";
const product = { id: "filter", name: "Oil filter", defaultPricePerRateUnit: 100, baseUnit: "piece", rateUnit: "piece", sellingUnits: [] } as unknown as Product;
const products = new Map([[product.id, product]]);
const part = { productId: product.id, name: product.name };
const initial: BillingDraft = { activeBillId: "existing-bill", tableId: "table-1", customerName: "Asha", selectedCustomerId: "customer-1", paymentMode: "upi", discount: 5, cart: [{ product, quantity: 1, unit: "piece", rate: 100, note: "Keep this note" }] };
const price: CartLinePricer = (_product, quantity, unit) => ({ rate: quantity >= 3 ? 90 : unit?.defaultPrice ?? 100, pricing: { explanation: "Quantity price", appliedRuleType: "TEST", originalUnitPrice: 100, requiresApproval: false, confidence: 1 } });
const merge = (cart: NonNullable<BillingDraft["cart"]>, item: Product) => mergeCartProduct(cart, item, price);
const recover = (active?: () => boolean) => recoverQueuedBillingDraft(draftKey, products, merge, active);

beforeEach(() => { memory.rows = new Map([[draftKey, structuredClone(initial)]]); memory.tail = Promise.resolve(); memory.failRead = ""; memory.failWrite = ""; memory.afterWrite = null; });

it("recovers a committed handoff after losing the UI acknowledgement, without adding it twice", async () => {
  await queueProductsForBilling([part]);
  await recover(); // The page closes before React receives this result.
  const next = await recover();
  expect(next?.added).toBe(0);
  expect(next?.draft.cart?.[0]).toMatchObject({ quantity: 2, rate: 100, note: "Keep this note" });
  expect(next?.draft).toMatchObject({ activeBillId: "existing-bill", tableId: "table-1", customerName: "Asha", selectedCustomerId: "customer-1", paymentMode: "upi", discount: 5 });
});

it.each([draftKey, PENDING_CART_KEY])("rolls back cart and queue when writing %s fails, then retries once", async key => {
  await queueProductsForBilling([part]); memory.failWrite = key;
  await expect(recover()).rejects.toThrow("Write failed");
  expect(memory.rows.get(draftKey)).toEqual(initial);
  expect(memory.rows.get(PENDING_CART_KEY)).toEqual([part]);
  memory.failWrite = "";
  expect((await recover())?.draft.cart?.[0].quantity).toBe(2);
  expect((await recover())?.added).toBe(0);
});

it.each([draftKey, PENDING_CART_KEY])("retains saved work after a %s read failure", async key => {
  await queueProductsForBilling([part]); const before = structuredClone(memory.rows); memory.failRead = key;
  await expect(recover()).rejects.toThrow("Read failed");
  expect(memory.rows).toEqual(before);
});

it("serializes concurrent recoveries so only one caller adds the part", async () => {
  await queueProductsForBilling([part]);
  const results = await Promise.all([recover(), recover()]);
  expect(results.map(result => result?.added).sort()).toEqual([0, 1]);
  expect(results.every(result => result?.draft.cart?.[0].quantity === 2)).toBe(true);
});

it("preserves a second handoff queued while the first is being recovered", async () => {
  await queueProductsForBilling([part]);
  await Promise.all([recover(), queueProductsForBilling([part])]);
  const next = await recover();
  expect(next?.draft.cart?.[0]).toMatchObject({ quantity: 3, rate: 90 });
  expect(next?.added).toBe(1);
});

it("leaves the queue untouched when navigation cancels before recovery", async () => {
  await queueProductsForBilling([part]);
  expect(await recover(() => false)).toBeNull();
  expect(memory.rows.get(draftKey)).toEqual(initial);
  expect(memory.rows.get(PENDING_CART_KEY)).toEqual([part]);
});

it("rolls back navigation cancelled between the draft and queue writes", async () => {
  await queueProductsForBilling([part]); let active = true;
  memory.afterWrite = key => { if (key === draftKey) active = false; };
  await expect(recover(() => active)).rejects.toThrow("cancelled");
  expect(memory.rows.get(draftKey)).toEqual(initial);
  expect(memory.rows.get(PENDING_CART_KEY)).toEqual([part]);
});

it("keeps a part queued if pricing cannot finish", async () => {
  await queueProductsForBilling([part]);
  await expect(recoverQueuedBillingDraft(draftKey, products, () => { throw Error("Price unavailable"); })).rejects.toThrow("Price unavailable");
  expect(memory.rows.get(draftKey)).toEqual(initial);
  expect(memory.rows.get(PENDING_CART_KEY)).toEqual([part]);
});

it("reports missing catalogue items and does not repeatedly add or announce them", async () => {
  await queueProductsForBilling([part, { productId: "removed", name: "Removed part" }]);
  const result = await recover();
  expect(result?.missing).toEqual(["Removed part"]);
  expect(result?.draft.cart?.[0].quantity).toBe(2);
  expect((await recover())?.missing).toEqual([]);
});

it("passes the saved customer and payment fields to billing's pricing callback", async () => {
  await queueProductsForBilling([part]);
  const callback = vi.fn(merge);
  await recoverQueuedBillingDraft(draftKey, products, callback);
  expect(callback).toHaveBeenCalledWith(initial.cart, product, initial);
});

it("preserves a manual price while accumulating the same product", () => {
  const cart = [{ ...initial.cart![0], manualRate: true, rate: 73 }];
  expect(mergeCartProduct(cart, product, price)[0]).toMatchObject({ quantity: 2, rate: 73, manualRate: true });
  expect(cart[0].quantity).toBe(1);
});

it("keeps different packs and batches separate while using the default active pack", () => {
  const small = { id: "small", name: "Single", unitCode: "piece", defaultPrice: 100, isDefault: true, isActive: true };
  const box = { id: "box", name: "Box", unitCode: "box", defaultPrice: 900, isActive: true };
  const packed = { ...product, sellingUnits: [small, box] } as unknown as Product;
  const cart = [
    { ...initial.cart![0], product: packed, unit: "Box", sellingUnit: packed.sellingUnits![1] },
    { ...initial.cart![0], product: packed, unit: "Single", sellingUnit: packed.sellingUnits![0], batch: { id: "chosen-lot" } },
  ] as NonNullable<BillingDraft["cart"]>;
  const result = mergeCartProduct(cart, packed, price);
  expect(result).toHaveLength(3);
  expect(result.at(-1)).toMatchObject({ quantity: 1, rate: 100, sellingUnit: { id: "small" } });
  expect(result.slice(0, 2)).toEqual(cart);
});

it("retains products that need configuration instead of silently billing a default choice", async () => {
  await queueProductsForBilling([part]);
  const result = await recoverQueuedBillingDraft(draftKey, products, () => null);
  expect(result).toMatchObject({ draft: initial, added: 0, remaining: 1 });
  expect(memory.rows.get(PENDING_CART_KEY)).toEqual([part]);
});

it("preserves a handoff while the catalogue is unavailable, then recovers it once", async () => {
  await queueProductsForBilling([part]);
  const unavailable = await recoverQueuedBillingDraft(draftKey, new Map(), merge);
  expect(unavailable).toMatchObject({ draft: initial, added: 0, missing: [], remaining: 1 });
  expect(memory.rows.get(PENDING_CART_KEY)).toEqual([part]);
  expect((await recover())?.draft.cart?.[0].quantity).toBe(2);
  expect((await recover())?.added).toBe(0);
});
