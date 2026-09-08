import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { round2 } from "../../../utils/money.js";
import { dateRangeForDateOnly, formatDateInTimeZone } from "../../../utils/dates.js";
import { HELD_STATUSES } from "./units.schema.js";

/**
 * Serialised electronics stock.
 *
 * Every other trade in the app counts stock as a number. Here the shop sells
 * THAT handset, and months later a return, a warranty claim or a police enquiry
 * has to find the same physical unit. One question drives the whole module:
 * somebody puts a phone on the counter, reads out fifteen digits, and the shop
 * has to answer "yes, we sold it, on the 3rd, to Ramesh, cover runs to March".
 *
 * A unit is deliberately NOT a replacement for `Product.stockBaseQty`. The
 * product still carries the count billing and reports read; this table answers
 * "which one, and where did it go", which a count cannot. Selling a unit here
 * therefore moves no stock and touches no money — the bill does that, and
 * `billId` is how the two are read together.
 */

/** Cover ending within this many days is "expiring soon" on the counter view. */
export const WARRANTY_SOON_DAYS = 30;

export function todayKey() {
  return formatDateInTimeZone(new Date());
}

function dayBounds(day, field) {
  try {
    return dateRangeForDateOnly(String(day).slice(0, 10));
  } catch {
    throw new AppError(`${field} must be a valid date (YYYY-MM-DD)`, 400);
  }
}

function trimOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

/** Identifiers are compared and stored upper-case: a serial is read off a box by eye. */
function normalizeIdentifier(value) {
  const text = String(value ?? "").trim().toUpperCase();
  return text || null;
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function daysBetween(fromKey, toKey) {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Cover ends on the same day-of-month, N months on.
 *
 * Calendar months, not 30-day blocks, because that is what a warranty card says
 * and what a customer will argue. A unit sold on the 31st of a month whose
 * target month is shorter lands on that month's last day rather than rolling
 * into the next one — `new Date(2026, 1, 31)` would silently become 3 March.
 */
export function warrantyEndFrom(soldAt, months) {
  const count = Number(months) || 0;
  if (!soldAt || count <= 0) return null;
  const start = new Date(soldAt);
  const target = new Date(start.getTime());
  target.setMonth(target.getMonth() + count);
  if (target.getDate() !== start.getDate()) target.setDate(0);
  return target;
}

/**
 * The unit as every caller reads it: stored columns plus the questions the
 * counter actually asks — is it still ours, is it in warranty, how long is left.
 *
 * Exported so those derivations can be tested without a database, and so no
 * screen re-derives "is this in warranty?" and gets it subtly wrong.
 */
export function serializeUnit(unit) {
  if (!unit) return unit;
  const today = todayKey();
  const warrantyKey = unit.warrantyUntil ? formatDateInTimeZone(unit.warrantyUntil) : null;
  const warrantyDaysLeft = warrantyKey ? daysBetween(today, warrantyKey) : null;
  return {
    ...unit,
    receivedAtKey: unit.receivedAt ? formatDateInTimeZone(unit.receivedAt) : null,
    soldAtKey: unit.soldAt ? formatDateInTimeZone(unit.soldAt) : null,
    warrantyUntilKey: warrantyKey,
    warrantyDaysLeft,
    // Cover that ran out yesterday is not cover. A unit that was never sold has
    // no warranty to be in, however many months the box promised.
    isUnderWarranty: Boolean(unit.soldAt) && warrantyDaysLeft !== null && warrantyDaysLeft >= 0,
    isWarrantyExpiringSoon:
      Boolean(unit.soldAt) && warrantyDaysLeft !== null && warrantyDaysLeft >= 0 && warrantyDaysLeft <= WARRANTY_SOON_DAYS,
    /** Still physically on the shop's shelf or bench. */
    isHeld: HELD_STATUSES.includes(unit.status),
    canSell: unit.status === "in_stock" || unit.status === "returned",
  };
}

/**
 * The counter lookup: one code, checked against every identifier a unit carries.
 *
 * Returns null rather than throwing when nothing matches — "we have no record of
 * this handset" is a real and common answer (a unit bought elsewhere), not an
 * error the screen should render as a failure.
 */
export async function lookupUnit(shopId, code) {
  const value = normalizeIdentifier(code);
  if (!value) return null;
  const unit = await db.productUnit.findFirst({
    where: {
      shopId,
      deletedAt: null,
      OR: [{ imei: value }, { imei2: value }, { serialNumber: value }],
    },
  });
  return unit ? serializeUnit(unit) : null;
}

export async function listUnits(shopId, { status, productId, condition, search, from, to, includeDeleted = false } = {}) {
  const term = normalizeIdentifier(search);
  const where = {
    shopId,
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(productId ? { productId } : {}),
    ...(condition && condition !== "all" ? { condition } : {}),
  };

  // "held" is the question a shopkeeper asks — what is still mine — and spans
  // three statuses, so it is offered alongside the literal ones.
  if (status === "held") where.status = { in: HELD_STATUSES };
  else if (status && status !== "all") where.status = status;

  if (term) {
    const raw = String(search).trim();
    // Only the digits, and only when there are some: `contains: ""` matches
    // every row, so folding a non-numeric search into the phone clause would
    // quietly turn "find this serial" into "show me everything".
    const phoneDigits = raw.replace(/[^0-9]/g, "");
    where.OR = [
      { imei: { contains: term } },
      { imei2: { contains: term } },
      { serialNumber: { contains: term } },
      { billNumber: { contains: term } },
      // Names are stored as typed, so they match the raw text rather than the
      // upper-cased identifier form.
      { productName: { contains: raw } },
      { customerName: { contains: raw } },
      ...(phoneDigits ? [{ customerPhone: { contains: phoneDigits } }] : []),
    ];
  }

  if (from || to) {
    const start = dayBounds(from || to, "from").start;
    const end = dayBounds(to || from, "to").end;
    if (end < start) throw new AppError("The end date cannot be before the start date", 400);
    where.receivedAt = { gte: start, lte: end };
  }

  const rows = await db.productUnit.findMany({
    where,
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  return rows.map(serializeUnit);
}

export async function getUnit(shopId, id) {
  const unit = await db.productUnit.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!unit) throw new AppError("Unit not found", 404);
  return serializeUnit(unit);
}

/**
 * Which identifiers in a batch are already on the books.
 *
 * Checked before writing anything so receiving twenty handsets fails as "these
 * three are already recorded" rather than saving seventeen and then stopping —
 * a partial receipt is worse than none, because nobody knows where it stopped.
 */
async function findClashingIdentifiers(shopId, units, { excludeUnitId = null } = {}) {
  const codes = new Set();
  for (const unit of units) {
    for (const code of [unit.imei, unit.imei2, unit.serialNumber]) {
      if (code) codes.add(code);
    }
  }
  if (codes.size === 0) return [];

  const list = [...codes];
  const existing = await db.productUnit.findMany({
    where: {
      shopId,
      ...(excludeUnitId ? { id: { not: excludeUnitId } } : {}),
      OR: [{ imei: { in: list } }, { imei2: { in: list } }, { serialNumber: { in: list } }],
    },
    // A soft-deleted unit still holds its identifier: the unique index does not
    // know about deletedAt, so reusing the code would fail at the database
    // anyway. Reporting it here turns a P2002 into a sentence a shopkeeper can act on.
    select: { imei: true, imei2: true, serialNumber: true, productName: true, deletedAt: true },
  });

  const clashes = [];
  for (const row of existing) {
    for (const code of [row.imei, row.imei2, row.serialNumber]) {
      if (code && codes.has(code)) clashes.push({ code, productName: row.productName, deleted: Boolean(row.deletedAt) });
    }
  }
  return clashes;
}

/** Receiving a box: several units of one product, sharing a supplier and purchase bill. */
export async function receiveUnits(shopId, data, { userId = null } = {}) {
  const product = await db.product.findFirst({
    where: { id: data.productId, shopId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!product) throw new AppError("That product is not in your catalogue", 404, "UNIT_PRODUCT_MISSING");

  const units = data.units.map((unit) => ({
    imei: normalizeIdentifier(unit.imei),
    imei2: normalizeIdentifier(unit.imei2),
    serialNumber: normalizeIdentifier(unit.serialNumber),
    condition: unit.condition || "new",
    costPrice: round2(Number(unit.costPrice) || Number(data.costPrice) || 0),
    notes: trimOrNull(unit.notes),
  }));

  // Duplicates inside the batch itself — two lines of the same scan.
  const seen = new Set();
  for (const unit of units) {
    for (const code of [unit.imei, unit.imei2, unit.serialNumber]) {
      if (!code) continue;
      if (seen.has(code)) throw new AppError(`${code} is entered twice in this batch`, 409, "UNIT_DUPLICATE_IN_BATCH");
      seen.add(code);
    }
  }

  const clashes = await findClashingIdentifiers(shopId, units);
  if (clashes.length) {
    const first = clashes[0];
    throw new AppError(
      clashes.length === 1
        ? `${first.code} is already recorded against "${first.productName}"${first.deleted ? " (in the recycle bin)" : ""}`
        : `${clashes.length} of these are already recorded, starting with ${first.code}`,
      409,
      "UNIT_ALREADY_EXISTS",
    );
  }

  const warrantyMonths = Number(data.warrantyMonths) || 0;
  const receivedAt = new Date();

  await db.productUnit.createMany({
    data: units.map((unit) => ({
      shopId,
      productId: product.id,
      productName: product.name,
      ...unit,
      status: "in_stock",
      purchaseBillId: data.purchaseBillId || null,
      supplierId: data.supplierId || null,
      warrantyMonths,
      receivedAt,
      createdByUserId: userId,
    })),
  });

  // Read back rather than trusting createMany's count: the caller wants the
  // rows, and SQLite's createMany does not return them.
  const created = await db.productUnit.findMany({
    where: { shopId, productId: product.id, receivedAt, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return created.map(serializeUnit);
}

export async function updateUnit(shopId, id, data) {
  const existing = await db.productUnit.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!existing) throw new AppError("Unit not found", 404);

  const next = {
    imei: data.imei === undefined ? existing.imei : normalizeIdentifier(data.imei),
    imei2: data.imei2 === undefined ? existing.imei2 : normalizeIdentifier(data.imei2),
    serialNumber: data.serialNumber === undefined ? existing.serialNumber : normalizeIdentifier(data.serialNumber),
  };
  if (!next.imei && !next.serialNumber) {
    throw new AppError("A unit must keep an IMEI or a serial number", 400, "UNIT_NEEDS_IDENTIFIER");
  }
  if (next.imei && next.imei2 && next.imei === next.imei2) {
    throw new AppError("The two IMEI numbers on a dual-SIM handset must differ", 400, "UNIT_IMEI_DUPLICATE");
  }

  const clashes = await findClashingIdentifiers(shopId, [next], { excludeUnitId: existing.id });
  if (clashes.length) {
    throw new AppError(`${clashes[0].code} is already recorded against "${clashes[0].productName}"`, 409, "UNIT_ALREADY_EXISTS");
  }

  const updated = await db.productUnit.update({
    where: { id: existing.id },
    data: {
      ...next,
      ...(data.condition !== undefined ? { condition: data.condition } : {}),
      ...(data.costPrice !== undefined ? { costPrice: round2(Number(data.costPrice) || 0) } : {}),
      ...(data.supplierId !== undefined ? { supplierId: data.supplierId || null } : {}),
      ...(data.purchaseBillId !== undefined ? { purchaseBillId: data.purchaseBillId || null } : {}),
      ...(data.notes !== undefined ? { notes: trimOrNull(data.notes) } : {}),
      // Changing the months on a unit already sold has to move its end date too,
      // or the card and the record would disagree.
      ...(data.warrantyMonths !== undefined
        ? {
            warrantyMonths: Number(data.warrantyMonths) || 0,
            ...(existing.soldAt ? { warrantyUntil: warrantyEndFrom(existing.soldAt, data.warrantyMonths) } : {}),
          }
        : {}),
    },
  });
  return serializeUnit(updated);
}

/**
 * Hands the unit over.
 *
 * This records which piece went to whom; it does not bill, move stock or take
 * money. The warranty clock starts here, which is why the end date is computed
 * and stored now rather than derived on every read from a policy that may change.
 */
export async function sellUnit(shopId, id, data = {}) {
  const unit = await db.productUnit.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!unit) throw new AppError("Unit not found", 404);
  if (unit.status === "sold") {
    throw new AppError(
      `This unit was already sold${unit.billNumber ? ` on ${unit.billNumber}` : ""}. Take it back first if it has come in again.`,
      409,
      "UNIT_ALREADY_SOLD",
    );
  }
  if (!["in_stock", "returned"].includes(unit.status)) {
    throw new AppError(`A unit marked "${unit.status}" cannot be sold`, 409, "UNIT_BAD_STATUS");
  }

  const soldAt = data.soldOn ? dayBounds(data.soldOn, "soldOn").start : new Date();
  const warrantyMonths = data.warrantyMonths == null ? unit.warrantyMonths : Number(data.warrantyMonths) || 0;

  const updated = await db.productUnit.update({
    where: { id: unit.id },
    data: {
      status: "sold",
      soldAt,
      billId: data.billId || null,
      billNumber: trimOrNull(data.billNumber),
      customerId: data.customerId || null,
      customerName: trimOrNull(data.customerName),
      customerPhone: normalizePhone(data.customerPhone),
      sellingPrice: round2(Number(data.sellingPrice) || 0),
      warrantyMonths,
      warrantyUntil: warrantyEndFrom(soldAt, warrantyMonths),
      ...(data.notes !== undefined && data.notes !== null ? { notes: String(data.notes).trim() } : {}),
    },
  });
  return serializeUnit(updated);
}

/**
 * Takes a sold unit back.
 *
 * The buyer's details stay on the row on purpose: the register's job is to say
 * where this piece has been, and erasing the customer would lose the fact that
 * it was ever out. The condition drops to open-box by default, because a
 * returned handset cannot go back on the shelf as new.
 */
export async function returnUnit(shopId, id, { condition = "open_box", reason } = {}) {
  const unit = await db.productUnit.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!unit) throw new AppError("Unit not found", 404);
  if (unit.status !== "sold") throw new AppError("Only a sold unit can be taken back", 409, "UNIT_BAD_STATUS");

  const updated = await db.productUnit.update({
    where: { id: unit.id },
    data: {
      status: "returned",
      condition,
      ...(reason ? { notes: [unit.notes, `Returned: ${String(reason).trim()}`].filter(Boolean).join("\n") } : {}),
    },
  });
  return serializeUnit(updated);
}

/** Sends a unit to the service centre, from the shelf or from a customer. */
export async function sendUnitToService(shopId, id, { reason } = {}) {
  const unit = await db.productUnit.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!unit) throw new AppError("Unit not found", 404);
  if (unit.status === "rma") throw new AppError("This unit is already with the service centre", 409, "UNIT_BAD_STATUS");
  if (["lost", "scrapped"].includes(unit.status)) throw new AppError(`A ${unit.status} unit cannot be serviced`, 409, "UNIT_BAD_STATUS");

  const updated = await db.productUnit.update({
    where: { id: unit.id },
    data: {
      status: "rma",
      ...(reason ? { notes: [unit.notes, `Sent to service: ${String(reason).trim()}`].filter(Boolean).join("\n") } : {}),
    },
  });
  return serializeUnit(updated);
}

/** Brings a unit back from the service centre onto the shelf. */
export async function returnUnitFromService(shopId, id, { condition = "refurbished" } = {}) {
  const unit = await db.productUnit.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!unit) throw new AppError("Unit not found", 404);
  if (unit.status !== "rma") throw new AppError("This unit is not with the service centre", 409, "UNIT_BAD_STATUS");

  const updated = await db.productUnit.update({
    where: { id: unit.id },
    data: { status: "returned", condition },
  });
  return serializeUnit(updated);
}

export async function writeOffUnit(shopId, id, { status, reason } = {}) {
  const unit = await db.productUnit.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!unit) throw new AppError("Unit not found", 404);
  if (unit.status === "sold") throw new AppError("A sold unit cannot be written off — take it back first", 409, "UNIT_BAD_STATUS");

  const updated = await db.productUnit.update({
    where: { id: unit.id },
    data: {
      status,
      ...(reason ? { notes: [unit.notes, `${status === "lost" ? "Lost" : "Scrapped"}: ${String(reason).trim()}`].filter(Boolean).join("\n") } : {}),
    },
  });
  return serializeUnit(updated);
}

export async function softDeleteUnit(shopId, id) {
  const unit = await db.productUnit.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!unit) throw new AppError("Unit not found", 404);
  const deleted = await db.productUnit.update({ where: { id: unit.id }, data: { deletedAt: new Date() } });
  return serializeUnit(deleted);
}

export async function restoreUnit(shopId, id) {
  const unit = await db.productUnit.findFirst({ where: { id, shopId, deletedAt: { not: null } } });
  if (!unit) throw new AppError("Deleted unit not found in recycle bin", 404);
  const restored = await db.productUnit.update({ where: { id: unit.id }, data: { deletedAt: null } });
  return serializeUnit(restored);
}

/** Every serialised unit of one product — "which of these do we actually still have?" */
export async function getUnitsForProduct(shopId, productId, { status = "held" } = {}) {
  return listUnits(shopId, { productId, status });
}

/** Counter-side headline numbers: what is on the shelf, what went out, what is away. */
export async function getUnitSummary(shopId) {
  const key = todayKey();
  const { start: dayStart, end: dayEnd } = dateRangeForDateOnly(key);
  const monthStart = dateRangeForDateOnly(`${key.slice(0, 7)}-01`).start;
  const soonEnd = new Date(dayEnd.getTime() + WARRANTY_SOON_DAYS * 86_400_000);

  const [inStock, openBox, soldToday, soldThisMonth, atService, warrantyExpiringSoon] = await Promise.all([
    db.productUnit.count({ where: { shopId, deletedAt: null, status: { in: ["in_stock", "returned"] } } }),
    db.productUnit.count({ where: { shopId, deletedAt: null, status: { in: ["in_stock", "returned"] }, condition: { in: ["open_box", "refurbished"] } } }),
    db.productUnit.count({ where: { shopId, deletedAt: null, status: "sold", soldAt: { gte: dayStart, lte: dayEnd } } }),
    db.productUnit.count({ where: { shopId, deletedAt: null, status: "sold", soldAt: { gte: monthStart } } }),
    db.productUnit.count({ where: { shopId, deletedAt: null, status: "rma" } }),
    db.productUnit.count({
      where: { shopId, deletedAt: null, status: "sold", warrantyUntil: { gte: dayStart, lte: soonEnd } },
    }),
  ]);

  return {
    today: key,
    inStock,
    openBox,
    soldToday,
    soldThisMonth,
    atService,
    warrantyExpiringSoon,
    warrantySoonDays: WARRANTY_SOON_DAYS,
  };
}
