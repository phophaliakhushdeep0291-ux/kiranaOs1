import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireShop } from "../../middleware/permissions.js";
import { validateQuery } from "../../middleware/validate.js";
import { udharQuerySchema } from "./udhar.schema.js";
import * as ctrl from "./udhar.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

router.get("/", validateQuery(udharQuerySchema), ctrl.getLedger);
router.get("/summary", ctrl.getSummary);

export default router;
