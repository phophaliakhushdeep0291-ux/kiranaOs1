import { describe, expect, it } from "vitest";
import type { Product } from "@/types/api";
import { inventoryPackUnitCost, inventoryStockRows } from "@/features/core/inventory/stock-display";
import { sellingUnitMaxPrice } from "@/features/core/products/pages/product-pricing";

/**
 * "When I add different size of packet of same product it should show different in
 * inventory / stock in / stock out, because each has its own stock qty."
 *
 * Inventory screens used to render ONE row per product using the default pack, so a
 * shop that stocked 40 packets and 0 boxes read as "in stock" with a single number
 * that answered neither "how many boxes?" nor "which size do I reorder?".
 */

const maggi = {
  id: "p_maggi",
  name: "Maggi Noodles",
  baseUnit: "g",
  rateUnit: "piece",
  displayUnit: "piece",
  packagingMode: "per_pack",
  stockBaseQty: 2800,
  averageCostPrice: 11,
  sellingUnits: [
    { id: "su_pkt", name: "70 g packet", unitType: "packet", unitCode: "pkt70", conversionToBase: 70, defaultPrice: 14, costPrice: 11, onHandQty: 40, lowStockThreshold: 12, isDefault: true, isActive: true },
    { id: "su_box", name: "8-pack box", unitType: "box", unitCode: "box8", conversionToBase: 560, defaultPrice: 108, onHandQty: 0, lowStockThreshold: 3, isDefault: false, isActive: true },
    { id: "su_crate", name: "24-pack crate", unitType: "carton", unitCode: "crate24", conversionToBase: 1680, defaultPrice: 320, onHandQty: 2, lowStockThreshold: 4, isDefault: false, isActive: true },
  ],
} as unknown as Product;

const rice = {
  id: "p_rice",
  name: "Loose Rice",
  baseUnit: "g",
  rateUnit: "kg",
  displayUnit: "kg",
  packagingMode: "pooled",
  stockBaseQty: 25_000,
  averageCostPrice: 46,
  lowStockThreshold: 5000,
  sellingUnits: [
    { id: "su_kg", name: "kg", unitType: "kg", unitCode: "kg", conversionToBase: 1000, defaultPrice: 58, isDefault: true, isActive: true },
    { id: "su_bag", name: "5 kg bag", unitType: "bag", unitCode: "bag5", conversionToBase: 5000, defaultPrice: 280, isDefault: false, isActive: true },
  ],
} as unknown as Product;

describe("inventory rows per pack size", () => {
  it("gives every size its own row, quantity and status", () => {
    const rows = inventoryStockRows(maggi);

    expect(rows.map((row) => row.label)).toEqual(["70 g packet", "8-pack box", "24-pack crate"]);
    expect(rows.map((row) => row.quantity)).toEqual([40, 0, 2]);
    // Each size is judged against its OWN alert level: healthy, out, low.
    expect(rows.map((row) => `${row.isOut ? "out" : row.isLow ? "low" : "in"}`)).toEqual(["in", "out", "low"]);
    // Rows must be individually addressable or Stock In/Out cannot preselect a size.
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
    expect(rows[1].unitCode).toBe("box8");
  });

  it("keeps a pooled product as a single row", () => {
    // 1 kg and a 5 kg bag come out of the same sack: splitting them would show the
    // same stock twice and double the shop's stock value.
    const rows = inventoryStockRows(rice);

    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(25);
    expect(rows[0].unit).toBeUndefined();
    expect(rows[0].isLow).toBe(false);
  });

  it("values a bigger pack at a bigger cost", () => {
    // The product's average cost is per DEFAULT pack. Valuing a 24-pack crate at the
    // 70 g packet's ₹11 undercounts stock value 24-fold.
    expect(inventoryPackUnitCost(maggi, maggi.sellingUnits?.[0])).toBe(11);
    expect(inventoryPackUnitCost(maggi, maggi.sellingUnits?.[1])).toBe(88);
    expect(inventoryPackUnitCost(maggi, maggi.sellingUnits?.[2])).toBe(264);

    const rows = inventoryStockRows(maggi);
    expect(rows[2].value).toBe(528); // 2 crates x ₹264
  });

  it("does not treat an untracked product as out of stock", () => {
    const untracked = { ...maggi, stockTrackingEnabled: false } as unknown as Product;
    expect(inventoryStockRows(untracked).every((row) => !row.isOut && !row.isLow)).toBe(true);
  });
});

describe("price ceiling per pack size", () => {
  it("scales the product MRP to the pack being sold", () => {
    // The shopkeeper's report: "when I add various packaging their value do not
    // exceed the MRP of the other packet." A 5 kg bag was capped at the 1 kg MRP.
    const product = { ...rice, mrp: 60 } as unknown as Product;
    const [kg, bag] = product.sellingUnits ?? [];

    expect(sellingUnitMaxPrice(kg, product, kg)).toBe(60);
    expect(sellingUnitMaxPrice(bag, product, kg)).toBe(300);
  });

  it("prefers the pack's own MRP and leaves an MRP-less product uncapped", () => {
    const product = { ...rice, mrp: 60 } as unknown as Product;
    const [kg, bag] = product.sellingUnits ?? [];

    expect(sellingUnitMaxPrice({ ...bag, maximumPrice: 275 }, product, kg)).toBe(275);
    expect(sellingUnitMaxPrice(bag, { ...product, mrp: 0 } as unknown as Product, kg)).toBe(0);
  });
});
