import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { requireLocationAccess } from "../stores/location-access.service.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { expiryAlertQuerySchema, lotQuerySchema, lotStatusSchema, trackingSchema } from "./inventoryLots.schema.js";
import * as controller from "./inventoryLots.controller.js";
import { requireCapability } from "../shops/businessProfile.middleware.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated(), requireFeature("batch_expiry"), requireCapability("BATCH_TRACKING"));
router.get("/", requireLocationAccess("view"), validateQuery(lotQuerySchema), controller.list);
// What is about to expire and what it is worth. View-scoped: this is the screen
// that tells someone to pull stock off the shelf, so anyone who can see stock
// needs it.
router.get("/expiry-alerts", requireLocationAccess("view"), validateQuery(expiryAlertQuerySchema), controller.expiryAlerts);
// The counter's batch picker. Read-only and view-scoped: a cashier who can bill
// has to be able to see which batch they are about to dispense.
router.get("/sellable/:productId", requireLocationAccess("view"), controller.sellable);
router.patch("/products/:productId/tracking", requireRole("owner", "admin"), requireOwnerPin, validate(trackingSchema), controller.tracking);
router.post("/:id/status", requireRole("owner", "admin"), requireOwnerPin, validate(lotStatusSchema), controller.status);
export default router;
