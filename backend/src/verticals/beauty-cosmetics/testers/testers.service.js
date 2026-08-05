import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { round2 } from "../../../utils/money.js";
import { dateRangeForDateOnly, formatDateInTimeZone } from "../../../utils/dates.js";
import { recordDamage } from "../../../modules/inventory/inventory.service.js";

/**
 * Tester stock.
 *
 * A tester is a unit opened for customers to try, and it will never be sold.
 * Counted as sellable it makes the shelf wrong in three ways at once: the shop
 * believes it has stock it cannot sell, the missing units surface weeks later as
 * shrinkage that looks like theft, and nobody ever finds out what testers cost —
 * which in a cosmetics shop is a real line of expenditure hidden inside "loss".
 *
 * So opening a tester really does take the unit out of stock, through core's
 * ordinary movement path rather than a private one, and this table records where
 * it went. The two halves have to stay together: a register that did not move
 * stock would leave the original problem exactly where it was.
 */

/** Testers still on the counter. "replaced" and "discarded" are both terminal. */
export const OPEN_STATUSES = ["in_use"];

export const TESTER_STATUSES = ["in_use", "replaced", "discarded"];

/** Replacement falling due within this many days is "soon" on the counter view. */
export const DUE_SOON_DAYS = 14;

export function todayKey() {
  return formatDateInTimeZone(new Date());
}

function trimOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function dayBounds(day, field) {
  try {
    return dateRangeForDateOnly(String(day).slice(0, 10));
  } catch {
    throw new AppError(`${field} must be a valid date (YYYY-MM-DD)`, 400);
  }
}

function daysBetween(fromKey, toKey) {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/** When a tester opened on a day, expected to last N days, falls due. */
export function dueDateFrom(openedOn, expectedDays) {
  const days = Number(expectedDays) || 0;
  if (!openedOn || days <= 0) return null;
  return new Date(new Date(openedOn).getTime() + days * 86_400_000);
}

/**
 * The tester as every caller reads it: stored columns plus the two questions a
 * counter asks — how old is it, and does it need replacing.
 *
 * Exported so those derivations can be tested without a database, and so no
 * screen re-derives "is this due?" and gets it subtly wrong.
 */
export function serializeTester(tester) {
  if (!tester) return tester;

  const today = todayKey();
  const openedKey = tester.openedOn ? formatDateInTimeZone(tester.openedOn) : null;
  const due = dueDateFrom(tester.openedOn, tester.expectedDays);
  const dueKey = due ? formatDateInTimeZone(due) : null;
  const daysLeft = dueKey ? daysBetween(today, dueKey) : null;
  const isOpen = OPEN_STATUSES.includes(tester.status);

  return {
    ...tester,
    openedOnKey: openedKey,
    closedOnKey: tester.closedOn ? formatDateInTimeZone(tester.closedOn) : null,
    dueOnKey: dueKey,
    ageDays: openedKey ? daysBetween(openedKey, today) : 0,
    daysLeft,
    isOpen,
    // Only a tester still on the counter can be due. One already swapped out is
    // history, however long ago it was opened.
    isDue: isOpen && daysLeft !== null && daysLeft <= 0,
    isDueSoon: isOpen && daysLeft !== null && daysLeft > 0 && daysLeft <= DUE_SOON_DAYS,
  };
}

export async function listTesters(shopId, { status, productId, search, dueOnly = false, includeDeleted = false } = {}) {
  const where = {
    shopId,
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(productId ? { productId } : {}),
    ...(status && status !== "all" ? { status } : {}),
    ...(search
      ? { OR: [{ productName: { contains: search } }, { variant: { contains: search } }] }
      : {}),
  };

  const rows = await db.testerUnit.findMany({
    where,
    orderBy: [{ openedOn: "desc" }],
    take: 500,
  });

  const testers = rows.map(serializeTester);
  return dueOnly ? testers.filter((tester) => tester.isDue || tester.isDueSoon) : testers;
}

export async function getTester(shopId, id) {
  const tester = await db.testerUnit.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!tester) throw new AppError("Tester not found", 404);
  return serializeTester(tester);
}

/** Every tester ever opened for a product — "how fast do we get through these?" */
export async function getTestersForProduct(shopId, productId) {
  const rows = await db.testerUnit.findMany({
    where: { shopId, productId, deletedAt: null },
    orderBy: [{ openedOn: "desc" }],
    take: 100,
  });
  return rows.map(serializeTester);
}

/**
 * Opens a tester.
 *
 * The unit leaves sellable stock through core's `recordDamage`, which is the
 * shared path for "stock left the shelf and was not sold" — it handles per-pack
 * products, writes the ledger row and updates the balance, none of which this
 * module should reimplement. The ledger entry carries a "Tester opened" note so
 * the movement is traceable back to here.
 *
 * `moveStock: false` is for the shop that already took the unit off the shelf by
 * hand and is recording the tester after the fact; moving it again would
 * decrement twice.
 */
export async function openTester(shopId, data, identity = {}) {
  const product = await db.product.findFirst({
    where: { id: data.productId, shopId, deletedAt: null },
    select: { id: true, name: true, costPerRateUnit: true, rateUnit: true, displayUnit: true, baseUnit: true },
  });
  if (!product) throw new AppError("That product is not in your catalogue", 404, "TESTER_PRODUCT_MISSING");

  const moveStock = data.moveStock !== false;
  const openedOn = data.openedOn ? dayBounds(data.openedOn, "openedOn").start : new Date();
  // Snapshotted now: the point of the figure is what testers cost over a period,
  // and a later price change must not rewrite last quarter's number.
  const costValue = data.costValue != null
    ? round2(Number(data.costValue) || 0)
    : round2(Number(product.costPerRateUnit) || 0);

  let stockLedgerId = null;
  if (moveStock) {
    const movement = await recordDamage(
      shopId,
      {
        productId: product.id,
        quantity: 1,
        enteredUnit: product.displayUnit || product.rateUnit || product.baseUnit,
        sellingUnitId: data.sellingUnitId ?? null,
        note: `Tester opened${data.variant ? `: ${String(data.variant).trim()}` : ""}`,
        locationId: data.locationId ?? null,
      },
      identity,
    );
    stockLedgerId = movement?.id ?? movement?.ledgerId ?? null;
  }

  const tester = await db.testerUnit.create({
    data: {
      shopId,
      productId: product.id,
      productName: product.name,
      variant: trimOrNull(data.variant),
      status: "in_use",
      openedOn,
      expectedDays: Number(data.expectedDays) || 90,
      costValue,
      stockLedgerId,
      notes: trimOrNull(data.notes),
      createdByUserId: identity.userId ?? null,
    },
  });
  return serializeTester(tester);
}

/**
 * Takes a tester off the counter.
 *
 * "replaced" means a fresh one went out in its place — the usual case, and the
 * one that costs the shop again. "discarded" means it was thrown away and
 * nothing replaced it. They are separated because a shop wanting to know what
 * testers cost needs to count replacements, not disposals.
 */
export async function closeTester(shopId, id, { status = "replaced", notes } = {}) {
  if (!["replaced", "discarded"].includes(status)) {
    throw new AppError("A tester is either replaced or discarded", 400, "TESTER_BAD_STATUS");
  }
  const tester = await db.testerUnit.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!tester) throw new AppError("Tester not found", 404);
  if (!OPEN_STATUSES.includes(tester.status)) {
    throw new AppError(`This tester was already ${tester.status}`, 409, "TESTER_ALREADY_CLOSED");
  }

  const updated = await db.testerUnit.update({
    where: { id: tester.id },
    data: {
      status,
      closedOn: new Date(),
      ...(notes ? { notes: [tester.notes, String(notes).trim()].filter(Boolean).join("\n") } : {}),
    },
  });
  return serializeTester(updated);
}

export async function updateTester(shopId, id, data) {
  const tester = await db.testerUnit.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!tester) throw new AppError("Tester not found", 404);

  const updated = await db.testerUnit.update({
    where: { id: tester.id },
    data: {
      ...(data.variant !== undefined ? { variant: trimOrNull(data.variant) } : {}),
      ...(data.expectedDays !== undefined ? { expectedDays: Number(data.expectedDays) || 90 } : {}),
      ...(data.costValue !== undefined ? { costValue: round2(Number(data.costValue) || 0) } : {}),
      ...(data.notes !== undefined ? { notes: trimOrNull(data.notes) } : {}),
    },
  });
  return serializeTester(updated);
}

export async function softDeleteTester(shopId, id) {
  const tester = await db.testerUnit.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!tester) throw new AppError("Tester not found", 404);
  const deleted = await db.testerUnit.update({ where: { id: tester.id }, data: { deletedAt: new Date() } });
  return serializeTester(deleted);
}

export async function restoreTester(shopId, id) {
  const tester = await db.testerUnit.findFirst({ where: { id, shopId, deletedAt: { not: null } } });
  if (!tester) throw new AppError("Deleted tester not found in recycle bin", 404);
  const restored = await db.testerUnit.update({ where: { id: tester.id }, data: { deletedAt: null } });
  return serializeTester(restored);
}

/**
 * What testers cost the shop over a period.
 *
 * The number this whole module exists to produce. A cosmetics counter with forty
 * shades out is spending real money on stock that will never be sold, and until
 * now that spend was invisible — buried in shrinkage, or simply never noticed.
 */
export async function getTesterCost(shopId, { from, to } = {}) {
  const where = { shopId, deletedAt: null };
  if (from || to) {
    const start = dayBounds(from || to, "from").start;
    const end = dayBounds(to || from, "to").end;
    if (end < start) throw new AppError("The end date cannot be before the start date", 400);
    where.openedOn = { gte: start, lte: end };
  }

  const rows = await db.testerUnit.findMany({ where, select: { productId: true, productName: true, costValue: true } });

  const byProduct = new Map();
  for (const row of rows) {
    const existing = byProduct.get(row.productId);
    if (existing) {
      existing.opened += 1;
      existing.cost = round2(existing.cost + (Number(row.costValue) || 0));
    } else {
      byProduct.set(row.productId, {
        productId: row.productId,
        productName: row.productName,
        opened: 1,
        cost: round2(Number(row.costValue) || 0),
      });
    }
  }

  return {
    totalOpened: rows.length,
    totalCost: round2(rows.reduce((sum, row) => sum + (Number(row.costValue) || 0), 0)),
    // Worst offenders first: which shades are eating the tester budget.
    byProduct: [...byProduct.values()].sort((a, b) => b.cost - a.cost),
  };
}

/** Counter-side headline numbers: what is out, what needs swapping, what it is costing. */
export async function getTesterSummary(shopId) {
  const key = todayKey();
  const monthStart = `${key.slice(0, 7)}-01`;

  const [testers, monthCost] = await Promise.all([
    listTesters(shopId, {}),
    getTesterCost(shopId, { from: monthStart, to: key }),
  ]);

  const open = testers.filter((tester) => tester.isOpen);
  return {
    today: key,
    openTesters: open.length,
    dueNow: open.filter((tester) => tester.isDue).length,
    dueSoon: open.filter((tester) => tester.isDueSoon).length,
    /** Money currently sitting on the counter as stock that will never be sold. */
    valueOnCounter: round2(open.reduce((sum, tester) => sum + (Number(tester.costValue) || 0), 0)),
    openedThisMonth: monthCost.totalOpened,
    costThisMonth: monthCost.totalCost,
    dueSoonDays: DUE_SOON_DAYS,
  };
}
