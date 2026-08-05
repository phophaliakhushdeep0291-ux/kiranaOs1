import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import { validate } from "../../../middleware/validate.js";
import { copyBookListSchema, createBookListSchema, updateBookListSchema } from "./book-lists.schema.js";
import * as ctrl from "./book-lists.controller.js";

const router = Router();
// Gated on the capability, not the trade: a general store next to a school sells
// book sets too, and a shop that does not is turned away by the server rather
// than only by a hidden sidebar entry.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireCapability("ACADEMIC_BOOK_LISTS"));

// Static paths first — none of these may be swallowed by "/:id".
router.get("/options", ctrl.options);
router.get("/summary", ctrl.summary);
router.get("/shortfall", ctrl.shortfall);
router.get("/", ctrl.list);
router.get("/:id", ctrl.detail);

router.post("/", validate(createBookListSchema), ctrl.create);
router.post("/:id/copy", validate(copyBookListSchema), ctrl.copy);
router.patch("/:id", validate(updateBookListSchema), ctrl.update);
router.delete("/:id", ctrl.remove);
router.post("/:id/restore", ctrl.restore);

export default router;
