import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { requireDeviceActivated } from "./device.middleware.js";
import { activateDeviceSchema, heartbeatSchema, licenseQuerySchema, logoutDeviceSchema, renameDeviceSchema } from "./devices.schemas.js";
import * as ctrl from "./devices.controller.js";

const router = Router();

router.use(requireAuth, requireShop);

router.get("/current", ctrl.current);
router.get("/", requireRole("owner", "admin"), ctrl.list);
router.get("/active", requireRole("owner", "admin"), ctrl.active);
router.post("/activate", validate(activateDeviceSchema), ctrl.activate);
router.post("/logout-device", requireRole("owner", "admin"), requireOwnerPin, validate(logoutDeviceSchema), ctrl.logoutDevice);
router.patch("/:deviceId", requireRole("owner", "admin"), validate(renameDeviceSchema), ctrl.rename);
router.delete("/:deviceId", requireRole("owner", "admin"), requireOwnerPin, ctrl.remove);
router.post("/:deviceId/block", requireRole("owner", "admin"), requireOwnerPin, ctrl.block);
router.post("/:deviceId/unblock", requireRole("owner", "admin"), requireOwnerPin, ctrl.unblock);
router.post("/:deviceId/reactivate", requireRole("owner", "admin"), requireOwnerPin, ctrl.unblock);
router.post("/heartbeat", validate(heartbeatSchema), ctrl.heartbeat);
router.get("/license", validateQuery(licenseQuerySchema), requireDeviceActivated(), ctrl.license);

export default router;
