import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Getting from "what fits a Mahindra 575 DI?" to a bill.
 *
 * The parts trade's counter conversation never starts with a part number. It
 * starts with a vehicle, and the fitment book is the only thing in the shop that
 * can turn that into the right box. But the book and the till were two screens
 * with nothing between them: a counter hand found the part, left, opened
 * billing, and searched the catalogue again from memory for a name they had been
 * looking at a second earlier. On four thousand SKUs that is where the wrong box
 * gets sold — and it is the gap the pack's own doc had been carrying as "still
 * to come".
 *
 * The hand-off is deliberately thin. The book sends ids; billing rings them up
 * its own way, so pricing rules, pack units and batch ceilings stay in one
 * place rather than being reimplemented by whichever screen found the product.
 */

const LINE = String.fromCharCode(10);
const settings = new Map<string, unknown>();
let transactionTail: Promise<unknown> = Promise.resolve();

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getSetting: vi.fn(async (key: string) => (settings.has(key) ? settings.get(key) : null)),
    setSetting: vi.fn(async (key: string, value: unknown) => { settings.set(key, value); }),
    delete: vi.fn(async (_store: string, key: string) => { settings.delete(key); }),
    transaction: async (_stores: string[], work: (tx: { setSetting: (key: string, value: unknown) => Promise<void> }) => Promise<unknown>) => {
      const result = transactionTail.then(async () => {
        const previous = new Map(settings);
        try { return await work({ setSetting: async (key, value) => { await offlineDB.setSetting(key, value); } }); }
        catch (error) { settings.clear(); previous.forEach((value, key) => settings.set(key, value)); throw error; }
      });
      transactionTail = result.catch(() => undefined);
      return result;
    },
  },
}));

const { PENDING_CART_KEY, queueProductsForBilling } =
  await import("@/features/core/billing/pending-cart-additions");
const { offlineDB } = await import("@/lib/offline/db");

const readQueue = async () => (await offlineDB.getSetting<Array<{ productId: string; name: string }>>(PENDING_CART_KEY)) ?? [];

beforeEach(() => { settings.clear(); transactionTail = Promise.resolve(); vi.clearAllMocks(); });

describe("the hand-off queue", () => {
  it("keeps the part queued until billing can save it", async () => {
    const part = { productId: "p-clutch", name: "Clutch plate 575 DI" };
    await queueProductsForBilling([part]);
    expect(await readQueue()).toEqual([part]);
    expect(await readQueue()).toEqual([part]);
  });

  it("appends, so a second part does not drop the first", async () => {
    await queueProductsForBilling([{ productId: "p-1", name: "Oil filter" }]);
    await queueProductsForBilling([{ productId: "p-2", name: "Air filter" }]);
    expect((await readQueue()).map((row) => row.productId)).toEqual(["p-1", "p-2"]);
  });

  it("preserves both parts when two handoffs arrive together", async () => {
    await Promise.all([
      queueProductsForBilling([{ productId: "oil", name: "Oil filter" }]),
      queueProductsForBilling([{ productId: "air", name: "Air filter" }]),
    ]);
    expect((await readQueue()).map((row) => row.productId)).toEqual(["oil", "air"]);
  });

  it("does not overwrite the existing queue after a read failure", async () => {
    await queueProductsForBilling([{ productId: "oil", name: "Oil filter" }]);
    vi.mocked(offlineDB.getSetting).mockRejectedValueOnce(new Error("Read failed"));
    await expect(queueProductsForBilling([{ productId: "air", name: "Air filter" }])).rejects.toThrow("Read failed");
    expect(await readQueue()).toEqual([{ productId: "oil", name: "Oil filter" }]);
  });

  it("reports failed saves and allows a successful retry without duplicating the part", async () => {
    vi.mocked(offlineDB.setSetting).mockRejectedValueOnce(new Error("Storage full"));
    const part = { productId: "oil", name: "Oil filter" };
    await expect(queueProductsForBilling([part])).rejects.toThrow("Storage full");
    expect(settings.has(PENDING_CART_KEY)).toBe(false);
    await queueProductsForBilling([part]);
    expect(await readQueue()).toEqual([part]);
  });

  it("ignores rows with nothing to look up", async () => {
    await queueProductsForBilling([
      { productId: "", name: "blank" },
      { productId: "p-3", name: "Brake shoe" },
    ] as never);
    expect((await readQueue()).map((row) => row.productId)).toEqual(["p-3"]);
  });

  it("replaces a malformed old queue when a valid part is requested", async () => {
    settings.set(PENDING_CART_KEY, "not an array");
    const part = { productId: "p-3", name: "Brake shoe" };
    await queueProductsForBilling([part]);
    expect(await readQueue()).toEqual([part]);
  });

  it("stays out of the billing draft", async () => {
    // The draft is rebuilt field by field on every save, which is how a table's
    // id used to be dropped. A queue that vanishes on the next keystroke would
    // be worse than no queue.
    const draftKey = readFileSync("src/features/core/billing/pages/open-bills.ts", "utf8");
    expect(draftKey).toContain('BILLING_DRAFT_KEY = "kirana-os:billing-draft:v1"');
    expect(PENDING_CART_KEY).not.toBe("kirana-os:billing-draft:v1");
  });
});

describe("the two ends of it", () => {
  const fitment = readFileSync("src/features/verticals/auto-parts/fitment/pages/FitmentPage.tsx", "utf8");
  const billing = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");

  it("sends the part it found, then goes to the till", () => {
    expect(fitment).toContain("queueProductsForBilling([{ productId: part.productId, name: part.productName }])");
    expect(fitment).toContain('navigate("/billing")');
  });

  it("offers the action on parts the catalogue still has", () => {
    // A fitment outlives its product on purpose — the claim is reference data.
    // Selling one of those would put a name on a bill with nothing behind it.
    expect(fitment).toContain("{part.inCatalogue ? (");
    expect(fitment).toContain("fitment-sell-${part.productId}");
  });

  it("rings it up through billing's own add, not a second pricing path", () => {
    expect(billing).toContain("mergeCartProduct(cart, product,");
    expect(billing).toContain("mergeCartProduct(previous, product, resolveLine, options)");
  });

  it("waits for the cart it is joining", () => {
    // Landing before the draft restores would put the line on a workspace that
    // is about to be overwritten; landing before the catalogue loads would give
    // addToCart nothing to price.
    expect(billing).toContain("shouldWaitForBillingCatalogue(products, productById.size)");
    expect(billing).toContain("recoverQueuedBillingDraft(BILLING_DRAFT_KEY");
  });

  it("says so when the part is not in the loaded catalogue", () => {
    expect(billing).toContain('t("billing.pending.notFound")');
    expect(billing).toContain("recovery.missing.join");
  });

  it("keeps the arrow pointing one way", () => {
    // features/core may never import features/verticals. The queue is core and
    // trade-agnostic — it takes product ids and knows nothing about vehicles —
    // which is what lets the auto-parts screen reach for it.
    const queue = readFileSync("src/features/core/billing/pending-cart-additions.ts", "utf8");
    // Imports are the boundary, not prose: the doc names the trade it was built
    // for, which is the point of writing it down. What it may not do is depend
    // on one.
    const imports = queue.split(LINE).filter((line) => line.trimStart().startsWith("import "));
    expect(imports.some((line) => line.includes("features/verticals"))).toBe(false);
    expect(queue).not.toContain("FittingPart");
    expect(fitment).toContain('from "@/features/core/billing/pending-cart-additions"');
  });
});
