import * as svc from "./menu.service.js";
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
