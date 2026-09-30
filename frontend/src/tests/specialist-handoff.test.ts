import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/api/client";
import type { BillingDraft, HeldBill } from "@/features/core/billing/pages/billing-types";
import { mergeCartProduct, type CartLinePricer } from "@/features/core/billing/cart-product";

/**
 * A register entry asking the till to bill it.
 *
 * Two things have to hold, and they pull in opposite directions. The hand-off
 * is durable — an interrupted navigation must neither lose the bill nor start
 * it twice, and the customer already at the counter must not find their cart
 * replaced by somebody else's prescription. And it can never stop the till:
 * billing runs it before loading its own draft, so a request that fails the
 * same way on every visit would leave a shop unable to open billing at all.
 *
 * That second one happened. A prescription written in a unit the catalogue does
 * not sell threw inside the transaction; the transaction rolled back, the
 * request stayed queued, and the billing screen showed "Could not recover the
 * billing draft" with a retry that could only fail again.
 */

const memory = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  tail: Promise.resolve() as Promise<unknown>,
  failWrite: "",
}));

// One settings table, with the transaction semantics the real one has: writes
// inside a failed transaction are undone, and transactions run one at a time.
vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getSetting: async (key: string) => structuredClone(memory.rows.get(key)),
    transaction: async (_stores: string[], work: (tx: { setSetting: (key: string, value: unknown) => Promise<void> }) => Promise<unknown>) => {
      const result = memory.tail.then(async () => {
        const before = structuredClone(memory.rows);
        try {
          return await work({
            setSetting: async (key, value) => {
              if (key === memory.failWrite) throw Error("Write failed");
              memory.rows.set(key, structuredClone(value));
            },
          });
        } catch (error) {
          memory.rows = before;
          throw error;
        }
      });
      memory.tail = result.catch(() => undefined);
      return result;
    },
  },
}));

import {
  SPECIALIST_HANDOFF_KEY, SpecialistHandoffError, queueSpecialistBill, recoverSpecialistBill,
  type SpecialistHandoff,
} from "@/features/core/billing/specialist-handoff";
import { BILLING_DRAFT_KEY, HELD_BILLS_KEY } from "@/features/core/billing/pages/open-bills";
import type { QueuedProductMerger } from "@/features/core/billing/pending-cart-additions";

const medicine = { id: "azee", name: "Azee 500", defaultPricePerRateUnit: 100, baseUnit: "piece", rateUnit: "piece", sellingUnits: [] } as unknown as Product;
const catalogue = (...products: Product[]) => new Map(products.map((product) => [product.id, product]));

// The bill a walk-in customer is in the middle of when the register entry arrives.
const inProgress: BillingDraft = {
  activeBillId: "existing",
  customerName: "Previous buyer",
  billingSlotValues: { prescriptionId: { id: "rx-old" } },
  cart: [{ product: medicine, quantity: 1, unit: "piece", rate: 100 }],
};
const request: SpecialistHandoff = {
  source: "rx:1",
  customerName: "New patient",
  billingSlotValues: { prescriptionId: { id: "rx-1" } },
  items: [{ productId: "azee", quantity: 2, unit: "piece", name: "Azee 500" }],
};

const price: CartLinePricer = () => ({ rate: 100, pricing: { originalUnitPrice: 100, explanation: "Normal", appliedRuleType: "BASE", requiresApproval: false, confidence: 1 } });
const merge: QueuedProductMerger = (cart, item, _draft, options) => mergeCartProduct(cart, item, price, options);
const recover = (products = catalogue(medicine), merger = merge) => recoverSpecialistBill(products, merger, () => true);

const draft = () => memory.rows.get(BILLING_DRAFT_KEY) as BillingDraft;
const parked = () => (memory.rows.get(HELD_BILLS_KEY) ?? []) as HeldBill[];
const waiting = () => memory.rows.get(SPECIALIST_HANDOFF_KEY);

beforeEach(() => {
  memory.rows = new Map([[BILLING_DRAFT_KEY, structuredClone(inProgress)]]);
  memory.tail = Promise.resolve();
  memory.failWrite = "";
});

describe("starting the bill", () => {
  it("parks the customer already at the counter, with their own attachment, and opens the patient's bill once", async () => {
    await queueSpecialistBill(request);
    // Two billing mounts racing — React's double effect, or a second tab.
    const outcomes = await Promise.all([recover(), recover()]);

    expect(draft()).toMatchObject({ handoffSource: "rx:1", customerName: "New patient", billingSlotValues: request.billingSlotValues, cart: [{ quantity: 2 }] });
    expect(parked()).toMatchObject([{ customerName: "Previous buyer", billingSlotValues: inProgress.billingSlotValues }]);
    expect(waiting()).toBeNull();
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });

  it("reopens the same bill when the entry is pressed again, rather than starting a second", async () => {
    await queueSpecialistBill(request);
    await recover();
    const opened = draft();

    await queueSpecialistBill(request);
    await recover();
    expect(draft()).toEqual(opened);
    expect(parked()).toHaveLength(1);
  });

  it("brings the entry's bill back from the parked list if another was opened in between", async () => {
    await queueSpecialistBill(request);
    await recover();
    // The chemist parks the patient's bill to serve someone else.
    const patientBill = draft();
    memory.rows.set(HELD_BILLS_KEY, [...parked(), { ...patientBill, id: patientBill.activeBillId, label: "New patient", createdAt: new Date().toISOString() }]);
    memory.rows.set(BILLING_DRAFT_KEY, { activeBillId: "walk-in", cart: [{ product: medicine, quantity: 1, unit: "piece", rate: 100 }] });

    await queueSpecialistBill(request);
    await recover();

    expect(draft()).toMatchObject({ activeBillId: patientBill.activeBillId, handoffSource: "rx:1", cart: [{ quantity: 2 }] });
    expect(parked().map((bill) => bill.id).sort()).toEqual(["existing", "walk-in"]);
  });

  it("bills a medicine in the pack the entry names, by its label or its code", async () => {
    const packed = {
      ...medicine,
      sellingUnits: [
        { id: "box", name: "Box", unitCode: "box10", conversionToBase: 100, isDefault: true },
        { id: "strip", name: "Strip", unitCode: "strip10", conversionToBase: 10 },
      ],
    } as unknown as Product;

    for (const unit of ["strip", " STRIP10 "]) {
      memory.rows = new Map([[BILLING_DRAFT_KEY, structuredClone(inProgress)]]);
      await queueSpecialistBill({ ...request, items: [{ productId: "azee", quantity: 2, unit }] });
      expect(await recover(catalogue(packed))).toEqual({ unlisted: [] });
      expect(draft().cart?.[0]).toMatchObject({ quantity: 2, unit: "Strip", sellingUnit: { id: "strip" } });
    }
  });

  it("names the entry's hand-typed medicines once, when the bill is first started", async () => {
    await queueSpecialistBill({ ...request, unlisted: ["Compounded syrup", "Glucose sachet"] });
    expect(await recover()).toEqual({ unlisted: ["Compounded syrup", "Glucose sachet"] });

    // Pressed again on the same entry: the bill is reopened, not announced afresh.
    await queueSpecialistBill({ ...request, unlisted: ["Compounded syrup", "Glucose sachet"] });
    expect(await recover()).toEqual({ unlisted: [] });
  });

  it("does nothing, and says nothing, when no entry is waiting", async () => {
    expect(await recover()).toBeNull();
    expect(draft()).toEqual(inProgress);
  });
});

describe("a request that cannot be honoured is dropped and explained — never left to block the till", () => {
  async function refused(items: SpecialistHandoff["items"], products = catalogue(medicine), merger = merge) {
    await queueSpecialistBill({ ...request, items });
    const outcome = await recover(products, merger);
    // The customer at the counter keeps their bill, and the request is gone, so
    // the NEXT time billing opens it opens.
    expect(draft()).toEqual(inProgress);
    expect(parked()).toEqual([]);
    expect(waiting()).toBeNull();
    expect(await recover(products, merger)).toBeNull();
    return outcome?.rejected;
  }

  it("when the entry is in a unit the catalogue does not sell the medicine in", async () => {
    expect(await refused([{ productId: "azee", quantity: 2, unit: "strip", name: "Azee 500" }])).toEqual({
      key: "workflow.register.handoff.unitMismatch",
      vars: { name: "Azee 500", unit: "strip" },
    });
  });

  it("when the entry names a base unit and the shop sells only packs — a box is not handed over against a slip for a strip", async () => {
    const packed = { ...medicine, sellingUnits: [{ id: "box", name: "Box", unitCode: "box", conversionToBase: 10, isDefault: true }] } as unknown as Product;
    const rejected = await refused([{ productId: "azee", quantity: 2, unit: "piece" }], catalogue(packed));
    expect(rejected?.key).toBe("workflow.register.handoff.unitMismatch");
  });

  it("when a medicine on it has left the catalogue", async () => {
    expect(await refused([{ productId: "gone", quantity: 1, name: "Old brand" }])).toEqual({
      key: "workflow.register.handoff.productMissing",
      vars: { name: "Old brand" },
    });
  });

  it("when billing has to ask about the product first", async () => {
    const needsOptions: QueuedProductMerger = () => null;
    const rejected = await refused([{ productId: "azee", quantity: 1 }], catalogue(medicine), needsOptions);
    expect(rejected).toEqual({ key: "workflow.register.handoff.needsConfiguration", vars: { name: "Azee 500" } });
  });

  it("when ten bills are already parked and there is nowhere to put the one in progress", async () => {
    const full = Array.from({ length: 10 }, (_, index) => ({ ...inProgress, id: String(index), label: `Bill ${index}`, createdAt: new Date().toISOString() }));
    memory.rows.set(HELD_BILLS_KEY, full);
    await queueSpecialistBill(request);

    expect((await recover())?.rejected).toEqual({ key: "workflow.register.handoff.openBillLimit" });
    // Nothing was evicted to make room, and billing opens so one can be closed.
    expect(parked()).toHaveLength(10);
    expect(draft()).toEqual(inProgress);
    expect(waiting()).toBeNull();
  });
});

describe("what is NOT a reason to drop it", () => {
  it.each([BILLING_DRAFT_KEY, HELD_BILLS_KEY, SPECIALIST_HANDOFF_KEY])("a storage failure writing %s rolls everything back and keeps the request", async (key) => {
    await queueSpecialistBill(request);
    memory.failWrite = key;

    await expect(recover()).rejects.toThrow();
    expect(draft()).toEqual(inProgress);
    expect(waiting()).toEqual(request);

    // The retry screen's retry is worth pressing: once storage works, so does this.
    memory.failWrite = "";
    expect(await recover()).toEqual({ unlisted: [] });
  });

  it("a catalogue that has not loaded — it cannot establish that a product was removed", async () => {
    await queueSpecialistBill(request);
    expect(await recover(new Map())).toBeNull();
    expect(waiting()).toEqual(request);
    expect(draft()).toEqual(inProgress);
  });

  it("a billing screen that was closed before the hand-off finished", async () => {
    await queueSpecialistBill(request);
    let mounted = true;
    const cancelled = recoverSpecialistBill(catalogue(medicine), (cart, item, d, options) => { mounted = false; return merge(cart, item, d, options); }, () => mounted);

    await expect(cancelled).rejects.toThrow("cancelled");
    expect(draft()).toEqual(inProgress);
    expect(waiting()).toEqual(request);
  });
});

describe("asking for a bill from the register", () => {
  it("refuses while a different entry is still waiting, in words the screen can translate", async () => {
    await queueSpecialistBill(request);
    const other = queueSpecialistBill({ ...request, source: "rx:2" });

    await expect(other).rejects.toBeInstanceOf(SpecialistHandoffError);
    await expect(other).rejects.toMatchObject({ notice: { key: "workflow.register.handoff.pending" } });
    expect(waiting()).toEqual(request);
  });

  it("lets the same entry be asked for again — it may have been corrected in between", async () => {
    await queueSpecialistBill({ ...request, items: [{ productId: "azee", quantity: 2, unit: "strip" }] });
    await queueSpecialistBill(request);
    expect(waiting()).toEqual(request);
  });

  it("has nothing to bill for an entry with no catalogue product on it", async () => {
    for (const items of [[], [{ productId: "", quantity: 1 }], [{ productId: "azee", quantity: 0 }]]) {
      await expect(queueSpecialistBill({ ...request, items })).rejects.toMatchObject({ notice: { key: "workflow.register.handoff.nothingToBill" } });
    }
    expect(waiting()).toBeUndefined();
  });
});
