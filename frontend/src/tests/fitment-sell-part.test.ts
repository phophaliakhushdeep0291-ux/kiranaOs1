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

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getSetting: vi.fn(async (key: string) => (settings.has(key) ? settings.get(key) : null)),
    setSetting: vi.fn(async (key: string, value: unknown) => { settings.set(key, value); }),
    delete: vi.fn(async (_store: string, key: string) => { settings.delete(key); }),
  },
}));

const { PENDING_CART_KEY, queueProductsForBilling, takeQueuedProducts } =
  await import("@/features/core/billing/pending-cart-additions");

beforeEach(() => settings.clear());

describe("the hand-off queue", () => {
  it("carries a part over and hands it back once", async () => {
    await queueProductsForBilling([{ productId: "p-clutch", name: "Clutch plate 575 DI" }]);
    expect(await takeQueuedProducts()).toEqual([{ productId: "p-clutch", name: "Clutch plate 575 DI" }]);
    // Once. A part must land on the bill the counter walked over to, not on
    // every bill after it.
    expect(await takeQueuedProducts()).toEqual([]);
    expect(settings.has(PENDING_CART_KEY)).toBe(false);
  });

  it("appends, so a second part does not drop the first", async () => {
    await queueProductsForBilling([{ productId: "p-1", name: "Oil filter" }]);
    await queueProductsForBilling([{ productId: "p-2", name: "Air filter" }]);
    expect((await takeQueuedProducts()).map((row) => row.productId)).toEqual(["p-1", "p-2"]);
  });

  it("ignores rows with nothing to look up", async () => {
    await queueProductsForBilling([
      { productId: "", name: "blank" },
      { productId: "p-3", name: "Brake shoe" },
    ] as never);
    expect((await takeQueuedProducts()).map((row) => row.productId)).toEqual(["p-3"]);
  });

  it("survives a storage that will not read", async () => {
    // A queue is a convenience. It must never be the reason a till cannot bill.
    settings.set(PENDING_CART_KEY, "not an array");
    expect(await takeQueuedProducts()).toEqual([]);
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
    expect(billing).toContain("const product = productById.get(entry.productId);");
    expect(billing).toContain("if (product) addToCart(product);");
  });

  it("waits for the cart it is joining", () => {
    // Landing before the draft restores would put the line on a workspace that
    // is about to be overwritten; landing before the catalogue loads would give
    // addToCart nothing to price.
    expect(billing).toContain("if (!draftHydrated || productById.size === 0) return;");
  });

  it("says so when the part is not in the loaded catalogue", () => {
    expect(billing).toContain('t("billing.pending.notFound")');
    expect(billing).toContain("missing.push(entry.name || entry.productId)");
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
