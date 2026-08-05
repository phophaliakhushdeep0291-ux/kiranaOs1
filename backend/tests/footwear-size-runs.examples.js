import assert from "assert";
import {
  canConvert,
  convertSize,
  normalizeGender,
  normalizeSystem,
  sizeLadder,
  sizeRank,
  sortSizes,
} from "../src/verticals/footwear/sizes/size-systems.js";
import { buildSizeRun, hasSizeRun } from "../src/verticals/footwear/sizes/sizes.service.js";

// Footwear size runs. "Have you got this in an 8?" is the only question a shoe
// shop's counter asks, and answering it needs two things this pins: that "8"
// means the same shoe on every scale, and that a run reads small-to-large when
// the sizes are stored as text.

/* ── The chart ─────────────────────────────────────────────────────────────── */

const uk8 = convertSize("uk", "8", "mens");
assert.equal(uk8.us, "9", "US men's runs one ahead of UK");
assert.equal(uk8.eu, "42");
assert.equal(uk8.cm, "26.5");

// Every scale must reach the same physical shoe, or a rack labelled in one
// system becomes unsearchable from a customer who knows another.
for (const [system, value] of [["uk", "8"], ["us", "9"], ["eu", "42"], ["cm", "26.5"]]) {
  assert.equal(convertSize(system, value, "mens").uk, "8", `${system} ${value} is the same shoe`);
}

// The lasts differ, so the same UK number is a different shoe for men and women.
assert.equal(convertSize("uk", "6", "womens").eu, "38");
assert.equal(convertSize("uk", "6", "mens").eu, "39");
assert.notEqual(convertSize("uk", "6", "womens").us, convertSize("uk", "6", "mens").us);

// EU sizing is not linear against UK, which is why this is a table and not
// arithmetic: the step from UK 10 to 11 is 1.5 EU sizes, not 1.
assert.equal(convertSize("uk", "10", "mens").eu, "44.5");
assert.equal(convertSize("uk", "11", "mens").eu, "46");

// How a size actually arrives off a box or out of a customer's mouth.
assert.equal(convertSize("uk", "UK 8", "mens").us, "9", "a system prefix is tolerated");
assert.equal(convertSize("uk", "8.0", "mens").us, "9", "a trailing .0 is the same size");
assert.equal(convertSize("uk", " 8 ", "mens").us, "9", "surrounding space is tolerated");
assert.equal(convertSize("eu", "44½", "mens").uk, "10", "a half-size glyph is understood");

// Interpolating would send someone to a shelf that has never held one.
assert.equal(convertSize("uk", "99", "mens"), null, "a size off the chart is not invented");
assert.equal(convertSize("uk", "8.25", "mens"), null, "a size no maker produces is not invented");
assert.equal(convertSize("uk", "", "mens"), null);
assert.equal(convertSize("furlongs", "8", "mens"), null, "an unknown system converts to nothing");

// Children's sizing splits into scales that restart at 1 and varies so much by
// brand that any table would be invented. Saying so beats a confident guess.
assert.equal(canConvert("kids"), false);
assert.equal(convertSize("uk", "8", "kids"), null, "kids returns nothing rather than a wrong answer");
assert.deepEqual(sizeLadder("uk", "kids"), [], "there is no kids ladder to draw a grid against");

assert.equal(canConvert("mens"), true);
assert.equal(canConvert("unisex"), true);
assert.equal(convertSize("uk", "8", "unisex").eu, "42", "unisex follows the men's ladder");

/* ── Normalising what a caller passes in ───────────────────────────────────── */

assert.equal(normalizeSystem("UK"), "uk");
assert.equal(normalizeSystem(" eu "), "eu");
assert.equal(normalizeSystem("metric"), null, "an unknown system is null, not a default");
assert.equal(normalizeGender("MENS"), "mens");
assert.equal(normalizeGender("nonsense"), "unisex", "an unknown wearer falls back rather than failing");
assert.equal(normalizeGender(undefined), "unisex");

/* ── Sorting a run ─────────────────────────────────────────────────────────── */

// The trap: sizes live as text on a variant, so plain sorting reads
// 10, 11, 6, 7, 8, 9 — which is how a size grid ends up unreadable.
assert.deepEqual(
  sortSizes(["10", "7", "11", "8", "6", "9"], "uk", "mens"),
  ["6", "7", "8", "9", "10", "11"],
);
assert.deepEqual(sortSizes(["44.5", "41", "46"], "eu", "mens"), ["41", "44.5", "46"]);

// An off-chart size keeps a sensible place instead of scrambling the row.
assert.deepEqual(sortSizes(["8", "14", "6"], "uk", "mens"), ["6", "8", "14"]);
assert.deepEqual(sortSizes(["8", "Free", "6"], "uk", "mens"), ["6", "8", "Free"], "non-numeric sorts last");
assert.ok(sizeRank("uk", "8", "mens") < sizeRank("uk", "14", "mens"), "charted sizes rank ahead of off-chart");
assert.ok(sizeRank("uk", "14", "mens") < sizeRank("uk", "Free", "mens"), "off-chart numerics rank ahead of text");

assert.deepEqual(sortSizes([], "uk", "mens"), []);

/* ── Reading a run off the variant machinery ───────────────────────────────── */

/** A product as core serialises it: axes plus one selling unit per size. */
function style(sizes, stock, { axisName = "Size", extraAxis = null, axisFirst = true } = {}) {
  const sizeAxis = { name: axisName, values: sizes };
  const axes = axisFirst
    ? [sizeAxis, ...(extraAxis ? [extraAxis] : [])]
    : [...(extraAxis ? [extraAxis] : []), sizeAxis];
  return {
    id: "p_1",
    name: "Runner Black",
    variantAxes: axes,
    sellingUnits: sizes.map((size) => ({
      // Axis order is load-bearing: variantValue1 is the value on axes[0].
      variantValue1: axisFirst ? size : (extraAxis?.values?.[0] ?? null),
      variantValue2: axisFirst ? (extraAxis?.values?.[0] ?? null) : size,
      onHandQty: stock[size] ?? 0,
      isActive: true,
    })),
  };
}

const product = style(["6", "7", "8", "9", "10"], { 6: 2, 7: 3, 8: 0, 9: 0, 10: 1 });
assert.equal(hasSizeRun(product), true);

const run = buildSizeRun(product, null);
assert.deepEqual(run.sizes, ["6", "7", "8", "9", "10"], "the run is drawn in size order");
assert.equal(run.totalPairs, 6, "pairs come from the selling units, not from anything stored here");
assert.equal(run.sizesInStock, 3);
assert.deepEqual(run.gaps.map((gap) => gap.size), ["8", "9"], "the gaps are named");
assert.equal(run.isBroken, true, "a style on the shelf with holes in its run is broken");
assert.equal(run.isEmpty, false);
assert.equal(run.isProfiled, false, "nobody has said which scale these numbers are on");
assert.equal(run.sizeSystem, "uk", "an undeclared style is read as UK, which is right for Indian stock");
assert.equal(run.cells.find((cell) => cell.size === "8").equivalents.eu, "42");

// Nothing left at all is a different problem from a hole in the middle.
const sandal = buildSizeRun(style(["6", "7"], { 6: 0, 7: 0 }), null);
assert.equal(sandal.isEmpty, true);
assert.equal(sandal.isBroken, false, "an empty style is not merely broken");

// A full run has nothing to report.
const full = buildSizeRun(style(["6", "7"], { 6: 1, 7: 1 }), null);
assert.equal(full.isBroken, false);
assert.equal(full.isEmpty, false);
assert.deepEqual(full.gaps, []);

// Declaring the scale changes how the same numbers are read.
const declared = buildSizeRun(product, { sizeSystem: "eu", gender: "mens" });
assert.equal(declared.sizeSystem, "eu");
assert.equal(declared.isProfiled, true);
assert.equal(declared.cells.find((cell) => cell.size === "6").equivalents, null,
  "6 is not on the EU ladder, so no equivalent is invented for it");

// Axis order is a property of the product, not a convention — a style that
// declares Colour first still reads its sizes correctly.
const colourFirst = buildSizeRun(
  style(["7", "8"], { 7: 1, 8: 2 }, { extraAxis: { name: "Colour", values: ["Black"] }, axisFirst: false }),
  null,
);
assert.deepEqual(colourFirst.sizes, ["7", "8"], "the size axis is found wherever it sits");
assert.equal(colourFirst.totalPairs, 3);
assert.equal(colourFirst.otherAxisName, "Colour");

// A product with no size axis is not a size run at all.
const polish = { id: "p_2", name: "Shoe Polish", variantAxes: [], sellingUnits: [] };
assert.equal(hasSizeRun(polish), false);
assert.equal(buildSizeRun(polish, null), null, "a product with no size axis builds no run");
assert.equal(hasSizeRun({ id: "p_3", name: "Laces" }), false, "a product with no axes at all is safe");

console.log("footwear-size-runs: all checks passed");
