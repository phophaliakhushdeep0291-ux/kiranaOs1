import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { listProducts } from "../../../modules/products/products.service.js";

/**
 * Class book lists.
 *
 * A book shop's year turns on one document. The school publishes the Class 6
 * list; a parent walks in and says "Class 6, DPS"; the counter assembles eleven
 * books, four notebooks and a geometry box off a sheet taped to the wall. The
 * shop discovers what it is short of with the parent already standing there.
 *
 * A list is a RECIPE — not stock, and not an order. It names what a class needs,
 * and readiness is recomputed against the live catalogue on every read. Storing
 * a snapshot of availability would go stale the moment anything sold, and the
 * one thing this has to be is true at the counter right now.
 */

function trimOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

/** School and class are matched case- and space-insensitively; a shop types them freehand. */
function matchKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The optional label, as an empty string rather than null.
 *
 * NULLs are DISTINCT in a unique index on both SQLite and PostgreSQL, so a null
 * label would let the same class be entered twice — the exact duplicate
 * `@@unique([shopId, schoolName, className, academicYear, name])` exists to
 * stop. Writing "" makes the column participate in the constraint.
 */
function labelOrEmpty(value) {
  return String(value ?? "").trim();
}

/**
 * What a list is called when it has no label of its own: "Class 6 · DPS".
 * Derived rather than stored so renaming the school renames every list with it.
 */
export function describeList(list) {
  const base = [list?.className, list?.schoolName].filter(Boolean).join(" · ");
  return list?.name ? `${base} — ${list.name}` : base;
}

/**
 * A list read against the catalogue: how much of it the shop can hand over now.
 *
 * `stockByProduct` is passed in rather than fetched per list, so listing thirty
 * lists is one catalogue read instead of thirty.
 */
export function buildListReadiness(list, stockByProduct) {
  const items = [...(list.items ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const priced = items.map((item) => {
    const product = item.productId ? stockByProduct.get(item.productId) ?? null : null;
    const needed = Number(item.qty) || 0;
    const available = product ? Number(product.stockBaseQty) || 0 : 0;
    return {
      ...item,
      // A line the shop never carried and one whose product has since been
      // deleted are the same thing at the counter: it cannot be handed over.
      inCatalogue: Boolean(product),
      productName: product?.name ?? item.name,
      sku: product?.sku ?? null,
      price: product ? Number(product.defaultPricePerRateUnit) || 0 : 0,
      available,
      shortBy: Math.max(0, needed - available),
      isReady: Boolean(product) && available >= needed,
    };
  });

  // Optional lines — the second drawing book, the spare geometry box — are on
  // many lists. Counting them as shortfalls would make every list look
  // unfulfillable and hide the ones that genuinely are.
  const required = priced.filter((item) => !item.isOptional);
  const readyRequired = required.filter((item) => item.isReady);
  const missing = required.filter((item) => !item.isReady);

  return {
    ...list,
    label: describeList(list),
    items: priced,
    itemCount: items.length,
    requiredCount: required.length,
    readyCount: readyRequired.length,
    shortCount: missing.length,
    /** Every required line is on the shelf: the whole list can go out today. */
    isComplete: missing.length === 0,
    /** What to chase, named — the reorder list a shop actually works from. */
    missing: missing.map((item) => ({
      productId: item.productId,
      name: item.productName,
      needed: Number(item.qty) || 0,
      available: item.available,
      shortBy: item.shortBy,
      inCatalogue: item.inCatalogue,
    })),
    /** What the whole list comes to, for the lines the shop can price. */
    estimatedTotal: Math.round(priced.reduce((sum, item) => sum + item.price * (Number(item.qty) || 0), 0) * 100) / 100,
  };
}

async function stockIndex(shopId) {
  const products = await listProducts(shopId);
  return new Map(products.map((product) => [product.id, product]));
}

export async function listBookLists(shopId, { schoolName, className, academicYear, search, includeInactive = false } = {}) {
  const rows = await db.bookList.findMany({
    where: {
      shopId,
      deletedAt: null,
      ...(includeInactive ? {} : { isActive: true }),
      ...(academicYear ? { academicYear } : {}),
    },
    include: { items: true },
    orderBy: [{ academicYear: "desc" }, { schoolName: "asc" }, { className: "asc" }],
    take: 500,
  });

  const wantedSchool = matchKey(schoolName);
  const wantedClass = matchKey(className);
  const term = matchKey(search);

  const filtered = rows
    // Folded in JS, not SQL: SQLite compares ASCII case-insensitively and
    // PostgreSQL does not, so a SQL filter would behave differently on the two
    // databases this app ships against.
    .filter((list) => (!wantedSchool || matchKey(list.schoolName) === wantedSchool))
    .filter((list) => (!wantedClass || matchKey(list.className) === wantedClass))
    .filter((list) => (!term
      || matchKey(list.schoolName).includes(term)
      || matchKey(list.className).includes(term)
      || matchKey(list.name).includes(term)
      || list.items.some((item) => matchKey(item.name).includes(term))));

  const stock = await stockIndex(shopId);
  return filtered.map((list) => buildListReadiness(list, stock));
}

export async function getBookList(shopId, id) {
  const list = await db.bookList.findFirst({ where: { id, shopId, deletedAt: null }, include: { items: true } });
  if (!list) throw new AppError("Book list not found", 404);
  return buildListReadiness(list, await stockIndex(shopId));
}

/** The school/class/year pickers, built from what the shop has already entered. */
export async function getListOptions(shopId) {
  const rows = await db.bookList.findMany({
    where: { shopId, deletedAt: null },
    select: { schoolName: true, className: true, academicYear: true },
    take: 2000,
  });

  const dedupe = (values) => {
    const seen = new Map();
    for (const value of values) if (value && !seen.has(matchKey(value))) seen.set(matchKey(value), value);
    return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  };

  return {
    schools: dedupe(rows.map((row) => row.schoolName)),
    classes: dedupe(rows.map((row) => row.className)),
    years: dedupe(rows.map((row) => row.academicYear)).reverse(),
  };
}

function normalizeItems(items) {
  return items.map((item, index) => ({
    productId: item.productId ? String(item.productId) : null,
    name: String(item.name).trim(),
    qty: Number(item.qty) || 1,
    unit: String(item.unit || "piece").trim() || "piece",
    isOptional: Boolean(item.isOptional),
    notes: trimOrNull(item.notes),
    // The order the school published them in is part of the document, and a
    // list is read aloud subject by subject at the counter.
    sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
  }));
}

export async function createBookList(shopId, data) {
  const create = () =>
    db.bookList.create({
      data: {
        shopId,
        schoolName: String(data.schoolName).trim(),
        className: String(data.className).trim(),
        academicYear: String(data.academicYear).trim(),
        name: labelOrEmpty(data.name),
        notes: trimOrNull(data.notes),
        isActive: data.isActive ?? true,
        items: { create: normalizeItems(data.items ?? []) },
      },
      include: { items: true },
    });

  try {
    const list = await create();
    return buildListReadiness(list, await stockIndex(shopId));
  } catch (err) {
    if (err?.code === "P2002") {
      throw new AppError(
        `A list for ${data.className} at ${data.schoolName} (${data.academicYear}) already exists. Edit that one, or give this a different label.`,
        409,
        "BOOK_LIST_EXISTS",
      );
    }
    throw err;
  }
}

export async function updateBookList(shopId, id, data) {
  const existing = await db.bookList.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!existing) throw new AppError("Book list not found", 404);

  const patch = {
    ...(data.schoolName !== undefined ? { schoolName: String(data.schoolName).trim() } : {}),
    ...(data.className !== undefined ? { className: String(data.className).trim() } : {}),
    ...(data.academicYear !== undefined ? { academicYear: String(data.academicYear).trim() } : {}),
    ...(data.name !== undefined ? { name: labelOrEmpty(data.name) } : {}),
    ...(data.notes !== undefined ? { notes: trimOrNull(data.notes) } : {}),
    ...(data.isActive !== undefined ? { isActive: Boolean(data.isActive) } : {}),
    ...(data.items ? { items: { deleteMany: {}, create: normalizeItems(data.items) } } : {}),
  };

  try {
    const updated = await db.bookList.update({ where: { id: existing.id }, data: patch, include: { items: true } });
    return buildListReadiness(updated, await stockIndex(shopId));
  } catch (err) {
    if (err?.code === "P2002") {
      throw new AppError("Another list already covers that school, class and year", 409, "BOOK_LIST_EXISTS");
    }
    throw err;
  }
}

/**
 * Next year's list, from this year's.
 *
 * Schools reissue substantially the same list every year with a handful of
 * changes, and retyping thirty of them each April is how a shop ends up not
 * keeping lists at all. The copy is a real list from the moment it is made —
 * editable, and independent of the one it came from.
 */
export async function copyBookList(shopId, id, { academicYear, className, schoolName, name } = {}) {
  const source = await db.bookList.findFirst({ where: { id, shopId, deletedAt: null }, include: { items: true } });
  if (!source) throw new AppError("Book list not found", 404);

  const target = {
    schoolName: schoolName ? String(schoolName).trim() : source.schoolName,
    className: className ? String(className).trim() : source.className,
    academicYear: academicYear ? String(academicYear).trim() : source.academicYear,
    name: name !== undefined ? labelOrEmpty(name) : source.name,
  };

  if (
    matchKey(target.schoolName) === matchKey(source.schoolName)
    && matchKey(target.className) === matchKey(source.className)
    && matchKey(target.academicYear) === matchKey(source.academicYear)
    && matchKey(target.name) === matchKey(source.name)
  ) {
    throw new AppError("Change the year, class or label so the copy is not the same list", 409, "BOOK_LIST_COPY_SAME");
  }

  return createBookList(shopId, {
    ...target,
    notes: source.notes,
    items: source.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      qty: item.qty,
      unit: item.unit,
      isOptional: item.isOptional,
      notes: item.notes,
      sortOrder: item.sortOrder,
    })),
  });
}

export async function deleteBookList(shopId, id) {
  const existing = await db.bookList.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!existing) throw new AppError("Book list not found", 404);
  const deleted = await db.bookList.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() },
    include: { items: true },
  });
  return buildListReadiness(deleted, await stockIndex(shopId));
}

export async function restoreBookList(shopId, id) {
  const existing = await db.bookList.findFirst({ where: { id, shopId, deletedAt: { not: null } } });
  if (!existing) throw new AppError("Deleted book list not found in recycle bin", 404);
  const restored = await db.bookList.update({
    where: { id: existing.id },
    data: { deletedAt: null },
    include: { items: true },
  });
  return buildListReadiness(restored, await stockIndex(shopId));
}

/**
 * Everything the shop is short of across every active list, added up.
 *
 * This is the number that matters in the weeks before term: not "what is this
 * list missing" one at a time, but "what do I have to order, and how many, to
 * serve every class that will walk in".
 */
export async function getShortfallReport(shopId, { academicYear } = {}) {
  const lists = await listBookLists(shopId, { academicYear });

  const byProduct = new Map();
  for (const list of lists) {
    for (const item of list.missing) {
      const key = item.productId ?? `unstocked:${matchKey(item.name)}`;
      const existing = byProduct.get(key);
      if (existing) {
        existing.shortBy += item.shortBy;
        existing.lists.push(list.label);
      } else {
        byProduct.set(key, {
          productId: item.productId,
          name: item.name,
          inCatalogue: item.inCatalogue,
          available: item.available,
          shortBy: item.shortBy,
          lists: [list.label],
        });
      }
    }
  }

  return [...byProduct.values()].sort((a, b) => b.lists.length - a.lists.length || b.shortBy - a.shortBy);
}

/** Headline numbers: how ready the shop is for the season. */
export async function getBookListSummary(shopId) {
  const lists = await listBookLists(shopId, {});
  const complete = lists.filter((list) => list.isComplete);
  const shortfall = await getShortfallReport(shopId, {});

  return {
    lists: lists.length,
    completeLists: complete.length,
    shortLists: lists.length - complete.length,
    /** Distinct items to order, not the sum of the quantities. */
    itemsToOrder: shortfall.length,
    unitsToOrder: shortfall.reduce((sum, item) => sum + item.shortBy, 0),
    schools: new Set(lists.map((list) => matchKey(list.schoolName))).size,
  };
}
