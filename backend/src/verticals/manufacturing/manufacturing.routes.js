import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireShop } from "../../middleware/permissions.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { requireDeviceActivated } from "../../modules/devices/device.middleware.js";
import { requireCapability } from "../../modules/shops/businessProfile.middleware.js";
import { requireLocationAccess } from "../../modules/stores/location-access.service.js";
import { createBomSchema, createRunSchema, completeRunSchema, traceQuerySchema } from "./manufacturing.schemas.js";
import * as ctrl from "./manufacturing.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated(), requireCapability("PRODUCTION_RUNS"));
router.get("/overview", ctrl.overview);
router.get("/boms", ctrl.boms);
router.post("/boms", requireRole("owner", "admin"), validate(createBomSchema), ctrl.createBom);
router.post("/runs", requireRole("owner", "admin"), requireLocationAccess("inventory"), validate(createRunSchema), ctrl.createRun);
router.post("/runs/:id/complete", requireRole("owner", "admin"), requireLocationAccess("inventory"), validate(completeRunSchema), ctrl.completeRun);
router.get("/trace", validateQuery(traceQuerySchema), ctrl.trace);
export default router;
