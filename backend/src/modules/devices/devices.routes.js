import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { requireDeviceActivated } from "./device.middleware.js";
import { activateDeviceSchema, heartbeatSchema, licenseQuerySchema, logoutDeviceSchema } from "./devices.schemas.js";
import * as ctrl from "./devices.controller.js";

const router = Router();

function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return requireAuth(req, res, next);
  return next();
}

function optionalShop(req, res, next) {
  if (req.user) return requireShop(req, res, next);
  return next();
}

router.post("/logout-device", optionalAuth, optionalShop, validate(logoutDeviceSchema), ctrl.logoutDevice);

router.use(requireAuth, requireShop);

router.get("/", ctrl.list);
router.get("/active", ctrl.active);
router.post("/activate", validate(activateDeviceSchema), ctrl.activate);
router.delete("/:deviceId", requireRole("owner", "admin"), requireOwnerPin, ctrl.remove);
router.post("/:deviceId/block", requireRole("owner", "admin"), requireOwnerPin, ctrl.block);
router.post("/:deviceId/unblock", requireRole("owner", "admin"), requireOwnerPin, ctrl.unblock);
router.post("/heartbeat", validate(heartbeatSchema), ctrl.heartbeat);
router.get("/license", validateQuery(licenseQuerySchema), requireDeviceActivated(), ctrl.license);

export default router;
