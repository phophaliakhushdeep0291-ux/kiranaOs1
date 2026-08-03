import { describe, it, expect } from "vitest";
import {
  billFromImportedCart,
  billingDraftFromHeldBill,
  heldBillFromBillingDraft,
  importedCartFingerprint,
} from "@/features/core/billing/pages/open-bills";
import type { Product } from "@/lib/api/client";

const products = [
  { id: "p1", name: "Tata Salt", defaultPricePerRateUnit: 28, rateUnit: "packet" },
  { id: "p2", name: "Aashirvaad Atta", defaultPricePerRateUnit: 255, displayUnit: "bag" },
] as unknown as Product[];

describe("billFromImportedCart", () => {
  it("matches scanned items to live products and skips unknown ids", () => {
    const { bill, matched, skipped } = billFromImportedCart(
      products,
      [
        { productId: "p1", qty: 2 },
        { productId: "p2", qty: 1 },
        { productId: "ghost", qty: 5 },
      ],
      { label: "QR order" },
    );

    expect(matched).toBe(2);
    expect(skipped).toEqual(["ghost"]);
    expect(bill.cart).toHaveLength(2);
    expect(bill.label).toBe("QR order");
    expect(bill.selectedCustomerId).toBe("walk_in");
    expect(bill.id).toBeTruthy();
  });

  it("takes rate/unit from the live product (customer snapshot is only a request)", () => {
    const { bill } = billFromImportedCart(products, [
      { productId: "p1", qty: 2 },
      { productId: "p2", qty: 1 },
    ]);

    expect(bill.cart[0]).toMatchObject({ quantity: 2, rate: 28, unit: "packet" });
    expect(bill.cart[0].product.id).toBe("p1");
    expect(bill.cart[1]).toMatchObject({ quantity: 1, rate: 255, unit: "bag" });
  });

  it("matches an online order's server product id to an offline-local catalog product", () => {
    const transitioningCatalog = [
      {
        id: "local-p1",
        server_id: "server-p1",
        name: "Tata Salt",
        defaultPricePerRateUnit: 28,
        rateUnit: "packet",
      },
    ] as unknown as Product[];

    const { bill, matched, skipped } = billFromImportedCart(
      transitioningCatalog,
      [{ productId: "server-p1", qty: 4 }],
      { sourceOrderId: "order-1" },
    );

    expect(matched).toBe(1);
    expect(skipped).toEqual([]);
    expect(bill.cart[0]).toMatchObject({ quantity: 4, rate: 28 });
    expect(bill.cart[0].product.id).toBe("local-p1");
    expect(bill.sourceOrderFingerprint).toBe(importedCartFingerprint([{ productId: "server-p1", qty: 4 }]));
  });

  it("uses a canonical item-and-quantity fingerprint and keeps it through draft parking", () => {
    const left = importedCartFingerprint([
      { productId: "p2", qty: 1 },
      { productId: "p1", qty: 2 },
      { productId: "p1", qty: 0.5 },
    ]);
    const right = importedCartFingerprint([
      { productId: "p1", qty: 2.5 },
      { productId: "p2", qty: 1 },
    ]);
    expect(left).toBe(right);
    expect(left).not.toBe(importedCartFingerprint([{ productId: "p1", qty: 1 }, { productId: "p2", qty: 1 }]));

    const { bill } = billFromImportedCart(products, [{ productId: "p1", qty: 2 }], { sourceOrderId: "order-2" });
    const draft = billingDraftFromHeldBill(bill);
    expect(draft.sourceOrderFingerprint).toBe(bill.sourceOrderFingerprint);
    expect(heldBillFromBillingDraft(draft)?.sourceOrderFingerprint).toBe(bill.sourceOrderFingerprint);
  });

  it("produces an empty cart (all skipped) when nothing matches — e.g. a different shop's code", () => {
    const { bill, matched, skipped } = billFromImportedCart(products, [{ productId: "other-shop-p9", qty: 3 }]);
    expect(matched).toBe(0);
    expect(skipped).toEqual(["other-shop-p9"]);
    expect(bill.cart).toHaveLength(0);
  });
});
