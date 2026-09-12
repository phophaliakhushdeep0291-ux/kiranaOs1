import { describe, expect, it } from "vitest";
import { convertLooseMode, formToInput, productToForm } from "@/features/core/products/pages/product-form-state";
import type { Product, ProductInput } from "@/lib/api/client";

/**
 * Turning a packed product into a loose one, and back.
 *
 * This is the switch a grocer reaches for when the 1 kg atta packets run out and
 * the sack behind the counter starts being weighed out instead. It used to write
 * `isLooseItem` and nothing else, which produced a product the server will not
 * accept: still typed "packet", with the pack size dropped on the way out. The
 * save came back 400 and the shop saw the toggle snap back to Packed — the bug
 * reported as "it gets stuck and does not change".
 *
 * The two things asserted here are the two things that were wrong: the payload has
 * to be one the server takes, and the shelf has to hold still while the label on it
 * changes.
 */

/** The server's rule, mirrored: normalizeSellingUnits() in products.service.js. */
const PACK_UNITS = ["packet", "pack", "pouch"];
function serverWouldReject(payload: ProductInput): string | null {
  for (const unit of payload.sellingUnits ?? []) {
    const unitType = String(unit.unitType ?? "").trim().toLowerCase();
    if (!PACK_UNITS.includes(unitType)) continue;
    if (!(Number(unit.packSizeValue) > 0) || !unit.packSizeUnit) {
      return `Packet and pouch units require a pack size and measurement unit (${unit.unitCode})`;
    }
  }
  return null;
}

/** 10 packets of 1 kg atta on the shelf — 10,000 g of it. */
function packedAtta(): Product {
  return {
    id: "p1",
    name: "Ashirvaad Atta",
    unit: "packet",
    baseUnit: "gram",
    isLooseItem: false,
    packagingMode: "pooled",
    stockBaseQty: 10_000,
    lowStockThreshold: 2_000,
    sellingPrice: 280,
    mrp: 300,
    sellingUnits: [{
      id: "su1",
      name: "packet 1 kg",
      unitType: "packet",
      unitCode: "packet-1-kg",
      packSizeValue: 1,
      packSizeUnit: "kg",
      conversionToBase: 1000,
      defaultPrice: 280,
      isDefault: true,
      isActive: true,
    }],
  } as unknown as Product;
}

describe("switching a product between packed and loose", () => {
  it("sends a payload the server accepts, instead of a packet with no size", () => {
    const packed = productToForm(packedAtta());

    // What the toggle used to do: the flag on its own.
    const flagOnly = formToInput({ ...packed, isLooseItem: true });
    expect(serverWouldReject(flagOnly)).toMatch(/require a pack size/);

    // What it does now.
    const loose = formToInput({ ...packed, ...convertLooseMode(packed, true) });
    expect(serverWouldReject(loose)).toBeNull();
    expect(loose.isLooseItem).toBe(true);
  });

  it("keeps the shelf still: 10 packets of 1 kg becomes 10 kg, not 10 grams", () => {
    const packed = productToForm(packedAtta());
    const switched = convertLooseMode(packed, true);

    // Sold by the measure the pack was described in, so the base unit cannot move.
    expect(switched.unit).toBe("kg");
    expect(switched.stockQuantity).toBe(10);

    const loose = formToInput({ ...packed, ...switched });
    expect(loose.baseUnit).toBe("gram");
    expect(loose.stockBaseQty).toBe(10_000);
    // The reorder level is quoted in the same units and has to move with them.
    expect(loose.lowStockThreshold).toBe(2_000);
  });

  it("gives the pack back unchanged when the shop switches to loose and back", () => {
    // A 5 kg bag, so a lost pack size would show up as a 1 kg one.
    const bag = packedAtta();
    bag.stockBaseQty = 20_000;
    bag.sellingUnits![0] = {
      ...bag.sellingUnits![0], name: "packet 5 kg", unitCode: "packet-5-kg", packSizeValue: 5, conversionToBase: 5000,
    };
    const packed = productToForm(bag);
    expect(packed.stockQuantity).toBe(4);

    const loose = { ...packed, ...convertLooseMode(packed, true) };
    expect(loose.unit).toBe("kg");
    expect(loose.stockQuantity).toBe(20);

    const back = { ...loose, ...convertLooseMode(loose, false) };
    expect(back.unit).toBe("packet");
    expect(back.packSizeValue).toBe(5);
    expect(back.packSizeUnit).toBe("kg");
    expect(back.stockQuantity).toBe(4);
    expect(formToInput(back).stockBaseQty).toBe(20_000);
  });

  it("returns a trade to a pack unit it actually sells in", () => {
    const loose = { ...productToForm(), unit: "gram", isLooseItem: true, stockQuantity: 500 };
    // A chemist counts strips, not a grocer's packets.
    expect(convertLooseMode(loose, false, "strip").unit).toBe("strip");
  });

  it("counts a box of pieces out as loose pieces", () => {
    const boxed = { ...productToForm(), unit: "box", packSizeValue: 10, packSizeUnit: "piece", stockQuantity: 3 };
    const switched = convertLooseMode(boxed, true);
    expect(switched.unit).toBe("piece");
    expect(switched.stockQuantity).toBe(30);
  });

  it("leaves everything alone when the mode is already the one asked for", () => {
    const packed = productToForm(packedAtta());
    expect(convertLooseMode(packed, false)).toMatchObject({
      isLooseItem: false, unit: "packet", packSizeValue: 1, packSizeUnit: "kg", stockQuantity: 10,
    });
  });
});
