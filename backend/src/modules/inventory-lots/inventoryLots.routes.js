import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { requireLocationAccess } from "../stores/location-access.service.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { lotQuerySchema, lotStatusSchema, trackingSchema } from "./inventoryLots.schema.js";
import * as controller from "./inventoryLots.controller.js";
import { requireCapability } from "../shops/businessProfile.middleware.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated(), requireFeature("batch_expiry"), requireCapability("BATCH_TRACKING"));
router.get("/", requireLocationAccess("view"), validateQuery(lotQuerySchema), controller.list);
router.patch("/products/:productId/tracking", requireRole("owner", "admin"), requireOwnerPin, validate(trackingSchema), controller.tracking);
router.post("/:id/status", requireRole("owner", "admin"), requireOwnerPin, validate(lotStatusSchema), controller.status);
export default router;
