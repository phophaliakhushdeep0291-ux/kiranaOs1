import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import { validate } from "../../../middleware/validate.js";
import { bulkUpdateMenuSchema, setDishVariationsSchema, updateDishMenuSchema } from "./menu.schema.js";
import { saveAddonGroupSchema, setDishAddonGroupsSchema } from "./addons.schema.js";
import "./addons.guard.js";
import * as ctrl from "./menu.controller.js";

const router = Router();
// MENU_MODIFIERS is the capability a shop holds when its catalogue is a menu
// rather than a shelf. Gated on the server, not only by a hidden nav entry.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireCapability("MENU_MODIFIERS"));

// Static paths first — none of these may be swallowed by "/:productId".
router.get("/courses", ctrl.courses);
router.get("/addon-groups", ctrl.addonGroups);
router.post("/addon-groups", validate(saveAddonGroupSchema), ctrl.saveAddonGroup);
router.put("/addon-groups/:groupId", validate(saveAddonGroupSchema), ctrl.saveAddonGroup);
router.delete("/addon-groups/:groupId", ctrl.deleteAddonGroup);
router.get("/", ctrl.board);

router.patch("/bulk", validate(bulkUpdateMenuSchema), ctrl.bulkUpdate);

// Before "/:productId" would not matter here (different verbs and a longer path),
// but keeping the more specific route first matches the ordering above.
router.get("/:productId/variations", ctrl.dishVariations);
router.put("/:productId/variations", validate(setDishVariationsSchema), ctrl.setDishVariations);
router.get("/:productId/addon-groups", ctrl.dishAddonGroups);
router.put("/:productId/addon-groups", validate(setDishAddonGroupsSchema), ctrl.setDishAddonGroups);

router.patch("/:productId", validate(updateDishMenuSchema), ctrl.updateDish);

export default router;
