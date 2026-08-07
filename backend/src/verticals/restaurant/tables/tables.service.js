import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { resolveOperationalLocation } from "../../../modules/stores/location-context.service.js";

/**
 * The restaurant floor.
 *
 * Tables used to live only in the till's own IndexedDB, which was exactly right
 * while the only reader was the till. A QR code stuck to table 5 changes who is
 * asking: a guest's phone, which has never met the till and talks only to the
 * server. So the floor plan is a shop record now, and the server can answer "is
 * this a real table here, and what is it called" without trusting a sticker.
 *
 * What this module does NOT own is the live order sitting at a table. That stays
 * where it was — a parked cart on the device that took it — because a table's
 * running bill is settled at the counter that opened it, and pushing it through
 * the server would make a waiter's tablet useless the moment the Wi-Fi dropped.
 */

/** A floor bigger than this is a data-entry mistake, not a restaurant. */
export const MAX_TABLES_PER_SHOP = 400;

/**
 * Turn a table's name into the code that goes on its sticker.
 *
 * Short, lowercase and readable, because the failure mode this guards against is
 * human: a waiter squinting at a curling sticker to tell the counter which table
 * the guest is at. "T5" → "t5"; "Terrace 2" → "terrace-2".
 */
export function slugifyTableCode(name) {
  const slug = String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "table";
}

/**
 * The first free code in the `t5`, `t5-2`, `t5-3` series.
 *
 * Two tables genuinely called "Terrace 2" is a mistake, but it is the owner's
 * mistake to make at 11pm while setting up — so it gets a working code rather
 * than an error dialog.
 */
export function nextFreeTableCode(base, takenCodes) {
  const taken = takenCodes instanceof Set ? takenCodes : new Set(takenCodes ?? []);
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix <= MAX_TABLES_PER_SHOP + 1; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new AppError("Could not find a free table code — rename the table.", 409);
}

export function serializeTable(table) {
  if (!table) return table;
  return {
    id: table.id,
    code: table.code,
    name: table.name,
    section: table.section,
    seats: table.seats,
    selfOrderEnabled: table.selfOrderEnabled,
    active: table.active,
    sortOrder: table.sortOrder,
    locationId: table.locationId ?? null,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
  };
}

async function takenCodesFor(shopId) {
  // Soft-deleted tables keep their codes: the sticker on the wall may not have
  // been peeled off, and reusing the code would silently point it at a new table.
  const rows = await db.restaurantTable.findMany({ where: { shopId }, select: { code: true } });
  return new Set(rows.map((row) => row.code));
}

export async function listTables(shopId, { locationId, includeInactive = false } = {}) {
  const rows = await db.restaurantTable.findMany({
    where: {
      shopId,
      deletedAt: null,
      ...(includeInactive ? {} : { active: true }),
      ...(locationId ? { locationId } : {}),
    },
    orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    take: MAX_TABLES_PER_SHOP,
  });
  return rows.map(serializeTable);
}

export async function getTable(shopId, id) {
  const table = await db.restaurantTable.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!table) throw new AppError("Table not found", 404);
  return serializeTable(table);
}

async function assertRoomOnTheFloor(shopId, adding = 1) {
  const existing = await db.restaurantTable.count({ where: { shopId, deletedAt: null } });
  if (existing + adding > MAX_TABLES_PER_SHOP) {
    throw new AppError(`A floor plan can hold ${MAX_TABLES_PER_SHOP} tables.`, 400);
  }
}

export async function createTable(shopId, body = {}) {
  await assertRoomOnTheFloor(shopId);
  const location = body.locationId
    ? await resolveOperationalLocation(shopId, body.locationId)
    : await resolveOperationalLocation(shopId, null);
  const taken = await takenCodesFor(shopId);
  const code = nextFreeTableCode(slugifyTableCode(body.code || body.name), taken);

  const table = await db.restaurantTable.create({
    data: {
      shopId,
      locationId: location?.id ?? null,
      code,
      name: String(body.name).trim(),
      section: String(body.section ?? "Dining").trim() || "Dining",
      seats: Number(body.seats ?? 4),
      selfOrderEnabled: body.selfOrderEnabled !== false,
      active: body.active !== false,
      sortOrder: Number(body.sortOrder ?? 0),
    },
  });
  return serializeTable(table);
}

/**
 * Lay out a whole floor in one go.
 *
 * This is how a restaurant starts — and how the floor plan a till already kept
 * locally moves up to the server without the owner retyping twelve tables.
 * Existing codes are matched and updated rather than duplicated, so running it
 * twice does not double the floor.
 */
export async function replaceFloorPlan(shopId, tables = []) {
  if (tables.length > MAX_TABLES_PER_SHOP) {
    throw new AppError(`A floor plan can hold ${MAX_TABLES_PER_SHOP} tables.`, 400);
  }
  const location = await resolveOperationalLocation(shopId, null);
  const existing = await db.restaurantTable.findMany({ where: { shopId } });
  const byCode = new Map(existing.map((row) => [row.code, row]));
  const taken = new Set(byCode.keys());

  const saved = [];
  const keptIds = new Set();
  for (const [index, input] of tables.entries()) {
    const wanted = slugifyTableCode(input.code || input.name);
    const match = byCode.get(wanted);
    const data = {
      name: String(input.name).trim(),
      section: String(input.section ?? "Dining").trim() || "Dining",
      seats: Number(input.seats ?? 4),
      selfOrderEnabled: input.selfOrderEnabled !== false,
      active: true,
      sortOrder: Number(input.sortOrder ?? index),
      deletedAt: null,
    };
    if (match) {
      keptIds.add(match.id);
      saved.push(await db.restaurantTable.update({ where: { id: match.id }, data }));
      continue;
    }
    const code = nextFreeTableCode(wanted, taken);
    taken.add(code);
    const created = await db.restaurantTable.create({
      data: { shopId, locationId: location?.id ?? null, code, ...data },
    });
    keptIds.add(created.id);
    saved.push(created);
  }

  // Anything the owner left out of the new plan is retired, not erased: its
  // code stays reserved so an un-peeled sticker can never resolve to a
  // different table.
  await db.restaurantTable.updateMany({
    where: { shopId, deletedAt: null, id: { notIn: [...keptIds] } },
    data: { deletedAt: new Date(), active: false },
  });

  return saved.map(serializeTable);
}

export async function updateTable(shopId, id, body = {}) {
  const existing = await db.restaurantTable.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!existing) throw new AppError("Table not found", 404);

  const data = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.section !== undefined) data.section = String(body.section).trim() || "Dining";
  if (body.seats !== undefined) data.seats = Number(body.seats);
  if (body.selfOrderEnabled !== undefined) data.selfOrderEnabled = body.selfOrderEnabled === true;
  if (body.active !== undefined) data.active = body.active === true;
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder);
  // The code is deliberately not editable. It is printed on a sticker that is
  // already on the wall; changing it would break the QR silently, with the
  // failure landing on a guest rather than on the person who made the change.

  const table = await db.restaurantTable.update({ where: { id: existing.id }, data });
  return serializeTable(table);
}

export async function removeTable(shopId, id) {
  const existing = await db.restaurantTable.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!existing) throw new AppError("Table not found", 404);
  await db.restaurantTable.update({
    where: { id: existing.id },
    data: { deletedAt: new Date(), active: false },
  });
  return { id: existing.id, removed: true };
}

export async function restoreTable(shopId, id) {
  const existing = await db.restaurantTable.findFirst({ where: { id, shopId } });
  if (!existing) throw new AppError("Table not found", 404);
  const table = await db.restaurantTable.update({
    where: { id: existing.id },
    data: { deletedAt: null, active: true },
  });
  return serializeTable(table);
}

/**
 * Resolve the code off a QR sticker to a table a guest may order from.
 *
 * Deliberately narrow, because this is the one function a stranger's phone can
 * reach: it returns the table or null, and never says which of the possible
 * reasons applied. A guest who mistypes a code, scans last year's sticker for a
 * removed table, or scans the private room that is on waiter service all see the
 * same "we couldn't find that table" — none of which tells them anything about
 * this restaurant's floor that they could not see by standing in it.
 */
export async function resolvePublicTable(shopId, code) {
  const wanted = slugifyTableCode(code);
  if (!wanted || wanted === "table") return null;
  const table = await db.restaurantTable.findFirst({
    where: { shopId, code: wanted, deletedAt: null, active: true },
  });
  if (!table || !table.selfOrderEnabled) return null;
  return serializeTable(table);
}
