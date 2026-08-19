import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

/**
 * A self-order terminal standing in the shop. Deliberately thin: the menu, the
 * stock rules and the order path are the ones the table QR already uses, so a
 * kiosk is "the dine-in storefront, minus the table". Duplicating any of that
 * would give the room two menus that could disagree.
 *
 * The terminal is a named, revocable thing rather than a shop-wide switch so an
 * owner can retire a broken screen without closing self-ordering for the room, and
 * so an order can say which terminal it came from.
 */
export async function listTerminals(shopId) {
  return db.kioskTerminal.findMany({
    where: { shopId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { location: { select: { id: true, name: true } } },
  });
}

export async function createTerminal(shopId, input, actor = {}, req = null) {
  const code = String(input.code || "").trim().toLowerCase();
  if (!code) throw new AppError("Terminal code is required", 422, "KIOSK_CODE_REQUIRED");

  const existing = await db.kioskTerminal.findFirst({ where: { shopId, code } });
  if (existing) throw new AppError(`Terminal ${code} already exists`, 409, "KIOSK_CODE_TAKEN");

  const terminal = await db.kioskTerminal.create({
    data: {
      shopId,
      locationId: input.locationId ?? null,
      code,
      name: String(input.name || code).trim(),
      requirePrepay: input.requirePrepay === true,
    },
  });
  await createAuditLog({
    shopId, userId: actor.userId ?? null, module: "restaurant", action: "KIOSK_TERMINAL_CREATED",
    entityType: "KioskTerminal", entityId: terminal.id, after: terminal, req,
  });
  return terminal;
}

export async function updateTerminal(shopId, id, input, actor = {}, req = null) {
  const before = await db.kioskTerminal.findFirst({ where: { id, shopId } });
  if (!before) throw new AppError("Terminal not found", 404, "KIOSK_TERMINAL_NOT_FOUND");

  const updated = await db.kioskTerminal.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: String(input.name).trim() }),
      ...(input.locationId !== undefined && { locationId: input.locationId }),
      ...(input.requirePrepay !== undefined && { requirePrepay: Boolean(input.requirePrepay) }),
      ...(input.active !== undefined && { active: Boolean(input.active) }),
    },
  });
  await createAuditLog({
    shopId, userId: actor.userId ?? null, module: "restaurant", action: "KIOSK_TERMINAL_UPDATED",
    entityType: "KioskTerminal", entityId: id, before, after: updated, req,
  });
  return updated;
}

/**
 * What the terminal itself asks for on wake: am I still a real terminal, and what
 * am I allowed to do. Public by design — it is called by an unattended screen with
 * no session — so it returns only what is safe to show a guest standing in front
 * of it: the shop name, the terminal name and where to fetch the menu. The shop id
 * is already in the URL the screen was configured with, so echoing it reveals
 * nothing, but no setting, staff detail or takings figure crosses this boundary.
 *
 * An inactive or unknown code is a flat 404: a retired terminal must stop serving
 * immediately, and a guessed code must not reveal whether it nearly worked.
 */
export async function resolveTerminal(shopId, terminalCode) {
  // Keyed on the shop id, matching the existing storefront: the ":shopCode" in
  // /t/:shopCode/:tableCode and /api/public/shops/:shopId/... is the shop id
  // itself, and inventing a second addressing scheme for kiosks would give the
  // room two ways to name the same shop.
  const shop = await db.shop.findFirst({ where: { id: String(shopId || "").trim() }, select: { id: true, name: true } });
  if (!shop) throw new AppError("Terminal not found", 404, "KIOSK_TERMINAL_NOT_FOUND");

  const terminal = await db.kioskTerminal.findFirst({
    where: { shopId: shop.id, code: String(terminalCode || "").trim().toLowerCase(), active: true },
    select: { id: true, code: true, name: true, requirePrepay: true },
  });
  if (!terminal) throw new AppError("Terminal not found", 404, "KIOSK_TERMINAL_NOT_FOUND");

  // Best-effort heartbeat: a screen that has stopped calling in is the thing an
  // owner wants to see, but failing to record it must never stop a guest ordering.
  await db.kioskTerminal.update({ where: { id: terminal.id }, data: { lastSeenAt: new Date() } }).catch(() => {});

  return {
    shop: { id: shop.id, name: shop.name },
    terminal: { code: terminal.code, name: terminal.name, requirePrepay: terminal.requirePrepay },
    // The catalogue the table QR already serves. Pointing the kiosk at the same
    // endpoint is what keeps one menu in the room.
    menuPath: `/api/public/shops/${shop.id}/catalog`,
    orderPath: `/api/public/shops/${shop.id}/orders`,
  };
}
