import type { ProductSellingUnit, ProductVariantAxis } from "@/types/api";

/**
 * The size × colour grid, as arithmetic.
 *
 * A variant is not a new kind of row: it is a `ProductSellingUnit` tagged with
 * its position on the product's declared axes, so it already owns a barcode, a
 * price and its own stock. What this module does is turn "Size: S, M, L" and
 * "Colour: Blue, White" into the six rows that represents, and — the part that
 * matters — turn them back into the *same* six rows next time, so editing a
 * garment does not reset what is on the shelf.
 *
 * AXIS ORDER IS LOAD-BEARING. A row's `variantValue1` is its value on `axes[0]`,
 * so reordering the axes silently remaps every existing row: every L-Blue shirt
 * would become a Blue-L one and its stock would follow the wrong cell. Once a
 * product has variants the axes are append-only, which `canReorderAxes` is how
 * callers ask about.
 */

export const MAX_AXES = 2;
export const MAX_AXIS_VALUES = 50;
/** 6 sizes × 6 colours is 36 rows; the server caps the payload at 100. */
export const MAX_CELLS = 100;

export interface VariantCell {
  /** Existing row id, when this cell is already on the books. */
  id?: string;
  /** Value on axes[0], and on axes[1] when there is one. */
  value1: string;
  value2: string | null;
  unitCode: string;
  name: string;
  price: number;
  /** This cell's own stock. A variant grid always counts per row. */
  qty: number;
  /**
   * This size's own money and reorder settings.
   *
   * These used to live only on the parent product, which meant every size
   * shared one MRP and one cost — and, because the editor had nowhere to read
   * them back from, an edit wrote null over whatever a size had been saved
   * with. A size that costs more to buy (XXL fabric) or sells under a
   * different MRP is ordinary, so each cell carries its own.
   *
   * Null means "nothing set for this size". A new cell starts null and simply
   * follows the product when saved, so a shop that prices every size alike
   * never types anything here; filling one in is how a single odd size opts out.
   */
  mrp: number | null;
  costPrice: number | null;
  minimumPrice: number | null;
  lowStockThreshold: number | null;
  reorderLevel: number | null;
  barcode: string | null;
  isActive: boolean;
}

/**
 * A cell's stable code, which is also the key the server upserts on.
 *
 * Derived from the axis values rather than a counter, so adding "XL" later does
 * not renumber every row and hand L's stock to M. The fallback matters for
 * values that are punctuation or non-Latin — "★" slugs to nothing, and two of
 * those would otherwise collide on the empty string.
 */
export function variantCellCode(value1: string, value2?: string | null): string {
  const slug = (value: string, fallback: string) => {
    const cleaned = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return cleaned || fallback;
  };
  const first = slug(value1, "v");
  if (!value2) return first;
  return `${first}-${slug(value2, "w")}`;
}

/** How a cell reads on a bill and in the inventory list: "L / Blue". */
export function variantCellName(value1: string, value2?: string | null): string {
  return [value1, value2].filter(Boolean).map((part) => String(part).trim()).join(" / ");
}

/** Axis values, trimmed, with blanks and case-insensitive repeats dropped. */
export function normalizeAxisValues(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out.slice(0, MAX_AXIS_VALUES);
}

export function normalizeAxes(axes: ProductVariantAxis[]): ProductVariantAxis[] {
  return axes
    .slice(0, MAX_AXES)
    .map((axis) => ({ name: String(axis?.name ?? "").trim(), values: normalizeAxisValues(axis?.values ?? []) }))
    // An axis with no name or no values describes nothing, and sending one would
    // put every row on an axis position that does not exist.
    .filter((axis) => axis.name && axis.values.length > 0);
}

/** Whether these axes describe a usable grid. */
export function hasVariantGrid(axes: ProductVariantAxis[]): boolean {
  return normalizeAxes(axes).length > 0;
}

/**
 * Whether the axes may still be reordered or renamed freely.
 *
 * True only while nothing is tagged against them. Once a single row carries a
 * `variantValue1`, changing which axis is first would move every row's stock to
 * the wrong cell without anything visibly breaking.
 */
export function canReorderAxes(units: ProductSellingUnit[]): boolean {
  return !units.some((unit) => unit.variantValue1 || unit.variantValue2);
}

/** Every cell the axes describe, in the order they are read out. */
export function cellKeysForAxes(axes: ProductVariantAxis[]): Array<{ value1: string; value2: string | null }> {
  const clean = normalizeAxes(axes);
  if (clean.length === 0) return [];
  const [first, second] = clean;
  if (!second) return first.values.map((value1) => ({ value1, value2: null }));

  const keys: Array<{ value1: string; value2: string | null }> = [];
  for (const value1 of first.values) {
    for (const value2 of second.values) keys.push({ value1, value2 });
  }
  return keys;
}

function matchKey(value1: string, value2?: string | null) {
  return `${String(value1 ?? "").trim().toLowerCase()}||${String(value2 ?? "").trim().toLowerCase()}`;
}

/**
 * What this size was actually saved with, or null for "never set".
 *
 * Kept explicit rather than `Number(x) || null` because a stored 0 is a real
 * answer — a sample priced zero, a reorder level of none — and truthiness
 * would quietly turn it back into "inherit from the product".
 */
function savedNumber(saved: number | null | undefined): number | null {
  if (saved === null || saved === undefined) return null;
  const value = Number(saved);
  return Number.isFinite(value) ? value : null;
}

/**
 * The grid the axes describe, carrying across whatever the existing rows hold.
 *
 * This is the whole point of the module. A shop that adds "XL" to a shirt in
 * March must not find every other size back at zero — so cells are matched on
 * their axis values, and price, stock, barcode and the database id ride along.
 * A genuinely new cell starts at the fallback price and no stock.
 */
export function buildVariantCells(
  axes: ProductVariantAxis[],
  existing: ProductSellingUnit[],
  fallback: { price: number; barcode?: string | null },
): VariantCell[] {
  const byValues = new Map<string, ProductSellingUnit>();
  for (const unit of existing) {
    if (!unit.variantValue1 && !unit.variantValue2) continue;
    byValues.set(matchKey(unit.variantValue1 ?? "", unit.variantValue2), unit);
  }

  return cellKeysForAxes(axes).slice(0, MAX_CELLS).map(({ value1, value2 }) => {
    const previous = byValues.get(matchKey(value1, value2));
    return {
      ...(previous?.id ? { id: previous.id } : {}),
      value1,
      value2,
      unitCode: variantCellCode(value1, value2),
      name: variantCellName(value1, value2),
      price: previous ? Number(previous.defaultPrice) || 0 : Number(fallback.price) || 0,
      qty: previous ? Number(previous.onHandQty ?? 0) : 0,
      // Reading these back is the whole point: without it every trip through
      // the editor rewrote a saved size's cost, MRP and reorder level as null.
      mrp: savedNumber(previous?.maximumPrice),
      costPrice: savedNumber(previous?.costPrice),
      minimumPrice: savedNumber(previous?.minimumPrice),
      lowStockThreshold: savedNumber(previous?.lowStockThreshold),
      reorderLevel: savedNumber(previous?.reorderLevel),
      // A barcode is unique to one physical SKU, so a new cell never inherits
      // the product's — two sizes sharing a barcode would scan as each other.
      barcode: previous?.barcode ?? null,
      isActive: previous ? previous.isActive !== false : true,
    };
  });
}

/**
 * Which of the existing variant rows the new axes no longer describe.
 *
 * Removing "XL" from an axis takes its row off the product, and the server
 * deactivates rather than deletes it — but the stock stops being counted either
 * way. A shop deserves to be told which rows, and how many pieces, before it
 * saves.
 */
export function droppedVariantCells(
  axes: ProductVariantAxis[],
  existing: ProductSellingUnit[],
): Array<{ name: string; qty: number }> {
  const wanted = new Set(cellKeysForAxes(axes).map(({ value1, value2 }) => matchKey(value1, value2)));
  return existing
    .filter((unit) => (unit.variantValue1 || unit.variantValue2) && unit.isActive !== false)
    .filter((unit) => !wanted.has(matchKey(unit.variantValue1 ?? "", unit.variantValue2)))
    .map((unit) => ({
      name: unit.name || variantCellName(unit.variantValue1 ?? "", unit.variantValue2),
      qty: Number(unit.onHandQty ?? 0),
    }));
}

/**
 * The grid as selling units the server will accept.
 *
 * One cell carries `isDefault`, because the product's headline unit, price and
 * barcode are read off it. The first cell with stock is chosen where there is
 * one — a default pointing at a size that is out would make the product read as
 * unavailable when five other sizes are on the shelf.
 */
export function variantCellsToSellingUnits(
  cells: VariantCell[],
  base: { unitType: string; mrp?: number | null; costPrice?: number | null; minimumPrice?: number | null },
): ProductSellingUnit[] {
  const defaultIndex = Math.max(0, cells.findIndex((cell) => cell.qty > 0 && cell.isActive));

  return cells.map((cell, index) => ({
    ...(cell.id ? { id: cell.id } : {}),
    name: cell.name,
    unitType: base.unitType,
    unitCode: cell.unitCode,
    // A size is not a pack size: one L shirt is one piece, so a variant row
    // never carries a pack conversion.
    packSizeValue: null,
    packSizeUnit: null,
    conversionToBase: 1,
    barcode: cell.barcode?.trim() || null,
    defaultPrice: Number(cell.price) || 0,
    // Each size carries its own. Taking these from a shared `base` was what
    // gave every size one MRP and one cost price, and wrote null over both
    // whenever the caller had nothing to pass — which the product form never did.
    minimumPrice: cell.minimumPrice ?? base.minimumPrice ?? null,
    maximumPrice: cell.mrp ?? base.mrp ?? null,
    costPrice: cell.costPrice ?? base.costPrice ?? null,
    // A variant grid always counts per row — that is what makes "which size is
    // out?" answerable, and the server forces per_pack for exactly this reason.
    onHandQty: Number(cell.qty) || 0,
    // Deliberately no fall back to the product for these two, unlike cost and
    // MRP above. A rate is per piece and means the same on every size, but the
    // product's low-stock number is a count for the whole garment — pushing 10
    // down would arm a separate alert at 10 on each of six sizes. Blank here
    // means this size raises no alert of its own, which is what it meant before.
    lowStockThreshold: cell.lowStockThreshold ?? null,
    reorderLevel: cell.reorderLevel ?? null,
    variantValue1: cell.value1,
    variantValue2: cell.value2,
    isDefault: index === defaultIndex,
    isActive: cell.isActive,
  }));
}

/** What the product's own stock figure should say: everything the grid holds. */
export function totalGridQty(cells: VariantCell[]): number {
  return Math.round(cells.reduce((sum, cell) => sum + (Number(cell.qty) || 0), 0) * 100) / 100;
}
