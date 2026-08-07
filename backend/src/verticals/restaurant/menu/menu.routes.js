import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import { validate } from "../../../middleware/validate.js";
import { bulkUpdateMenuSchema, updateDishMenuSchema } from "./menu.schema.js";
import * as ctrl from "./menu.controller.js";

const router = Router();
// MENU_MODIFIERS is the capability a shop holds when its catalogue is a menu
// rather than a shelf. Gated on the server, not only by a hidden nav entry.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireCapability("MENU_MODIFIERS"));

// Static paths first — neither may be swallowed by "/:productId".
router.get("/courses", ctrl.courses);
router.get("/", ctrl.board);

router.patch("/bulk", validate(bulkUpdateMenuSchema), ctrl.bulkUpdate);
router.patch("/:productId", validate(updateDishMenuSchema), ctrl.updateDish);

export default router;
