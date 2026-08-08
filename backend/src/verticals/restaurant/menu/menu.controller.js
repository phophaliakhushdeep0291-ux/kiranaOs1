import * as svc from "./menu.service.js";
import * as addons from "./addons.service.js";
import * as combos from "./combos.service.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

export async function board(req, res, next) {
  try {
    const data = await svc.getMenuBoard(req.shopId, {
      locationId: req.query.locationId ? String(req.query.locationId) : undefined,
      includeUnavailable: String(req.query.includeUnavailable ?? "true") !== "false",
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function courses(req, res, next) {
  try { res.json({ success: true, data: await svc.listCourses(req.shopId) }); }
  catch (err) { next(err); }
}

export async function updateDish(req, res, next) {
  try {
    const dish = await svc.updateDishMenu(req.shopId, req.params.productId, req.body);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "menu_dish_updated",
      entityType: "product", entityId: dish.id,
      after: { course: dish.menuCourse, foodType: dish.foodType, available: dish.menuAvailable }, req,
    });
    res.json({ success: true, data: dish });
  } catch (err) { next(err); }
}

/** How a course is reordered, and how a kitchen 86s several dishes at once. */
export async function bulkUpdate(req, res, next) {
  try {
    const data = await svc.bulkUpdateDishMenu(req.shopId, req.body.updates ?? []);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "menu_bulk_updated",
      entityType: "product", entityId: null, after: { dishes: data.length }, req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function dishVariations(req, res, next) {
  try { res.json({ success: true, data: await svc.listDishVariations(req.shopId, req.params.productId) }); }
  catch (err) { next(err); }
}

/** Replaces the dish's portions wholesale — the editor always sends the full list. */
export async function setDishVariations(req, res, next) {
  try {
    const data = await svc.setDishVariations(req.shopId, req.params.productId, req.body.variations ?? []);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "menu_variations_updated",
      entityType: "product", entityId: req.params.productId,
      after: { portions: data.map((row) => ({ name: row.name, price: row.price })) }, req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ── Add-ons ──────────────────────────────────────────────────────────────────

export async function addonGroups(req, res, next) {
  try { res.json({ success: true, data: await addons.listAddonGroups(req.shopId) }); }
  catch (err) { next(err); }
}

export async function saveAddonGroup(req, res, next) {
  try {
    const data = await addons.saveAddonGroup(req.shopId, req.params.groupId ?? null, req.body);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "menu_addon_group_saved",
      entityType: "menu_addon_group", entityId: data.id,
      after: { name: data.name, options: data.options.length, required: data.required }, req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function deleteAddonGroup(req, res, next) {
  try {
    const data = await addons.deleteAddonGroup(req.shopId, req.params.groupId);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "menu_addon_group_deleted",
      entityType: "menu_addon_group", entityId: req.params.groupId, after: null, req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function dishAddonGroups(req, res, next) {
  try { res.json({ success: true, data: await addons.listDishAddonGroups(req.shopId, req.params.productId) }); }
  catch (err) { next(err); }
}

export async function setDishAddonGroups(req, res, next) {
  try {
    const data = await addons.setDishAddonGroups(req.shopId, req.params.productId, req.body.groupIds ?? []);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "menu_dish_addons_updated",
      entityType: "product", entityId: req.params.productId,
      after: { groups: data.map((group) => group.name) }, req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ── Combos ──────────────────────────────────────────────────────────────────

export async function comboComponents(req, res, next) {
  try { res.json({ success: true, data: await combos.listComboComponents(req.shopId, req.params.productId) }); }
  catch (err) { next(err); }
}

/** Replaces the combo's dish list wholesale — the editor always sends all of it. */
export async function setComboComponents(req, res, next) {
  try {
    const data = await combos.setComboComponents(req.shopId, req.params.productId, req.body.components ?? []);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "menu_combo_updated",
      entityType: "product", entityId: req.params.productId,
      after: { components: data.map((row) => ({ name: row.name, quantity: row.quantity })) }, req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
