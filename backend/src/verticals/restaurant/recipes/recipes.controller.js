import * as svc from "./recipes.service.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";

export async function list(req, res, next) {
  try {
    const data = await svc.listRecipeComponents(req.shopId, {
      dishProductId: req.query.dishProductId ? String(req.query.dishProductId) : undefined,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/** What the kitchen reads before service: what is running out, and what can no longer be served. */
export async function kitchenStock(req, res, next) {
  try {
    const data = await svc.getKitchenStock(req.shopId, {
      locationId: req.query.locationId ? String(req.query.locationId) : undefined,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function detail(req, res, next) {
  try {
    const data = await svc.getRecipe(req.shopId, req.params.dishProductId, {
      locationId: req.query.locationId ? String(req.query.locationId) : undefined,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function save(req, res, next) {
  try {
    const before = await svc.listRecipeComponents(req.shopId, { dishProductId: req.params.dishProductId });
    const data = await svc.saveRecipe(req.shopId, req.params.dishProductId, req.body.components ?? []);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "dish_recipe_saved",
      entityType: "dish_recipe", entityId: req.params.dishProductId,
      before: { components: before.length },
      after: { components: data.components.length, ingredientCost: data.ingredientCost }, req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const data = await svc.deleteRecipe(req.shopId, req.params.dishProductId);
    await createAuditLog({
      shopId: req.shopId, userId: req.user?.id, action: "dish_recipe_removed",
      entityType: "dish_recipe", entityId: req.params.dishProductId, before: data, req,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
