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

import { queueSpecialistBill, recoverSpecialistBill, SPECIALIST_HANDOFF_KEY } from "@/features/core/billing/specialist-handoff";
import { BILLING_DRAFT_KEY, HELD_BILLS_KEY } from "@/features/core/billing/pages/open-bills";
import { prepareUnitBillItems } from "@/features/verticals/electronics/units/billing-selection";
import type { QueuedProductMerger } from "@/features/core/billing/pending-cart-additions";
const product = { id: "phone", name: "Phone", defaultPricePerRateUnit: 100, baseUnit: "piece", rateUnit: "piece", sellingUnits: [] } as unknown as Product;
const products = new Map([[product.id, product]]);
const initial: BillingDraft = { activeBillId: "existing", customerName: "Previous buyer", billingSlotValues: { prescriptionId: { id: "rx-old" } }, cart: [{ product, quantity: 1, unit: "piece", rate: 100 }] };
const request = { source: "rx:1", customerName: "New patient", billingSlotValues: { prescriptionId: { id: "rx-1" } }, items: [{ productId: "phone", quantity: 2, unit: "piece" }] };
const price: CartLinePricer = () => ({ rate: 100, pricing: { originalUnitPrice: 100, explanation: "Normal", appliedRuleType: "BASE", requiresApproval: false, confidence: 1 } });
const merge: QueuedProductMerger = (cart, item, _draft, options) => mergeCartProduct(cart, item, price, options);
const recover = () => recoverSpecialistBill(products, merge, () => true);
beforeEach(() => { memory.rows = new Map([[BILLING_DRAFT_KEY, structuredClone(initial)]]); memory.tail = Promise.resolve(); memory.failRead = ""; memory.failWrite = ""; memory.afterWrite = null; });
it("parks the old customer and their attachment, then recovers a new patient exactly once", async () => {
  await queueSpecialistBill(request); await Promise.all([recover(), recover()]);
  const draft = memory.rows.get(BILLING_DRAFT_KEY) as BillingDraft;
  expect(draft).toMatchObject({ customerName: "New patient", billingSlotValues: request.billingSlotValues, cart: [{ quantity: 2 }] });
  expect(memory.rows.get(HELD_BILLS_KEY)).toMatchObject([{ customerName: "Previous buyer", billingSlotValues: initial.billingSlotValues }]);
  await queueSpecialistBill(request); await recover();
  expect(memory.rows.get(BILLING_DRAFT_KEY)).toEqual(draft);
});
it.each([BILLING_DRAFT_KEY, HELD_BILLS_KEY, SPECIALIST_HANDOFF_KEY])("rolls back the full handoff when %s cannot be saved", async key => {
  await queueSpecialistBill(request); memory.failWrite = key;
  await expect(recover()).rejects.toThrow();
  expect(memory.rows.get(BILLING_DRAFT_KEY)).toEqual(initial);
  expect(memory.rows.get(SPECIALIST_HANDOFF_KEY)).toEqual(request);
});
it("does not silently change prescription units or drop unknown products", async () => {
  await queueSpecialistBill({ ...request, items: [{ productId: "phone", quantity: 2, unit: "strip" }] });
  await expect(recover()).rejects.toThrow("unit");
  expect(memory.rows.get(BILLING_DRAFT_KEY)).toEqual(initial);
  await queueSpecialistBill({ ...request, items: [{ productId: "missing", quantity: 1 }] });
  await expect(recover()).rejects.toThrow("missing");
});
it("refuses to evict ten parked bills and retains the handoff", async () => {
  memory.rows.set(HELD_BILLS_KEY, Array.from({ length: 10 }, (_, i) => ({ ...initial, id: String(i) })));
  await queueSpecialistBill(request); await expect(recover()).rejects.toThrow("open bill");
  expect(memory.rows.get(BILLING_DRAFT_KEY)).toEqual(initial);
});
it("splits serials into returnable bill lines without losing a paise of discount", () => {
  const items = prepareUnitBillItems([{ productId: "phone", name: "Phone", quantity: 3, enteredUnit: "piece", ratePerRateUnit: 100, lineDiscount: 1 }],
    [1, 2, 3].map(id => ({ id: String(id), productId: "phone", label: String(id) })));
  expect(items.map(item => item.trackedUnitId)).toEqual(["1", "2", "3"]);
  expect(items.map(item => item.quantity)).toEqual([1, 1, 1]);
  expect(items.map(item => item.lineDiscount)).toEqual([0.34, 0.33, 0.33]);
});

it("does not substitute a default pack for a prescribed base unit", async () => {
  const packed = { ...product, sellingUnits: [{ id: "pack", name: "Box", unitCode: "box", conversionToBase: 10, isDefault: true }] } as Product;
  await queueSpecialistBill(request);
  await expect(recoverSpecialistBill(new Map([[packed.id, packed]]), merge, () => true)).rejects.toThrow("selling unit");
  expect(memory.rows.get(BILLING_DRAFT_KEY)).toEqual(initial);
});
