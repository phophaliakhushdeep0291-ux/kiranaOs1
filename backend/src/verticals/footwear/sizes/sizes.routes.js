import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import { validate } from "../../../middleware/validate.js";
import { sizeProfileSchema } from "./sizes.schema.js";
import * as ctrl from "./sizes.controller.js";

const router = Router();
// Gated on the capability, not the trade: a sports shop selling shoes alongside
// other goods holds SIZE_SYSTEMS too, and a shop that does not is turned away by
// the server rather than only by a hidden sidebar entry.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireCapability("SIZE_SYSTEMS"));

// Static paths first — none of these may be swallowed by "/:productId".
router.get("/summary", ctrl.summary);
router.get("/find", ctrl.findBySize);
router.get("/convert", ctrl.convert);
router.get("/", ctrl.list);
router.get("/:productId", ctrl.detail);

router.put("/:productId/profile", validate(sizeProfileSchema), ctrl.setProfile);

export default router;
