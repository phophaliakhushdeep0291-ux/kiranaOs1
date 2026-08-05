import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { listProducts } from "../../../modules/products/products.service.js";

/**
 * Vehicle fitment and part cross-references.
 *
 * The counter conversation in this trade never starts with a part number. It
 * starts with "Swift, 2015, diesel — oil filter", and the shop's value is the
 * mechanic behind the counter who knows which box that means. This module is
 * that knowledge written down: which parts fit which vehicles, and what else
 * will do when the right one is not on the shelf.
 *
 * Nothing here moves stock or money. It is reference data hung off the product
 * catalogue, which is why a fitment survives its product being renamed.
 */

/**
 * Makes and models are matched case-insensitively but stored as typed.
 *
 * A shop writes "maruti", "Maruti" and "MARUTI" across a year of data entry,
 * and a lookup that treated those as three manufacturers would find a third of
 * the parts that actually fit. Storing the typed form keeps the shop's own
 * spelling on screen.
 */
function matchKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function trimOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function toYear(value) {
  if (value === null || value === undefined || value === "") return null;
  const year = Number(value);
  return Number.isFinite(year) ? Math.trunc(year) : null;
}

/**
 * How a fitment reads on screen: "2015–2020", "2015 onwards", "up to 2012", or
 * "all years". Derived in one place so the list, the picker and the product view
 * cannot describe the same range differently.
 */
export function describeYears(yearFrom, yearTo) {
  if (yearFrom && yearTo) return yearFrom === yearTo ? String(yearFrom) : `${yearFrom}–${yearTo}`;
  if (yearFrom) return `${yearFrom} onwards`;
  if (yearTo) return `up to ${yearTo}`;
  return "all years";
}

export function serializeFitment(fitment) {
  if (!fitment) return fitment;
  return {
    ...fitment,
    yearLabel: describeYears(fitment.yearFrom, fitment.yearTo),
    // "Swift VXi (2015–2020)" — what a counter hand actually reads out.
    vehicleLabel: [
      [fitment.make, fitment.model].filter(Boolean).join(" "),
      fitment.variant ? `${fitment.variant}` : "",
    ].filter(Boolean).join(" · "),
  };
}

export function serializeCrossReference(reference) {
  if (!reference) return reference;
  return {
    ...reference,
    /** Whether the alternative is something this shop can actually hand over. */
    isStocked: Boolean(reference.alternateProductId),
  };
}

async function requireProduct(shopId, productId) {
  const product = await db.product.findFirst({
    where: { id: productId, shopId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!product) throw new AppError("That part is not in your catalogue", 404, "FITMENT_PRODUCT_MISSING");
  return product;
}

/* ── Fitments ─────────────────────────────────────────────────────────────── */

/**
 * Does a stored fitment cover a given year?
 *
 * An open end means "still current" or "since forever", so a null bound never
 * excludes anything — the common case for a part still in production. Asking
 * without a year matches every fitment, because "what fits a Swift?" is a
 * legitimate question on its own.
 */
export function fitmentCoversYear(fitment, year) {
  if (year == null) return true;
  if (fitment.yearFrom != null && year < fitment.yearFrom) return false;
  if (fitment.yearTo != null && year > fitment.yearTo) return false;
  return true;
}

/**
 * The counter query: which parts fit this vehicle.
 *
 * Year filtering is done in JS rather than SQL on purpose. Expressing "null
 * means unbounded" in Prisma takes a nested OR per bound that reads far worse
 * than the predicate above, and a shop's whole fitment table is thousands of
 * rows at most — already narrowed by make and model before this runs.
 */
export async function findPartsForVehicle(shopId, { make, model, variant, year, search } = {}) {
  if (!matchKey(make)) throw new AppError("Choose a make to search", 400, "FITMENT_MAKE_REQUIRED");

  // Deliberately not filtered by make in SQL. SQLite compares ASCII text
  // case-insensitively and PostgreSQL does not, and Prisma's `mode:
  // "insensitive"` exists only on PostgreSQL — so a SQL filter would quietly
  // return different results on the two databases this app ships against, and
  // a shop that typed "maruti" once would lose those parts in production only.
  // A shop's whole fitment table is a few thousand rows, so the fold is done
  // here where it behaves the same everywhere.
  const rows = await db.partFitment.findMany({
    where: { shopId, deletedAt: null },
    orderBy: [{ model: "asc" }, { productName: "asc" }],
    take: 5000,
  });

  const wantedMake = matchKey(make);
  const wantedModel = matchKey(model);
  const wantedVariant = matchKey(variant);
  const wantedYear = toYear(year);
  const term = matchKey(search);

  const matched = rows.filter((fitment) => {
    if (matchKey(fitment.make) !== wantedMake) return false;
    if (wantedModel && matchKey(fitment.model) !== wantedModel) return false;
    // A fitment with no variant fits every variant, so it always survives a
    // variant filter — that is what "null means all" has to mean at the counter.
    if (wantedVariant && fitment.variant && matchKey(fitment.variant) !== wantedVariant) return false;
    if (!fitmentCoversYear(fitment, wantedYear)) return false;
    if (term && !matchKey(fitment.productName).includes(term)) return false;
    return true;
  });

  // One product may fit the same vehicle through several rows (one per variant).
  // The counter wants a list of parts, not a list of claims.
  const byProduct = new Map();
  for (const fitment of matched) {
    const existing = byProduct.get(fitment.productId);
    if (existing) existing.fitments.push(serializeFitment(fitment));
    else byProduct.set(fitment.productId, { productId: fitment.productId, productName: fitment.productName, fitments: [serializeFitment(fitment)] });
  }

  // Stock and price come from the catalogue, so the answer is "yes it fits, and
  // we have two on the shelf" rather than only the first half.
  const products = await db.product.findMany({
    where: { id: { in: [...byProduct.keys()] }, shopId, deletedAt: null },
    select: { id: true, name: true, sku: true, brand: true, stockBaseQty: true, defaultPricePerRateUnit: true, displayUnit: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  return [...byProduct.values()].map((entry) => {
    const product = productById.get(entry.productId) ?? null;
    return {
      ...entry,
      // A fitment whose product has since been deleted still proves the shop
      // once stocked something that fits, so it is reported rather than hidden.
      inCatalogue: Boolean(product),
      productName: product?.name ?? entry.productName,
      sku: product?.sku ?? null,
      brand: product?.brand ?? null,
      stockQty: product ? Number(product.stockBaseQty) || 0 : 0,
      unit: product?.displayUnit ?? "piece",
      price: product ? Number(product.defaultPricePerRateUnit) || 0 : 0,
    };
  }).sort((a, b) => {
    // What is actually on the shelf comes first: a counter wants to sell today.
    if ((a.stockQty > 0) !== (b.stockQty > 0)) return a.stockQty > 0 ? -1 : 1;
    return a.productName.localeCompare(b.productName);
  });
}

/** Every vehicle the shop has recorded a part for, for the make/model pickers. */
export async function getVehicleOptions(shopId, { make } = {}) {
  const rows = await db.partFitment.findMany({
    where: { shopId, deletedAt: null },
    select: { make: true, model: true, variant: true },
    take: 5000,
  });

  const makes = new Map();
  const models = new Map();
  const variants = new Map();
  const wantedMake = matchKey(make);

  for (const row of rows) {
    if (!makes.has(matchKey(row.make))) makes.set(matchKey(row.make), row.make);
    if (!wantedMake || matchKey(row.make) === wantedMake) {
      if (!models.has(matchKey(row.model))) models.set(matchKey(row.model), row.model);
      if (row.variant && !variants.has(matchKey(row.variant))) variants.set(matchKey(row.variant), row.variant);
    }
  }

  const sorted = (map) => [...map.values()].sort((a, b) => a.localeCompare(b));
  return { makes: sorted(makes), models: sorted(models), variants: sorted(variants) };
}

/** What one part fits — read from the product side. */
export async function listFitmentsForProduct(shopId, productId) {
  const rows = await db.partFitment.findMany({
    where: { shopId, productId, deletedAt: null },
    orderBy: [{ make: "asc" }, { model: "asc" }, { yearFrom: "asc" }],
  });
  return rows.map(serializeFitment);
}

export async function listFitments(shopId, { make, model, search } = {}) {
  const term = matchKey(search);
  const rows = await db.partFitment.findMany({
    where: { shopId, deletedAt: null },
    orderBy: [{ make: "asc" }, { model: "asc" }, { productName: "asc" }],
    take: 2000,
  });
  const wantedMake = matchKey(make);
  const wantedModel = matchKey(model);
  return rows
    .filter((fitment) => (!wantedMake || matchKey(fitment.make) === wantedMake))
    .filter((fitment) => (!wantedModel || matchKey(fitment.model) === wantedModel))
    .filter((fitment) => (!term
      || matchKey(fitment.productName).includes(term)
      || matchKey(fitment.make).includes(term)
      || matchKey(fitment.model).includes(term)
      || matchKey(fitment.variant).includes(term)))
    .map(serializeFitment);
}

/**
 * Records that a part fits a vehicle.
 *
 * The same claim entered twice is returned rather than duplicated: a shop adding
 * fitments over months will re-enter one, and two identical rows make the
 * product view read as though it fits the same car twice.
 */
export async function createFitment(shopId, data) {
  const product = await requireProduct(shopId, data.productId);
  const yearFrom = toYear(data.yearFrom);
  const yearTo = toYear(data.yearTo);

  const existing = await findDuplicateFitment(shopId, product.id, { ...data, yearFrom, yearTo });
  if (existing) return serializeFitment(existing);

  const created = await db.partFitment.create({
    data: {
      shopId,
      productId: product.id,
      productName: product.name,
      make: String(data.make).trim(),
      model: String(data.model).trim(),
      variant: trimOrNull(data.variant),
      yearFrom,
      yearTo,
      notes: trimOrNull(data.notes),
    },
  });
  return serializeFitment(created);
}

async function findDuplicateFitment(shopId, productId, data) {
  const candidates = await db.partFitment.findMany({ where: { shopId, productId, deletedAt: null } });
  return candidates.find((fitment) =>
    matchKey(fitment.make) === matchKey(data.make)
    && matchKey(fitment.model) === matchKey(data.model)
    && matchKey(fitment.variant) === matchKey(data.variant)
    && (fitment.yearFrom ?? null) === (data.yearFrom ?? null)
    && (fitment.yearTo ?? null) === (data.yearTo ?? null)) ?? null;
}

/** Several vehicles for one part at once — one filter routinely covers a dozen. */
export async function createFitmentsBulk(shopId, { productId, fitments }) {
  const product = await requireProduct(shopId, productId);
  const created = [];
  const skipped = [];

  for (const entry of fitments) {
    const yearFrom = toYear(entry.yearFrom);
    const yearTo = toYear(entry.yearTo);
    const duplicate = await findDuplicateFitment(shopId, product.id, { ...entry, yearFrom, yearTo });
    if (duplicate) {
      skipped.push(serializeFitment(duplicate));
      continue;
    }
    const row = await db.partFitment.create({
      data: {
        shopId,
        productId: product.id,
        productName: product.name,
        make: String(entry.make).trim(),
        model: String(entry.model).trim(),
        variant: trimOrNull(entry.variant),
        yearFrom,
        yearTo,
        notes: trimOrNull(entry.notes),
      },
    });
    created.push(serializeFitment(row));
  }

  return { created, skipped };
}

export async function updateFitment(shopId, id, data) {
  const existing = await db.partFitment.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!existing) throw new AppError("Fitment not found", 404);

  const yearFrom = data.yearFrom === undefined ? existing.yearFrom : toYear(data.yearFrom);
  const yearTo = data.yearTo === undefined ? existing.yearTo : toYear(data.yearTo);
  if (yearFrom != null && yearTo != null && yearTo < yearFrom) {
    throw new AppError("The last year cannot be before the first", 400, "FITMENT_BAD_YEARS");
  }

  const updated = await db.partFitment.update({
    where: { id: existing.id },
    data: {
      ...(data.make !== undefined ? { make: String(data.make).trim() } : {}),
      ...(data.model !== undefined ? { model: String(data.model).trim() } : {}),
      ...(data.variant !== undefined ? { variant: trimOrNull(data.variant) } : {}),
      ...(data.yearFrom !== undefined ? { yearFrom } : {}),
      ...(data.yearTo !== undefined ? { yearTo } : {}),
      ...(data.notes !== undefined ? { notes: trimOrNull(data.notes) } : {}),
    },
  });
  return serializeFitment(updated);
}

export async function deleteFitment(shopId, id) {
  const existing = await db.partFitment.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!existing) throw new AppError("Fitment not found", 404);
  const deleted = await db.partFitment.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  return serializeFitment(deleted);
}

/* ── Cross-references ─────────────────────────────────────────────────────── */

export async function listCrossReferences(shopId, productId) {
  const rows = await db.partCrossReference.findMany({
    where: { shopId, productId, deletedAt: null },
    orderBy: [{ kind: "asc" }, { partNumber: "asc" }],
  });
  return rows.map(serializeCrossReference);
}

/**
 * "Someone read me a number off a box."
 *
 * Answers from both directions at once: a product whose own SKU or barcode is
 * that number, and any part the shop has cross-referenced to it. A counter does
 * not know or care which of the two made the match.
 */
export async function findByPartNumber(shopId, partNumber) {
  const wanted = matchKey(partNumber);
  if (!wanted) return { partNumber: "", products: [], references: [] };

  const [products, references] = await Promise.all([
    listProducts(shopId).then((rows) => rows.filter((product) =>
      matchKey(product.sku) === wanted || matchKey(product.barcode) === wanted)),
    db.partCrossReference.findMany({ where: { shopId, deletedAt: null }, take: 2000 }),
  ]);

  const matchedReferences = references.filter((reference) => matchKey(reference.partNumber) === wanted);

  return {
    partNumber: String(partNumber).trim(),
    products: products.map((product) => ({
      productId: product.id,
      productName: product.name,
      sku: product.sku ?? null,
      brand: product.brand ?? null,
      stockQty: Number(product.stockBaseQty) || 0,
      price: Number(product.defaultPricePerRateUnit) || 0,
    })),
    references: matchedReferences.map(serializeCrossReference),
  };
}

export async function createCrossReference(shopId, data) {
  const product = await requireProduct(shopId, data.productId);
  if (data.alternateProductId) {
    if (data.alternateProductId === product.id) {
      throw new AppError("A part cannot be its own alternative", 400, "CROSSREF_SELF");
    }
    await requireProduct(shopId, data.alternateProductId);
  }

  // The same number entered twice is returned rather than duplicated: a shop
  // builds these up over months and will re-enter one.
  const siblings = await db.partCrossReference.findMany({
    where: { shopId, productId: product.id, deletedAt: null },
  });
  const existing = siblings.find((row) => matchKey(row.partNumber) === matchKey(data.partNumber));
  if (existing) return serializeCrossReference(existing);

  const created = await db.partCrossReference.create({
    data: {
      shopId,
      productId: product.id,
      productName: product.name,
      alternateProductId: data.alternateProductId || null,
      partNumber: String(data.partNumber).trim(),
      brand: trimOrNull(data.brand),
      kind: data.kind || "alternative",
      notes: trimOrNull(data.notes),
    },
  });
  return serializeCrossReference(created);
}

export async function updateCrossReference(shopId, id, data) {
  const existing = await db.partCrossReference.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!existing) throw new AppError("Cross-reference not found", 404);
  if (data.alternateProductId) {
    if (data.alternateProductId === existing.productId) {
      throw new AppError("A part cannot be its own alternative", 400, "CROSSREF_SELF");
    }
    await requireProduct(shopId, data.alternateProductId);
  }

  const updated = await db.partCrossReference.update({
    where: { id: existing.id },
    data: {
      ...(data.alternateProductId !== undefined ? { alternateProductId: data.alternateProductId || null } : {}),
      ...(data.partNumber !== undefined ? { partNumber: String(data.partNumber).trim() } : {}),
      ...(data.brand !== undefined ? { brand: trimOrNull(data.brand) } : {}),
      ...(data.kind !== undefined ? { kind: data.kind } : {}),
      ...(data.notes !== undefined ? { notes: trimOrNull(data.notes) } : {}),
    },
  });
  return serializeCrossReference(updated);
}

export async function deleteCrossReference(shopId, id) {
  const existing = await db.partCrossReference.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!existing) throw new AppError("Cross-reference not found", 404);
  const deleted = await db.partCrossReference.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  return serializeCrossReference(deleted);
}

/** Headline numbers: how much of the catalogue the shop has actually mapped. */
export async function getFitmentSummary(shopId) {
  const [fitments, references, mappedProducts, catalogue] = await Promise.all([
    db.partFitment.count({ where: { shopId, deletedAt: null } }),
    db.partCrossReference.count({ where: { shopId, deletedAt: null } }),
    db.partFitment.findMany({ where: { shopId, deletedAt: null }, select: { productId: true }, distinct: ["productId"] }),
    db.product.count({ where: { shopId, deletedAt: null } }),
  ]);

  const { makes } = await getVehicleOptions(shopId);
  const mapped = mappedProducts.length;

  return {
    fitments,
    references,
    mappedParts: mapped,
    catalogueSize: catalogue,
    // What is still invisible to a "does this fit?" search — the number that
    // tells a shop whether this feature is doing anything for them yet.
    unmappedParts: Math.max(0, catalogue - mapped),
    makes: makes.length,
  };
}
