import { describe, expect, it } from "vitest";
import { tradeOrderLine } from "@/features/verticals/manufacturing/trade-order-line";
import type { Product } from "@/types/api";
const product = { id: "finished", name: "Spice", baseUnit: "piece", packagingMode: "per_pack", sellingUnits: [{ id: "carton", name: "Carton", conversionToBase: 5, isActive: true }] } as Product;
describe("wholesale packaging entry", () => {
  it("keeps packaging identity, counts, base quantity and per-pack price", () => {
    expect(tradeOrderLine(product, "carton", "2", "25.50")).toEqual({ productId: "finished", sellingUnitId: "carton", description: "Spice", unitName: "Carton", quantity: 2, quantityBaseQty: 10, unitPrice: 25.5 });
  });
  it("rejects missing and unavailable packaging for separately counted packs", () => {
    expect(tradeOrderLine(product, "", "2", "20")).toBeNull();
    expect(tradeOrderLine(product, "missing", "2", "20")).toBeNull();
    expect(tradeOrderLine({ ...product, sellingUnits: [] }, "carton", "2", "20")).toBeNull();
  });
  it.each(["", "NaN", "0", "-1", "0.001", "1000000000"])("rejects invalid or over-limit converted quantity %s", (quantity) => {
    expect(tradeOrderLine(product, "carton", quantity, "20")).toBeNull();
  });
  it.each(["", "Infinity", "-1", "1.001"])("rejects invalid price %s", (price) => {
    expect(tradeOrderLine(product, "carton", "2", price)).toBeNull();
  });
});
