import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { updateShopSchema } from "./shops.schema.js";
import * as ctrl from "./shops.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

router.get("/", ctrl.getShop);
router.patch("/", requireOwnerPin, validate(updateShopSchema), ctrl.updateShop);

export default router;
