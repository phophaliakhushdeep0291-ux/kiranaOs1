import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { cancelTransferSchema, createLocationSchema, createTransferSchema, receiveTransferSchema, replenishmentRunSchema, transferComplianceReviewSchema, updateLocationSchema } from "./stores.schema.js";
import * as controller from "./stores.controller.js";
import { requireLocationParamAccess } from "./location-access.service.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());
router.get("/", controller.listLocations);
router.get("/transfers", requireFeature("multi_store"), controller.transfers);
router.get("/replenishment-suggestions", requireFeature("multi_store"), controller.replenishmentSuggestions);
router.get("/:id/inventory", requireLocationParamAccess("view"), controller.inventory);
router.post("/", requireRole("owner", "admin"), requireFeature("multi_store"), validate(createLocationSchema), controller.createLocation);
router.patch("/:id", requireRole("owner", "admin"), requireFeature("multi_store"), validate(updateLocationSchema), controller.updateLocation);
router.post("/transfers/:id/compliance-review", requireRole("owner", "admin"), requireFeature("multi_store"), requireOwnerPin, validate(transferComplianceReviewSchema), controller.reviewTransferCompliance);
router.post("/transfers/:id/receive", requireRole("owner", "admin"), requireFeature("multi_store"), requireOwnerPin, validate(receiveTransferSchema), controller.receiveTransfer);
router.post("/transfers/:id/cancel", requireRole("owner", "admin"), requireFeature("multi_store"), requireOwnerPin, validate(cancelTransferSchema), controller.cancelTransfer);
// Executing the plan ships stock, so it needs the owner PIN even though the
// scheduled run behind it is unattended.
router.post("/replenishment-run", requireRole("owner", "admin"), requireFeature("multi_store"), requireOwnerPin, validate(replenishmentRunSchema), controller.runReplenishment);
router.post("/transfers", requireRole("owner", "admin"), requireFeature("multi_store"), requireOwnerPin, validate(createTransferSchema), controller.createTransfer);

export default router;
