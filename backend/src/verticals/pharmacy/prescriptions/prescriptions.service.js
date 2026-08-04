import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { dateRangeForDateOnly, formatDateInTimeZone } from "../../../utils/dates.js";

/**
 * The pharmacy prescription register.
 *
 * Schedule H, H1 and X medicines may not be sold without a prescription, and the
 * shop has to be able to produce the register on inspection: who prescribed it,
 * for whom, what was actually handed over, and when. That is the whole purpose
 * of this module — it is a record, not a transaction. No stock moves here and no
 * money changes hands; the sale itself is an ordinary bill, optionally linked
 * back by `billId` so the two can be read together.
 *
 * A slip may be dispensed more than once when the doctor allowed repeats, which
 * is what `refillsAllowed` / `refillsUsed` count. The first hand-over is not a
 * refill; every one after it is.
 */

/** Register entries that can still be dispensed against. "cancelled" is terminal. */
export const OPEN_STATUSES = ["pending", "dispensed"];

/**
 * How long a pending slip is treated as fresh.
 *
 * Nothing in law fixes a single validity for every prescription, so this is not
 * enforced — a stale entry is flagged, never blocked. It exists so a chemist can
 * see that the slip in front of them was written three months ago before
 * dispensing an antibiotic against it.
 */
export const STALE_AFTER_DAYS = 90;

function dayBounds(day, field) {
  try {
    return dateRangeForDateOnly(String(day).slice(0, 10));
  } catch {
    throw new AppError(`${field} must be a valid date (YYYY-MM-DD)`, 400);
  }
}

export function todayKey() {
  return formatDateInTimeZone(new Date());
}

/**
 * A mobile number reduced to the form the app identifies a person by: the last
 * ten digits, as `assurance/rules/customer-credit.rules.js` also does.
 *
 * The point of the register is that a patient can be found in it, and a counter
 * types the same number as "9876543210" one day and "+91 98765-43210" the next.
 * Keeping the country code would file those as two different people. Anything
 * shorter than ten digits is kept exactly as typed rather than discarded — the
 * field is optional, and a half-remembered number still beats nothing.
 */
export function normalizePhone(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function trimOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function daysBetween(fromKey, toKey) {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * The register row as every caller reads it: the stored columns plus the four
 * questions a counter actually asks — how old is this slip, can it still be
 * dispensed, how many repeats are left, and does the law care about it.
 *
 * Exported so those derivations can be tested without a database, and so no
 * screen has to re-derive "can I dispense this?" and get it subtly wrong.
 */
export function serializePrescription(prescription) {
  if (!prescription) return prescription;
  const prescribedKey = formatDateInTimeZone(prescription.prescribedOn);
  const ageDays = daysBetween(prescribedKey, todayKey());
  const refillsLeft = Math.max(0, (prescription.refillsAllowed ?? 0) - (prescription.refillsUsed ?? 0));
  return {
    ...prescription,
    prescribedOnKey: prescribedKey,
    dispensedAtKey: prescription.dispensedAt ? formatDateInTimeZone(prescription.dispensedAt) : null,
    ageDays,
    // Only a slip still waiting to be dispensed can go stale; one already handed
    // over is simply history, however old.
    isStale: prescription.status === "pending" && ageDays > STALE_AFTER_DAYS,
    refillsLeft,
    canDispense:
      prescription.status === "pending" || (prescription.status === "dispensed" && refillsLeft > 0),
    // The schedules the retention and inspection rules actually bite on.
    isRegulated: ["h", "h1", "x"].includes(prescription.scheduleType),
  };
}

/**
 * Per-shop register number. Derived from the highest existing number rather than
 * a row count so a deleted entry can never hand its number to a new one; the
 * unique index is the real guard and the caller retries on collision.
 *
 * Six digits because the "highest" is found by sorting text: the day a shop
 * rolled past the padding width, "RX-1000000" would sort below "RX-999999" and
 * every new entry would collide.
 */
export async function nextRegisterNumber(client, shopId) {
  const last = await client.prescription.findFirst({
    where: { shopId },
    orderBy: { registerNumber: "desc" },
    select: { registerNumber: true },
  });
  const previous = Number(String(last?.registerNumber ?? "").replace(/\D/g, "")) || 0;
  return `RX-${String(previous + 1).padStart(6, "0")}`;
}

function normalizeItems(items) {
  return items.map((item) => ({
    productId: item.productId ? String(item.productId) : null,
    name: String(item.name).trim(),
    strength: trimOrNull(item.strength),
    dosage: trimOrNull(item.dosage),
    qty: Number(item.qty) || 0,
    unit: String(item.unit || "strip").trim() || "strip",
    batchNumber: trimOrNull(item.batchNumber),
    substitutedFor: trimOrNull(item.substitutedFor),
  }));
}

export async function listPrescriptions(shopId, { status, scheduleType, from, to, search, includeDeleted = false } = {}) {
  const where = {
    shopId,
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(status && status !== "all" ? { status } : {}),
    ...(scheduleType && scheduleType !== "all" ? { scheduleType } : {}),
    ...(search
      ? {
          OR: [
            { patientName: { contains: search } },
            { patientPhone: { contains: search } },
            { doctorName: { contains: search } },
            { registerNumber: { contains: search } },
            { billNumber: { contains: search } },
          ],
        }
      : {}),
  };

  if (from || to) {
    const start = dayBounds(from || to, "from").start;
    const end = dayBounds(to || from, "to").end;
    if (end < start) throw new AppError("The end date cannot be before the start date", 400);
    where.prescribedOn = { gte: start, lte: end };
  }

  const rows = await db.prescription.findMany({
    where,
    orderBy: [{ prescribedOn: "desc" }, { createdAt: "desc" }],
    include: { items: true },
    take: 500,
  });
  return rows.map(serializePrescription);
}

export async function getPrescription(shopId, id) {
  const prescription = await db.prescription.findFirst({
    where: { id, shopId, deletedAt: null },
    include: { items: true },
  });
  if (!prescription) throw new AppError("Prescription not found", 404);
  return serializePrescription(prescription);
}

/**
 * Every register entry naming a medicine, newest first.
 *
 * The counter question this answers is "has this patient already been given this
 * before, and by whose prescription?" — asked of a product, because that is what
 * the biller has in hand.
 */
export async function getPrescriptionsForProduct(shopId, productId, { limit = 20 } = {}) {
  const rows = await db.prescription.findMany({
    where: { shopId, deletedAt: null, items: { some: { productId } } },
    orderBy: [{ prescribedOn: "desc" }],
    include: { items: true },
    take: Math.min(100, Math.max(1, Number(limit) || 20)),
  });
  return rows.map(serializePrescription);
}

export async function createPrescription(shopId, data, { userId = null } = {}) {
  const items = normalizeItems(data.items);
  const prescribedOn = dayBounds(data.prescribedOn, "prescribedOn").start;
  const dispenseNow = Boolean(data.dispenseNow);

  const create = async () =>
    db.prescription.create({
      data: {
        shopId,
        registerNumber: await nextRegisterNumber(db, shopId),
        doctorName: String(data.doctorName).trim(),
        doctorRegNo: trimOrNull(data.doctorRegNo),
        doctorClinic: trimOrNull(data.doctorClinic),
        customerId: data.customerId || null,
        patientName: String(data.patientName).trim(),
        patientPhone: normalizePhone(data.patientPhone),
        patientAge: trimOrNull(data.patientAge),
        patientGender: data.patientGender || null,
        patientAddress: String(data.patientAddress ?? "").trim(),
        scheduleType: data.scheduleType || "h",
        prescribedOn,
        status: dispenseNow ? "dispensed" : "pending",
        dispensedAt: dispenseNow ? new Date() : null,
        billId: data.billId || null,
        billNumber: trimOrNull(data.billNumber),
        refillsAllowed: Number(data.refillsAllowed) || 0,
        imageUrl: trimOrNull(data.imageUrl),
        notes: trimOrNull(data.notes),
        createdByUserId: userId,
        items: { create: items },
      },
      include: { items: true },
    });

  // Two counters recording at the same instant can pick the same number; the
  // unique index catches it and the retry takes the next one.
  try {
    return serializePrescription(await create());
  } catch (err) {
    if (err?.code === "P2002") return serializePrescription(await create());
    throw err;
  }
}

/**
 * Corrects an entry.
 *
 * A dispensed entry stays editable on purpose — counters mistype names and a
 * register that cannot be corrected is one that stays wrong. What keeps it
 * honest is the audit log: the controller records the before and after of every
 * change, so a correction is visible as a correction rather than as the truth
 * having always been that way. A cancelled entry is closed and stays closed.
 */
export async function updatePrescription(shopId, id, data) {
  const existing = await db.prescription.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!existing) throw new AppError("Prescription not found", 404);
  if (existing.status === "cancelled") {
    throw new AppError("A cancelled prescription can no longer be edited", 409, "PRESCRIPTION_CLOSED");
  }

  const patch = {
    ...(data.doctorName !== undefined ? { doctorName: String(data.doctorName).trim() } : {}),
    ...(data.doctorRegNo !== undefined ? { doctorRegNo: trimOrNull(data.doctorRegNo) } : {}),
    ...(data.doctorClinic !== undefined ? { doctorClinic: trimOrNull(data.doctorClinic) } : {}),
    ...(data.customerId !== undefined ? { customerId: data.customerId || null } : {}),
    ...(data.patientName !== undefined ? { patientName: String(data.patientName).trim() } : {}),
    ...(data.patientPhone !== undefined ? { patientPhone: normalizePhone(data.patientPhone) } : {}),
    ...(data.patientAge !== undefined ? { patientAge: trimOrNull(data.patientAge) } : {}),
    ...(data.patientGender !== undefined ? { patientGender: data.patientGender || null } : {}),
    ...(data.patientAddress !== undefined ? { patientAddress: String(data.patientAddress ?? "").trim() } : {}),
    ...(data.scheduleType !== undefined ? { scheduleType: data.scheduleType } : {}),
    ...(data.prescribedOn !== undefined ? { prescribedOn: dayBounds(data.prescribedOn, "prescribedOn").start } : {}),
    ...(data.billId !== undefined ? { billId: data.billId || null } : {}),
    ...(data.billNumber !== undefined ? { billNumber: trimOrNull(data.billNumber) } : {}),
    ...(data.refillsAllowed !== undefined ? { refillsAllowed: Number(data.refillsAllowed) || 0 } : {}),
    ...(data.imageUrl !== undefined ? { imageUrl: trimOrNull(data.imageUrl) } : {}),
    ...(data.notes !== undefined ? { notes: trimOrNull(data.notes) } : {}),
    ...(data.items ? { items: { deleteMany: {}, create: normalizeItems(data.items) } } : {}),
  };

  const updated = await db.prescription.update({
    where: { id: existing.id },
    data: patch,
    include: { items: true },
  });
  return serializePrescription(updated);
}

/**
 * Hands the medicine over.
 *
 * The first dispense closes a pending entry. A later one is a refill and is
 * refused once the repeats the doctor allowed have been used, which is the only
 * thing stopping one slip being presented indefinitely.
 */
export async function dispensePrescription(shopId, id, { billId = null, billNumber = null, notes } = {}) {
  const prescription = await db.prescription.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!prescription) throw new AppError("Prescription not found", 404);
  if (prescription.status === "cancelled") {
    throw new AppError("A cancelled prescription cannot be dispensed", 409, "PRESCRIPTION_BAD_STATUS");
  }

  const isRefill = prescription.status === "dispensed";
  if (isRefill && prescription.refillsUsed >= prescription.refillsAllowed) {
    throw new AppError(
      prescription.refillsAllowed === 0
        ? "This prescription has already been dispensed and allows no repeats"
        : `All ${prescription.refillsAllowed} repeats on this prescription have been used`,
      409,
      "PRESCRIPTION_NO_REFILLS",
    );
  }

  const updated = await db.prescription.update({
    where: { id: prescription.id },
    data: {
      status: "dispensed",
      dispensedAt: new Date(),
      ...(isRefill ? { refillsUsed: prescription.refillsUsed + 1 } : {}),
      // A refill goes out on its own bill, so the link follows the latest one.
      ...(billId !== undefined && billId !== null ? { billId } : {}),
      ...(billNumber ? { billNumber: String(billNumber).trim() } : {}),
      ...(notes !== undefined && notes !== null ? { notes: String(notes).trim() } : {}),
    },
    include: { items: true },
  });
  return serializePrescription(updated);
}

export async function cancelPrescription(shopId, id, { reason } = {}) {
  const prescription = await db.prescription.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!prescription) throw new AppError("Prescription not found", 404);
  if (prescription.status === "cancelled") {
    throw new AppError("This prescription is already cancelled", 409, "PRESCRIPTION_BAD_STATUS");
  }
  const updated = await db.prescription.update({
    where: { id: prescription.id },
    data: {
      status: "cancelled",
      ...(reason ? { notes: [prescription.notes, `Cancelled: ${String(reason).trim()}`].filter(Boolean).join("\n") } : {}),
    },
    include: { items: true },
  });
  return serializePrescription(updated);
}

export async function softDeletePrescription(shopId, id) {
  const prescription = await db.prescription.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!prescription) throw new AppError("Prescription not found", 404);
  const deleted = await db.prescription.update({
    where: { id: prescription.id },
    data: { deletedAt: new Date() },
    include: { items: true },
  });
  return serializePrescription(deleted);
}

export async function restorePrescription(shopId, id) {
  const prescription = await db.prescription.findFirst({ where: { id, shopId, deletedAt: { not: null } } });
  if (!prescription) throw new AppError("Deleted prescription not found in recycle bin", 404);
  const restored = await db.prescription.update({
    where: { id: prescription.id },
    data: { deletedAt: null },
    include: { items: true },
  });
  return serializePrescription(restored);
}

/** Counter-side headline numbers: what is waiting, what went out today, what the register owes. */
export async function getPrescriptionSummary(shopId) {
  const key = todayKey();
  const { start: dayStart, end: dayEnd } = dateRangeForDateOnly(key);
  const monthStart = dateRangeForDateOnly(`${key.slice(0, 7)}-01`).start;

  const [pending, dispensedToday, thisMonth, regulatedThisMonth, refillable, stale] = await Promise.all([
    db.prescription.count({ where: { shopId, deletedAt: null, status: "pending" } }),
    db.prescription.count({
      where: { shopId, deletedAt: null, status: "dispensed", dispensedAt: { gte: dayStart, lte: dayEnd } },
    }),
    db.prescription.count({ where: { shopId, deletedAt: null, prescribedOn: { gte: monthStart } } }),
    db.prescription.count({
      where: { shopId, deletedAt: null, prescribedOn: { gte: monthStart }, scheduleType: { in: ["h", "h1", "x"] } },
    }),
    // Repeats still available. Prisma cannot compare two columns in a filter, so
    // the ceiling is checked in JS over the small set that allows repeats at all.
    db.prescription.findMany({
      where: { shopId, deletedAt: null, status: "dispensed", refillsAllowed: { gt: 0 } },
      select: { refillsAllowed: true, refillsUsed: true },
    }),
    db.prescription.count({
      where: {
        shopId,
        deletedAt: null,
        status: "pending",
        prescribedOn: { lt: new Date(dayStart.getTime() - STALE_AFTER_DAYS * 86_400_000) },
      },
    }),
  ]);

  return {
    today: key,
    pending,
    dispensedToday,
    thisMonth,
    regulatedThisMonth,
    refillable: refillable.filter((row) => row.refillsUsed < row.refillsAllowed).length,
    stale,
    staleAfterDays: STALE_AFTER_DAYS,
  };
}
