import { describe, expect, it } from "vitest";
import {
  MAX_CELLS,
  buildVariantCells,
  canReorderAxes,
  cellKeysForAxes,
  droppedVariantCells,
  normalizeAxisValues,
  normalizeAxes,
  totalGridQty,
  variantCellCode,
  variantCellName,
  variantCellsToSellingUnits,
} from "@/features/core/products/pages/variant-grid";
import { formToInput, productToForm } from "@/features/core/products/pages/product-form-state";
import type { Product, ProductSellingUnit } from "@/types/api";

/**
 * The size × colour grid.
 *
 * What it replaces is a shopkeeper hand-typing one Product per size and colour.
 * The rule that makes it worth having is that editing a garment must not reset
 * what is on the shelf — so most of this is about cells being matched back to
 * the rows they came from.
 */

function unit(overrides: Partial<ProductSellingUnit> = {}): ProductSellingUnit {
  return {
    name: "L / Blue",
    unitType: "piece",
    unitCode: "l-blue",
    conversionToBase: 1,
    defaultPrice: 350,
    onHandQty: 4,
    variantValue1: "L",
    variantValue2: "Blue",
    isDefault: true,
    isActive: true,
    ...overrides,
  };
}

describe("variant cell identity", () => {
  it("derives a stable code from the axis values", () => {
    expect(variantCellCode("L", "Blue")).toBe("l-blue");
    expect(variantCellCode("XL")).toBe("xl");
    // Adding a size later must not renumber the rows and hand L's stock to M,
    // which is exactly what a counter-derived code would do.
    expect(variantCellCode("M", "White")).toBe("m-white");
  });

  it("keeps codes distinct when the values are punctuation", () => {
    // "★" and "☆" both slug to nothing, and two rows sharing the empty string
    // would collide on the server's upsert key.
    expect(variantCellCode("★", "☆")).toBe("v-w");
    expect(variantCellCode("UK 8")).toBe("uk-8");
    expect(variantCellCode("  L  ", " Blue ")).toBe("l-blue");
  });

  it("reads a cell out the way a counter says it", () => {
    expect(variantCellName("L", "Blue")).toBe("L / Blue");
    expect(variantCellName("L")).toBe("L");
    expect(variantCellName("L", null)).toBe("L");
  });
});

describe("axis values", () => {
  it("drops blanks and case-insensitive repeats", () => {
    expect(normalizeAxisValues(["S", " M ", "", "s", "L"])).toEqual(["S", "M", "L"]);
  });

  it("throws away an axis that describes nothing", () => {
    // An unnamed axis or one with no values would tag every row with a position
    // that does not exist.
    expect(normalizeAxes([{ name: "", values: ["S"] }])).toEqual([]);
    expect(normalizeAxes([{ name: "Size", values: [] }])).toEqual([]);
    expect(normalizeAxes([{ name: "Size", values: ["S", "M"] }])).toEqual([{ name: "Size", values: ["S", "M"] }]);
  });

  it("never keeps more than two axes", () => {
    const axes = normalizeAxes([
      { name: "Size", values: ["S"] },
      { name: "Colour", values: ["Blue"] },
      { name: "Fit", values: ["Slim"] },
    ]);
    expect(axes).toHaveLength(2);
  });
});

describe("the grid the axes describe", () => {
  it("is the cartesian product, in reading order", () => {
    const keys = cellKeysForAxes([
      { name: "Size", values: ["S", "M"] },
      { name: "Colour", values: ["Blue", "White"] },
    ]);
    expect(keys.map((k) => `${k.value1}/${k.value2}`)).toEqual(["S/Blue", "S/White", "M/Blue", "M/White"]);
  });

  it("is a plain list when there is one axis", () => {
    const keys = cellKeysForAxes([{ name: "Size", values: ["S", "M", "L"] }]);
    expect(keys).toEqual([
      { value1: "S", value2: null },
      { value1: "M", value2: null },
      { value1: "L", value2: null },
    ]);
  });

  it("is empty when nothing is declared", () => {
    expect(cellKeysForAxes([])).toEqual([]);
  });
});

describe("carrying existing rows across an edit", () => {
  const axes = [{ name: "Size", values: ["S", "M", "L"] }];
  const existing = [
    unit({ unitCode: "s", name: "S", variantValue1: "S", variantValue2: null, onHandQty: 2, defaultPrice: 340, id: "u_s" }),
    unit({ unitCode: "m", name: "M", variantValue1: "M", variantValue2: null, onHandQty: 5, defaultPrice: 350, id: "u_m" }),
  ];

  it("keeps stock, price and the database id on a cell that already existed", () => {
    const cells = buildVariantCells(axes, existing, { price: 999 });
    const m = cells.find((cell) => cell.value1 === "M");
    expect(m?.qty).toBe(5);
    expect(m?.price).toBe(350);
    expect(m?.id).toBe("u_m");
  });

  it("starts a genuinely new cell empty, at the fallback price", () => {
    const cells = buildVariantCells(axes, existing, { price: 999 });
    const l = cells.find((cell) => cell.value1 === "L");
    expect(l?.qty).toBe(0);
    expect(l?.price).toBe(999);
    expect(l?.id).toBeUndefined();
  });

  it("does not reset the other sizes when one is added", () => {
    // The failure this guards: a shop adds XL in March and finds every other
    // size back at zero.
    const widened = buildVariantCells([{ name: "Size", values: ["S", "M", "L", "XL"] }], existing, { price: 999 });
    expect(widened.find((cell) => cell.value1 === "S")?.qty).toBe(2);
    expect(widened.find((cell) => cell.value1 === "M")?.qty).toBe(5);
    expect(totalGridQty(widened)).toBe(7);
  });

  it("matches a cell whatever case the value was typed in", () => {
    const cells = buildVariantCells([{ name: "Size", values: ["m"] }], existing, { price: 999 });
    expect(cells[0].qty).toBe(5);
  });

  it("never inherits a barcode onto a new cell", () => {
    // A barcode belongs to one physical SKU; two sizes sharing one would scan
    // as each other at the till.
    const cells = buildVariantCells(axes, [unit({ barcode: "890123", variantValue1: "S", variantValue2: null })], { price: 1 });
    expect(cells.find((cell) => cell.value1 === "S")?.barcode).toBe("890123");
    expect(cells.find((cell) => cell.value1 === "L")?.barcode).toBeNull();
  });

  it("ignores packaging rows, which sit on no axis", () => {
    const packaging = unit({ unitCode: "pkt70", name: "70 g packet", variantValue1: null, variantValue2: null, onHandQty: 12 });
    const cells = buildVariantCells(axes, [packaging], { price: 100 });
    expect(cells.every((cell) => cell.qty === 0)).toBe(true);
  });

  it("caps a runaway grid rather than sending an oversized payload", () => {
    const huge = buildVariantCells(
      [
        { name: "Size", values: Array.from({ length: 20 }, (_, i) => `S${i}`) },
        { name: "Colour", values: Array.from({ length: 20 }, (_, i) => `C${i}`) },
      ],
      [],
      { price: 10 },
    );
    expect(huge).toHaveLength(MAX_CELLS);
  });
});

describe("what removing a value costs", () => {
  const existing = [
    unit({ unitCode: "s", variantValue1: "S", variantValue2: null, onHandQty: 2, name: "S" }),
    unit({ unitCode: "xl", variantValue1: "XL", variantValue2: null, onHandQty: 7, name: "XL" }),
  ];

  it("names the rows that fall out of the grid, and what they hold", () => {
    const dropped = droppedVariantCells([{ name: "Size", values: ["S"] }], existing);
    expect(dropped).toEqual([{ name: "XL", qty: 7 }]);
  });

  it("reports nothing when every row is still described", () => {
    expect(droppedVariantCells([{ name: "Size", values: ["S", "XL"] }], existing)).toEqual([]);
  });
});

describe("the baseline is what is saved, not what is being typed", () => {
  // Both of these were live bugs. The editor first asked these questions of the
  // form's current selling units — which it rewrites on every keystroke — so a
  // brand-new product claimed it "already has stock", and a row being dropped
  // had already been replaced before it could be named. The answer is that only
  // what is on the books can be locked or at risk, so only that is asked.
  const saved = [
    unit({ unitCode: "s", variantValue1: "S", variantValue2: null, onHandQty: 2, name: "S" }),
    unit({ unitCode: "l", variantValue1: "L", variantValue2: null, onHandQty: 4, name: "L" }),
  ];

  it("does not lock a product that has nothing saved yet", () => {
    // The live grid is full of tagged rows the moment a size is typed; none of
    // them is saved, so nothing is at risk of being remapped.
    const liveEdit = [unit({ variantValue1: "S", variantValue2: null })];
    expect(canReorderAxes(liveEdit)).toBe(false);
    expect(canReorderAxes([])).toBe(true);
  });

  it("still names a dropped row after the live grid has moved on", () => {
    const nextAxes = [{ name: "Size", values: ["S"] }];
    // What the form now holds: L is already gone from it.
    const liveEdit = [unit({ unitCode: "s", variantValue1: "S", variantValue2: null, onHandQty: 2, name: "S" })];

    expect(droppedVariantCells(nextAxes, liveEdit)).toEqual([]);
    expect(droppedVariantCells(nextAxes, saved)).toEqual([{ name: "L", qty: 4 }]);
  });
});

describe("axis order, once stock is against it", () => {
  it("is free while nothing is tagged", () => {
    expect(canReorderAxes([])).toBe(true);
    expect(canReorderAxes([unit({ variantValue1: null, variantValue2: null })])).toBe(true);
  });

  it("is locked as soon as one row carries a position", () => {
    // variantValue1 is the value on axes[0]. Swapping the axes would move every
    // L-Blue shirt's stock onto a Blue-L cell without anything visibly breaking.
    expect(canReorderAxes([unit()])).toBe(false);
  });
});

describe("the grid as selling units", () => {
  const cells = buildVariantCells(
    [{ name: "Size", values: ["S", "M"] }, { name: "Colour", values: ["Blue"] }],
    [unit({ unitCode: "m-blue", variantValue1: "M", variantValue2: "Blue", onHandQty: 3 })],
    { price: 350 },
  );

  it("tags every row with where it sits", () => {
    const units = variantCellsToSellingUnits(cells, { unitType: "piece" });
    expect(units.map((u) => [u.variantValue1, u.variantValue2])).toEqual([["S", "Blue"], ["M", "Blue"]]);
  });

  it("gives each row its own stock and no pack conversion", () => {
    const units = variantCellsToSellingUnits(cells, { unitType: "piece" });
    // A size is not a pack size: one M shirt is one piece.
    expect(units.every((u) => u.conversionToBase === 1 && u.packSizeValue === null)).toBe(true);
    expect(units.find((u) => u.variantValue1 === "M")?.onHandQty).toBe(3);
  });

  it("points the default at a size that is actually in stock", () => {
    // The product's headline price and unit are read off the default row. One
    // pointing at an empty size would make a shirt read as unavailable while
    // five other sizes sit on the shelf.
    const units = variantCellsToSellingUnits(cells, { unitType: "piece" });
    expect(units.filter((u) => u.isDefault)).toHaveLength(1);
    expect(units.find((u) => u.isDefault)?.variantValue1).toBe("M");
  });

  it("still marks one default when the whole grid is empty", () => {
    const empty = buildVariantCells([{ name: "Size", values: ["S", "M"] }], [], { price: 100 });
    const units = variantCellsToSellingUnits(empty, { unitType: "piece" });
    expect(units.filter((u) => u.isDefault)).toHaveLength(1);
  });
});

describe("round-tripping through the product form", () => {
  const shirt: Product = {
    id: "p_1",
    name: "Cotton Shirt",
    defaultPricePerRateUnit: 350,
    packagingMode: "per_pack",
    variantAxes: [{ name: "Size", values: ["S", "M"] }],
    sellingUnits: [
      unit({ unitCode: "s", name: "S", variantValue1: "S", variantValue2: null, onHandQty: 2, isDefault: false }),
      unit({ unitCode: "m", name: "M", variantValue1: "M", variantValue2: null, onHandQty: 5, isDefault: true }),
    ],
  };

  it("loads the axes off the product", () => {
    expect(productToForm(shirt).variantAxes).toEqual([{ name: "Size", values: ["S", "M"] }]);
  });

  it("sends the axes back, and the grid as the selling units", () => {
    const input = formToInput(productToForm(shirt));
    expect(input.variantAxes).toEqual([{ name: "Size", values: ["S", "M"] }]);
    // The failure this guards: the form synthesising a sizeless default pack
    // and putting it on the shelf next to the grid, where billing would sell it.
    expect(input.sellingUnits?.every((u) => u.variantValue1)).toBe(true);
    expect(input.sellingUnits).toHaveLength(2);
  });

  it("totals the product's stock from the cells", () => {
    const input = formToInput(productToForm(shirt));
    expect(input.stockBaseQty).toBe(7);
    expect(input.stockQuantity).toBe(7);
  });

  it("forces per-row counting, because pooled sizes would share one number", () => {
    const pooled = productToForm({ ...shirt, packagingMode: "pooled" });
    expect(formToInput(pooled).packagingMode).toBe("per_pack");
  });

  it("leaves an ordinary product exactly as it was", () => {
    const rice: Product = { id: "p_2", name: "Loose Rice", defaultPricePerRateUnit: 58, isLooseItem: true };
    const input = formToInput(productToForm(rice));
    expect(input.variantAxes).toEqual([]);
    expect(input.packagingMode).toBe("pooled");
    // A kirana product still gets its one synthesised selling unit.
    expect(input.sellingUnits).toHaveLength(1);
    expect(input.sellingUnits?.[0].isDefault).toBe(true);
  });
});
