import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireShop } from "../../middleware/permissions.js";
import { validateQuery } from "../../middleware/validate.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { accountingControlQuerySchema } from "./accounting-control.schema.js";
import * as controller from "./accounting-control.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated(), requireRole("owner"));
router.get("/control", validateQuery(accountingControlQuerySchema), controller.control);

export default router;