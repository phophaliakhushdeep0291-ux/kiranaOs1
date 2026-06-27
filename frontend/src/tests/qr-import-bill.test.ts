import { describe, it, expect } from "vitest";
import { billFromImportedCart } from "@/features/billing/pages/open-bills";
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

  it("produces an empty cart (all skipped) when nothing matches — e.g. a different shop's code", () => {
    const { bill, matched, skipped } = billFromImportedCart(products, [{ productId: "other-shop-p9", qty: 3 }]);
    expect(matched).toBe(0);
    expect(skipped).toEqual(["other-shop-p9"]);
    expect(bill.cart).toHaveLength(0);
  });
});
