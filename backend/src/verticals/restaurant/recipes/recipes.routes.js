import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { requireFeature } from "../../../modules/feature-gates/featureGate.middleware.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import { validate } from "../../../middleware/validate.js";
import { saveRecipeSchema } from "./recipes.schema.js";
import * as ctrl from "./recipes.controller.js";
// Importing the guard is what teaches shared billing that a dish has
// ingredients. It registers itself on load and is reachable only through these
// routes, so a shop with no recipes never runs it.
import "./recipes.guard.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated(), requireFeature("restaurant_recipe_inventory"), requireCapability("RECIPE_INVENTORY"));

// Static path first — it must not be read as a dish id.
router.get("/kitchen-stock", ctrl.kitchenStock);
router.get("/", ctrl.list);
router.get("/:dishProductId", ctrl.detail);

router.put("/:dishProductId", validate(saveRecipeSchema), ctrl.save);
router.delete("/:dishProductId", ctrl.remove);

export default router;
