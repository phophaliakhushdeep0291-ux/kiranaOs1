import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { listProducts } from "../../../modules/products/products.service.js";
import {
  SIZE_SYSTEMS,
  canConvert,
  convertSize,
  normalizeGender,
  normalizeSystem,
  sizeLadder,
  sortSizes,
} from "./size-systems.js";

/**
 * Footwear size runs.
 *
 * The counter question in a shoe shop is never "how many do we have?" — it is
 * "have you got this in an 8?". A style is only sellable while its run is
 * unbroken, and the sizes that go first are the middle of the run, so a style
 * can be sitting on twenty pairs and be unsellable to most people who walk in.
 *
 * NOTHING HERE HOLDS STOCK. A size run is read from the variant machinery core
 * already has: a Size axis on the Product, one ProductSellingUnit per size
 * carrying its own `onHandQty`. Building a parallel table would put the same
 * pairs in two places and guarantee they disagree. All this module adds is the
 * one thing those variants cannot say — whether the numbers on them are UK, EU,
 * US or centimetres — and the reading of the run that follows from knowing it.
 */

/** The axis name that marks a variant grid as a size run. */
const SIZE_AXIS = "size";

function isSizeAxis(axis) {
  return String(axis?.name ?? "").trim().toLowerCase() === SIZE_AXIS;
}

/**
 * Where the size sits in a product's axes: first, second, or nowhere.
 *
 * Axis order is load-bearing in core — a selling unit's `variantValue1` is its
 * value on `axes[0]` — so which slot to read is a property of the product, not
 * a convention this module can assume.
 */
function sizeAxisIndexOf(product) {
  const axes = Array.isArray(product?.variantAxes) ? product.variantAxes : [];
  return axes.findIndex(isSizeAxis);
}

export function hasSizeRun(product) {
  return sizeAxisIndexOf(product) !== -1;
}

function sizeValueOf(unit, axisIndex) {
  return axisIndex === 0 ? unit?.variantValue1 : unit?.variantValue2;
}

function otherValueOf(unit, axisIndex) {
  return axisIndex === 0 ? unit?.variantValue2 : unit?.variantValue1;
}

async function profilesByProduct(shopId) {
  const rows = await db.footwearSizeProfile.findMany({ where: { shopId, deletedAt: null } });
  return new Map(rows.map((row) => [row.productId, row]));
}

/**
 * One style's run: every size the shop declared, what is on hand, and the gaps.
 *
 * A declared size with no selling unit and a selling unit at zero are both
 * "we cannot sell this today" and both count as gaps — the distinction matters
 * to whoever set the catalogue up, not to the customer at the counter.
 */
export function buildSizeRun(product, profile) {
  const axisIndex = sizeAxisIndexOf(product);
  if (axisIndex === -1) return null;

  const system = normalizeSystem(profile?.sizeSystem) ?? "uk";
  const gender = normalizeGender(profile?.gender);
  const axes = product.variantAxes ?? [];
  const declared = axes[axisIndex]?.values ?? [];
  // The second axis, when there is one, is usually colour: a run is read per
  // colourway, because "we have an 8" is false if the 8 is in the wrong colour.
  const otherAxis = axes[axisIndex === 0 ? 1 : 0] ?? null;

  const units = (product.sellingUnits ?? []).filter((unit) => unit.isActive !== false);
  const onHandBySize = new Map();
  for (const unit of units) {
    const size = String(sizeValueOf(unit, axisIndex) ?? "").trim();
    if (!size) continue;
    const key = `${size}||${String(otherValueOf(unit, axisIndex) ?? "").trim()}`;
    onHandBySize.set(key, (onHandBySize.get(key) ?? 0) + (Number(unit.onHandQty) || 0));
  }

  const sizes = sortSizes(declared, system, gender);
  const colours = otherAxis?.values?.length ? otherAxis.values : [""];

  const cells = [];
  for (const colour of colours) {
    for (const size of sizes) {
      const pairs = onHandBySize.get(`${size}||${colour}`) ?? 0;
      cells.push({
        size,
        colour: colour || null,
        pairs,
        inStock: pairs > 0,
        // What the same shoe is called on every other scale, so a customer who
        // only knows their EU size can still be served from a UK-numbered rack.
        equivalents: convertSize(system, size, gender),
      });
    }
  }

  const gaps = cells.filter((cell) => !cell.inStock);
  const totalPairs = cells.reduce((sum, cell) => sum + cell.pairs, 0);

  return {
    productId: product.id,
    productName: product.name,
    brand: product.brand ?? null,
    imageUrl: product.imageUrl ?? null,
    sizeSystem: system,
    gender,
    widthFit: profile?.widthFit ?? null,
    /** False until the shop says which scale these numbers are on. */
    isProfiled: Boolean(profile),
    /** Kids sizing has no dependable chart, so equivalents are absent by design. */
    canConvert: canConvert(gender),
    sizeAxisName: axes[axisIndex]?.name ?? "Size",
    otherAxisName: otherAxis?.name ?? null,
    sizes,
    colours: otherAxis?.values?.length ? otherAxis.values : [],
    cells,
    totalPairs,
    sizesInStock: cells.length - gaps.length,
    sizesTotal: cells.length,
    gaps: gaps.map((cell) => ({ size: cell.size, colour: cell.colour })),
    /** A run with a hole in it: the style is on the shelf but not sellable to everyone. */
    isBroken: gaps.length > 0 && totalPairs > 0,
    /** Nothing left at all — a different problem from a broken run. */
    isEmpty: totalPairs === 0,
  };
}

export async function listSizeRuns(shopId, { search, onlyBroken = false, locationId = null } = {}) {
  const [products, profiles] = await Promise.all([
    listProducts(shopId, { search, locationId }),
    profilesByProduct(shopId),
  ]);

  const runs = products
    .filter(hasSizeRun)
    .map((product) => buildSizeRun(product, profiles.get(product.id) ?? null))
    .filter(Boolean);

  return onlyBroken ? runs.filter((run) => run.isBroken || run.isEmpty) : runs;
}

export async function getSizeRun(shopId, productId) {
  const [products, profiles] = await Promise.all([listProducts(shopId), profilesByProduct(shopId)]);
  const product = products.find((entry) => entry.id === productId);
  if (!product) throw new AppError("That style is not in your catalogue", 404, "SIZE_RUN_PRODUCT_MISSING");

  const run = buildSizeRun(product, profiles.get(productId) ?? null);
  if (!run) {
    throw new AppError(
      `"${product.name}" has no size grid yet. Add a "Size" variant axis to it first.`,
      409,
      "SIZE_RUN_NO_AXIS",
    );
  }
  return run;
}

/** Declares which scale a style's numbers are written on. */
export async function setSizeProfile(shopId, productId, { sizeSystem, gender, widthFit, notes } = {}) {
  const product = await db.product.findFirst({
    where: { id: productId, shopId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!product) throw new AppError("That style is not in your catalogue", 404, "SIZE_RUN_PRODUCT_MISSING");

  const system = normalizeSystem(sizeSystem);
  if (!system) throw new AppError(`Choose one of ${SIZE_SYSTEMS.join(", ").toUpperCase()}`, 400, "SIZE_SYSTEM_INVALID");

  const data = {
    productName: product.name,
    sizeSystem: system,
    gender: normalizeGender(gender),
    widthFit: widthFit ? String(widthFit).trim() : null,
    notes: notes ? String(notes).trim() : null,
    deletedAt: null,
  };

  const saved = await db.footwearSizeProfile.upsert({
    where: { shopId_productId: { shopId, productId: product.id } },
    update: data,
    create: { shopId, productId: product.id, ...data },
  });
  return saved;
}

/**
 * The counter's conversion: a customer knows one number, the rack is labelled in
 * another. Returns which of the shop's own styles carry that size in stock, so
 * the answer is "yes, in these three" rather than a chart.
 */
export async function findBySize(shopId, { system, value, gender = "unisex" } = {}) {
  const from = normalizeSystem(system);
  if (!from) throw new AppError(`Choose one of ${SIZE_SYSTEMS.join(", ").toUpperCase()}`, 400, "SIZE_SYSTEM_INVALID");
  if (!String(value ?? "").trim()) throw new AppError("Enter a size to look up", 400, "SIZE_VALUE_REQUIRED");

  const equivalents = convertSize(from, value, gender);
  const runs = await listSizeRuns(shopId, {});

  const matches = [];
  for (const run of runs) {
    // Compare in the style's OWN system: a run numbered in EU is searched with
    // the EU equivalent of what the customer asked for, not their UK number.
    const wanted = equivalents ? equivalents[run.sizeSystem] : (run.sizeSystem === from ? String(value).trim() : null);
    if (!wanted) continue;

    const cells = run.cells.filter((cell) => String(cell.size).trim() === String(wanted).trim() && cell.inStock);
    if (cells.length === 0) continue;

    matches.push({
      productId: run.productId,
      productName: run.productName,
      brand: run.brand,
      sizeSystem: run.sizeSystem,
      gender: run.gender,
      sizeInStyleSystem: wanted,
      pairs: cells.reduce((sum, cell) => sum + cell.pairs, 0),
      colours: cells.map((cell) => cell.colour).filter(Boolean),
    });
  }

  return {
    asked: { system: from, value: String(value).trim(), gender: normalizeGender(gender) },
    equivalents,
    ladder: sizeLadder(from, gender),
    matches: matches.sort((a, b) => b.pairs - a.pairs),
  };
}

/** Headline numbers: how much of the shelf is actually sellable. */
export async function getSizeRunSummary(shopId) {
  const runs = await listSizeRuns(shopId, {});
  const broken = runs.filter((run) => run.isBroken);
  const empty = runs.filter((run) => run.isEmpty);
  const unprofiled = runs.filter((run) => !run.isProfiled);

  return {
    styles: runs.length,
    totalPairs: runs.reduce((sum, run) => sum + run.totalPairs, 0),
    brokenRuns: broken.length,
    emptyRuns: empty.length,
    // A style nobody has declared a scale for is still guessed at as UK, which
    // is right for Indian stock and wrong for imports — worth surfacing.
    unprofiledStyles: unprofiled.length,
    missingSizes: runs.reduce((sum, run) => sum + run.gaps.length, 0),
  };
}
